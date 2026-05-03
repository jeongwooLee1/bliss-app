#!/usr/bin/env python3
"""bliss_naver.py에 네이버 partner 막기 API 추가"""
import sys, os

SRC = "/home/ubuntu/naver-sync/bliss_naver.py"
BAK = "/home/ubuntu/naver-sync/bliss_naver.py.bak_block_api"

with open(SRC, "r", encoding="utf-8") as f:
    src = f.read()

if not os.path.exists(BAK):
    with open(BAK, "w", encoding="utf-8") as f:
        f.write(src)

if "naver_get_csrf" in src:
    print("[skip] already patched")
    sys.exit(0)

HELPER_BLOCK = r'''

# ─── 네이버 partner 막기 API ─────────────────────────────────────────────────
NAVER_PARTNER_BASE = "https://api-partner.booking.naver.com"
_naver_biz_items_cache = {}   # {biz_id: (item_ids, names_dict, expire_ts)}
_naver_csrf_cache = {"token": None, "expire_ts": 0.0}

def _naver_partner_session():
    try:
        mtime = os.path.getmtime(SESSION_FILE)
        if _session_cache["cookies"] is None or _session_cache["mtime"] != mtime:
            session_data = json.load(open(SESSION_FILE))
            _session_cache["cookies"] = {c["name"]: c["value"] for c in session_data.get("cookies", [])}
            _session_cache["mtime"] = mtime
        return _session_cache["cookies"]
    except Exception as e:
        log.error(f"[partner] session load fail: {e}")
        return {}

def _naver_partner_headers(biz_id):
    return {
        "accept": "application/json",
        "content-type": "application/json; charset=UTF-8",
        "origin": "https://partner.booking.naver.com",
        "referer": f"https://partner.booking.naver.com/bizes/{biz_id}/simple-management",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    }

def naver_get_biz_items(biz_id):
    """지점의 시술 list 조회 (1h 캐시) → [item_ids]"""
    biz_id = str(biz_id)
    now = time.time()
    cached = _naver_biz_items_cache.get(biz_id)
    if cached and cached[2] > now:
        return cached[0]
    try:
        url = f"{NAVER_PARTNER_BASE}/v3.1/businesses/{biz_id}/biz-items?lang=ko"
        cookies = _naver_partner_session()
        h = {**_naver_partner_headers(biz_id), "accept": "*/*", "authorization": "OWNER"}
        r = requests.get(url, cookies=cookies, headers=h, timeout=10)
        if r.status_code != 200:
            log.warning(f"[partner] biz-items {biz_id} status={r.status_code} body={r.text[:200]}")
            return cached[0] if cached else []
        items = r.json() if r.text else []
        if not isinstance(items, list):
            return cached[0] if cached else []
        item_ids = [it.get("bizItemId") for it in items if it.get("bizItemId")]
        names = {it.get("bizItemId"): (it.get("name") or "") for it in items}
        _naver_biz_items_cache[biz_id] = (item_ids, names, now + 3600)
        return item_ids
    except Exception as e:
        log.warning(f"[partner] biz-items err: {e}")
        return cached[0] if cached else []

def naver_get_biz_item_names(biz_id):
    naver_get_biz_items(biz_id)
    cached = _naver_biz_items_cache.get(str(biz_id))
    return cached[1] if cached else {}

def naver_get_csrf():
    """CSRF 토큰 발급 (5분 캐시)"""
    now = time.time()
    if _naver_csrf_cache["token"] and _naver_csrf_cache["expire_ts"] > now:
        return _naver_csrf_cache["token"]
    try:
        url = f"{NAVER_PARTNER_BASE}/v3.1/csrf-token"
        cookies = _naver_partner_session()
        h = {**_naver_partner_headers(0), "x-booking-naver-role": "NONE"}
        r = requests.post(url, cookies=cookies, headers=h, timeout=10, data="")
        if r.status_code != 200:
            log.warning(f"[partner] csrf status={r.status_code} body={r.text[:200]}")
            return None
        token = None
        try:
            j = r.json()
            token = j.get("token") or j.get("csrfToken") or (j.get("data") or {}).get("token") or (j.get("result") or {}).get("token")
        except Exception:
            pass
        if not token:
            token = r.headers.get("x-csrf-token")
        if not token:
            log.warning(f"[partner] csrf no-token body={r.text[:200]}")
            return None
        _naver_csrf_cache["token"] = token
        _naver_csrf_cache["expire_ts"] = now + 300
        return token
    except Exception as e:
        log.warning(f"[partner] csrf err: {e}")
        return None

def naver_get_hour_bit(biz_id, item_id, date):
    """48자 hourBit 조회 ('1'=가능, '0'=막힘)"""
    try:
        url = f"{NAVER_PARTNER_BASE}/v3.0/businesses/{biz_id}/biz-items/{item_id}/hourly-schedules?endDateTime={date}T00:00:00&startDateTime={date}T00:00:00"
        cookies = _naver_partner_session()
        h = {**_naver_partner_headers(biz_id), "authorization": "OWNER"}
        r = requests.get(url, cookies=cookies, headers=h, timeout=10)
        if r.status_code != 200:
            log.warning(f"[partner] get-bit {biz_id}/{item_id} {date} status={r.status_code}")
            return None
        slots = r.json()
        if not isinstance(slots, list) or len(slots) != 48:
            log.warning(f"[partner] get-bit unexpected slots: {len(slots) if isinstance(slots, list) else type(slots)}")
            return None
        return ''.join('1' if s.get('isUnitSaleDay') else '0' for s in slots)
    except Exception as e:
        log.warning(f"[partner] get-bit err: {e}")
        return None

def naver_set_hour_bit(biz_id, item_id, date, hour_bit, csrf=None):
    """hourBit POST → 막기/풀기.
    네이버 API: hourBit must contain only '0' or '1'.
    운영 외 슬롯('-')은 '1'로 인코딩 (default isUnitSaleDay=true 유지) → 운영 외 데이터 손상 방지."""
    if not csrf:
        csrf = naver_get_csrf()
    if not csrf:
        return False, "no csrf"
    # 정제: 0/1만 허용. 운영 외('-')는 '1'(sale 켬) 유지.
    hour_bit = hour_bit.replace('-', '1')
    if len(hour_bit) != 48 or any(c not in '01' for c in hour_bit):
        return False, f"invalid hourBit: {hour_bit!r}"
    try:
        url = f"{NAVER_PARTNER_BASE}/v3.1/businesses/{biz_id}/biz-items/{item_id}/sale-schedules"
        cookies = _naver_partner_session()
        h = {**_naver_partner_headers(biz_id), "x-booking-naver-role": "OWNER", "x-csrf-token": csrf}
        r = requests.post(url, cookies=cookies, headers=h, json={"day": date, "hourBit": hour_bit}, timeout=10)
        log.info(f"[partner] set-bit {biz_id}/{item_id} {date} status={r.status_code} body={r.text[:150]}")
        if r.status_code in (200, 201):
            return True, ""
        if r.status_code in (401, 403, 419):
            _naver_csrf_cache["token"] = None
            csrf2 = naver_get_csrf()
            if csrf2:
                h["x-csrf-token"] = csrf2
                r2 = requests.post(url, cookies=cookies, headers=h, json={"day": date, "hourBit": hour_bit}, timeout=10)
                if r2.status_code in (200, 201):
                    return True, ""
                return False, f"retry status={r2.status_code} {r2.text[:100]}"
        return False, f"status={r.status_code} {r.text[:100]}"
    except Exception as e:
        return False, str(e)

def naver_block_state(biz_id, date):
    """지점의 모든 시술 hourBit 조회 → {item_id: {name, hour_bit}}"""
    item_ids = naver_get_biz_items(biz_id)
    names = naver_get_biz_item_names(biz_id)
    result = {}
    for iid in item_ids:
        bits = naver_get_hour_bit(biz_id, iid, date)
        if bits is not None:
            result[str(iid)] = {"name": names.get(iid, ""), "hour_bit": bits}
    return result

def naver_toggle_slot(biz_id, item_id, date, hh_mm, block):
    """item 1개 슬롯 1개 토글"""
    h, m = map(int, hh_mm.split(':'))
    pos = (h * 60 + m) // 30
    if pos < 0 or pos >= 48:
        return False, "invalid time"
    cur = naver_get_hour_bit(biz_id, item_id, date)
    if cur is None:
        return False, "fetch failed"
    bits = list(cur)
    bits[pos] = '0' if block else '1'
    new_bit = ''.join(bits)
    if new_bit == cur:
        return True, "noop"
    return naver_set_hour_bit(biz_id, item_id, date, new_bit)


'''

