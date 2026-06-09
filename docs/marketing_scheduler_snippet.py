# ─────────────────────────────────────────────────────────────────────────
# 마케팅 단체발송 — 예약 발송 서버 스케줄러 (Phase 1)
#
# ⚠️ 작업세션 산출물 — 배포세션이 /home/ubuntu/naver-sync/bliss_naver.py 에 적용.
# 서버는 bliss-app git 미추적. ssh + scp + `systemctl restart bliss-naver`.
#
# 동작: marketing_campaigns 중 status='scheduled' AND scheduled_at<=now 를 폴링,
#   발송 시점에 세그먼트를 재평가(수신동의+휴대폰 유효) → send-sms Edge Function 으로
#   배치 발송 → marketing_sends 로그 적재 → 캠페인 status='done'.
#
# 즉시 발송(scheduled_at IS NULL)은 앱(MarketingBroadcast.jsx)이 직접 처리하므로
#   이 스레드는 예약 건만 담당.
# ─────────────────────────────────────────────────────────────────────────

import time, uuid, datetime, requests
# (이미 bliss_naver.py 에 있는 것 재사용) SB_URL, SB_HEADERS(=sbHeaders),
#   _kr_mobile(전화 정규화), 그리고 send-sms 호출용 BLISS_PUBLISHABLE_KEY.

# 세그먼트 프리셋 → PostgREST 필터 (앱 buildSegmentFilter 와 동일 기준)
def _mkt_segment_filter(biz_id, segment, params):
    parts = [f"business_id=eq.{biz_id}", "is_hidden=not.is.true",
             "or=(sms_consent.is.null,sms_consent.eq.true)"]
    jf, jt = (params or {}).get("joinFrom"), (params or {}).get("joinTo")
    if jf: parts.append(f"join_date=gte.{jf}")
    if jt: parts.append(f"join_date=lte.{jt}")
    if segment == "new":      parts.append("visits=lte.1")
    elif segment == "repeat": parts.append("visits=gte.2")
    elif segment == "vip":    parts.append("visits=gte.10")
    elif segment == "churned":
        cut = (datetime.date.today() - datetime.timedelta(days=90)).isoformat()
        parts += ["visits=gte.1", f"last_visit=lt.{cut}", "last_visit=gte.2020-01-01"]
    elif segment == "noshow": parts.append("no_show_count=gte.1")
    return "&".join(parts)

def _mkt_fetch_recipients(biz_id, segment, params):
    """수신동의 + 유효 휴대폰 고객 [{id,name,phone}]. pkg 는 RPC."""
    rows = []
    if segment == "pkg":
        r = requests.post(f"{SB_URL}/rest/v1/rpc/get_customers_with_active_pkg",
            headers={**SB_HEADERS, "Content-Type": "application/json"},
            json={"p_biz": biz_id, "p_bid": None, "p_search": None, "p_offset": 0, "p_limit": 50000})
        rows = r.json() if r.ok else []
    else:
        flt = _mkt_segment_filter(biz_id, segment, params)
        off = 0
        while off < 100000:
            r = requests.get(f"{SB_URL}/rest/v1/customers?{flt}"
                f"&select=id,name,phone,sms_consent&order=id.asc&offset={off}&limit=1000",
                headers=SB_HEADERS)
            if not r.ok: break
            batch = r.json()
            rows += batch
            if len(batch) < 1000: break
            off += 1000
    out, seen = [], set()
    for c in rows:
        if c.get("sms_consent") is False: continue
        ph = _kr_mobile(c.get("phone") or "")  # 010 정규화 (없으면 빈값)
        digits = "".join(ch for ch in str(ph) if ch.isdigit())
        if not (digits.startswith("01") and 10 <= len(digits) <= 11): continue
        if digits in seen: continue
        seen.add(digits)
        out.append({"id": c.get("id"), "name": c.get("name") or "", "phone": digits})
    return out

def _mkt_apply_ad(msg, is_ad, optout):
    if not is_ad: return msg
    out = msg or ""
    if not out.lstrip().startswith("(광고)"): out = "(광고) " + out
    if optout and optout not in out: out = out.rstrip() + f"\n무료수신거부 {optout}"
    return out

def _mkt_render(tpl, fields):
    out = tpl or ""
    for k, v in (fields or {}).items():
        out = out.replace("#{%s}" % k, "" if v is None else str(v))
    return out

def _mkt_send_batch(branch_id, message, receivers):
    """send-sms Edge Function. receivers=[{phone,userKey}]"""
    r = requests.post(f"{SB_URL}/functions/v1/send-sms",
        headers={"apikey": BLISS_PUBLISHABLE_KEY,
                 "Authorization": f"Bearer {BLISS_PUBLISHABLE_KEY}",
                 "Content-Type": "application/json"},
        json={"branch_id": branch_id, "message": message, "receivers": receivers})
    try: body = r.json()
    except Exception: body = {}
    code = str(body.get("code", ""))
    data = body.get("data") or []
    ok = (code in ("100", "200") or body.get("ok") is True) and (
        len(data) == 0 and body.get("ok") is True or
        (len(data) > 0 and all(d.get("msgKey") for d in data)))
    return ok

def marketing_campaign_thread():
    """예약 마케팅 발송 — 60초 주기 폴링."""
    while True:
        try:
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            r = requests.get(f"{SB_URL}/rest/v1/marketing_campaigns"
                f"?status=eq.scheduled&scheduled_at=lte.{now}&order=scheduled_at.asc&limit=5",
                headers=SB_HEADERS)
            camps = r.json() if r.ok else []
            for c in camps:
                cid = c["id"]
                # 선점 — sending 으로 (중복 워커 방지)
                requests.patch(f"{SB_URL}/rest/v1/marketing_campaigns?id=eq.{cid}",
                    headers={**SB_HEADERS, "Prefer": "return=minimal"},
                    json={"status": "sending"})
                # 야간(21~08 KST) 재검증 — 통과 못하면 다음 영업시간으로 미룸
                kst_h = (datetime.datetime.now(datetime.timezone.utc)
                         + datetime.timedelta(hours=9)).hour
                if kst_h >= 21 or kst_h < 8:
                    requests.patch(f"{SB_URL}/rest/v1/marketing_campaigns?id=eq.{cid}",
                        headers={**SB_HEADERS, "Prefer": "return=minimal"},
                        json={"status": "scheduled"})  # 다음 주기 재시도
                    continue
                recips = _mkt_fetch_recipients(c["business_id"], c["segment"], c.get("segment_params"))
                msg, is_ad, optout = c["message"], c.get("is_ad"), c.get("optout_080")
                # 발신 지점 정보 (변수 치환용)
                br = (requests.get(f"{SB_URL}/rest/v1/branches?id=eq.{c['bid']}&select=name,short,phone",
                      headers=SB_HEADERS).json() or [{}])[0]
                has_var = "#{" in (msg or "")
                ok = fail = 0
                logs = []
                if not has_var:
                    final = _mkt_apply_ad(msg, is_ad, optout)
                    for i in range(0, len(recips), 100):
                        sl = recips[i:i+100]
                        good = _mkt_send_batch(c["bid"], final,
                            [{"phone": x["phone"], "userKey": x["id"] or x["phone"]} for x in sl])
                        for x in sl: logs.append((x, good))
                        if good: ok += len(sl)
                        else: fail += len(sl)
                else:
                    for x in recips:
                        personal = _mkt_apply_ad(_mkt_render(msg, {
                            "고객명": x["name"], "매장명": br.get("name", ""),
                            "지점명": br.get("short") or br.get("name", ""),
                            "대표전화번호": br.get("phone", "")}), is_ad, optout)
                        good = _mkt_send_batch(c["bid"], personal,
                            [{"phone": x["phone"], "userKey": x["id"] or x["phone"]}])
                        logs.append((x, good))
                        if good: ok += 1
                        else: fail += 1
                # 로그 적재 (1000건씩)
                sent_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
                rows = [{"id": "mks_" + uuid.uuid4().hex[:12], "campaign_id": cid,
                         "business_id": c["business_id"], "customer_id": x["id"],
                         "phone": x["phone"], "status": "sent" if g else "failed",
                         "sent_at": sent_at if g else None} for x, g in logs]
                for i in range(0, len(rows), 1000):
                    requests.post(f"{SB_URL}/rest/v1/marketing_sends",
                        headers={**SB_HEADERS, "Prefer": "return=minimal"}, json=rows[i:i+1000])
                requests.patch(f"{SB_URL}/rest/v1/marketing_campaigns?id=eq.{cid}",
                    headers={**SB_HEADERS, "Prefer": "return=minimal"},
                    json={"status": "done", "sent_count": ok, "fail_count": fail,
                          "target_count": len(recips), "updated_at": sent_at})
                # billing 차감 (deduct_billing RPC — sms/lms, 90byte 기준)
                # (선택) ok 건수만큼 차감 호출. 앱 즉시발송과 동일 정책.
        except Exception as e:
            try:
                import traceback; traceback.print_exc()
            except Exception: pass
        time.sleep(60)

# ── 스레드 시작 (다른 daemon thread 옆에 추가) ──
#   import threading
#   threading.Thread(target=marketing_campaign_thread, daemon=True,
#                    name="marketing_campaign").start()
#
# ── 적용 체크리스트 (배포세션) ──
#  1) DB: supabase/migrations/20260609_marketing_broadcast.sql 적용 (marketing_campaigns/sends + RLS)
#  2) bliss_naver.py 에 위 함수들 + 스레드 시작 추가, restart
#  3) _kr_mobile / SB_HEADERS / BLISS_PUBLISHABLE_KEY 는 기존 정의 재사용
#  4) (선택) deduct_billing 차감 호출 — 즉시발송과 동일하게 ok 건수만큼