ANCHOR = "# ─── 스크래퍼 스레드 ──"
idx = src.find(ANCHOR)
if idx < 0:
    print("ERR: helper anchor not found")
    sys.exit(1)
new_src = src[:idx] + HELPER_BLOCK.lstrip() + "\n" + src[idx:]

ROUTES_BLOCK = r'''
    # ─── 네이버 partner 막기 (개별 시술 토글) ───────────────────────────
    @app.route("/naver-block-state", methods=["GET", "OPTIONS"])
    def naver_block_state_route():
        if _flask_req.method == "OPTIONS":
            res = _flask_app_make_response("")
            res.headers.update({"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,OPTIONS"})
            return res
        biz_id = (_flask_req.args.get("biz_id") or "").strip()
        date = (_flask_req.args.get("date") or "").strip()
        if not biz_id or not date:
            return {"ok": False, "error": "biz_id and date required"}, 400
        try:
            state = naver_block_state(biz_id, date)
            body = json.dumps({"ok": True, "items": state}, ensure_ascii=False)
            res = _flask_app_make_response(body)
            res.headers["Content-Type"] = "application/json"
            res.headers["Access-Control-Allow-Origin"] = "*"
            return res
        except Exception as e:
            log.warning(f"[naver-block-state] err: {e}")
            return {"ok": False, "error": str(e)}, 500

    @app.route("/naver-toggle-slot", methods=["POST", "OPTIONS"])
    def naver_toggle_slot_route():
        if _flask_req.method == "OPTIONS":
            res = _flask_app_make_response("")
            res.headers.update({"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST,OPTIONS"})
            return res
        try:
            data = _flask_req.get_json(force=True, silent=True) or {}
            biz_id = str(data.get("biz_id") or "")
            item_id = str(data.get("item_id") or "")
            date = (data.get("date") or "").strip()
            time_str = (data.get("time") or "").strip()
            block = bool(data.get("block", True))
            if not all([biz_id, item_id, date, time_str]):
                return {"ok": False, "error": "biz_id/item_id/date/time required"}, 400
            ok, msg = naver_toggle_slot(biz_id, item_id, date, time_str, block)
            body = json.dumps({"ok": ok, "msg": msg}, ensure_ascii=False)
            res = _flask_app_make_response(body, (200 if ok else 500))
            res.headers["Content-Type"] = "application/json"
            res.headers["Access-Control-Allow-Origin"] = "*"
            return res
        except Exception as e:
            log.warning(f"[naver-toggle-slot] err: {e}")
            return {"ok": False, "error": str(e)}, 500

'''

ROUTES_ANCHOR = '    app.run(host="0.0.0.0", port=5055'
ridx = new_src.find(ROUTES_ANCHOR)
if ridx < 0:
    print("ERR: routes anchor not found")
    sys.exit(1)
new_src = new_src[:ridx] + ROUTES_BLOCK + new_src[ridx:]

with open(SRC, "w", encoding="utf-8") as f:
    f.write(new_src)

print("[ok] patched")
