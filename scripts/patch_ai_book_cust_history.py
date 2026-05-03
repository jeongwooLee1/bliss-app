"""ai_booking.py: 공통 채널 + 지점 매칭 실패 시 → chat 정보로 고객 매칭하여
이전 예약 지점·이메일·이름·전화·성별을 컨텍스트에 자동 주입.

증상: WhatsApp 등 공통 채널 고객이 'tomorrow 1:30 brazilian' 같이 지점 미언급 시
AI가 'which branch?' 물어봄. 고객이 등록되어 있고 이전 예약 이력 있어도 활용 못함.

수정: shared-channel + branch_id None 분기에서 cust_history 자동 lookup.
1) reservations.chat_channel + chat_account_id + chat_user_id로 매칭 → 최근 active 예약
2) 그 예약의 cust_id로 customers 조회 → name/phone/email/gender
3) bid → branch 정보로 default 설정 + AI prompt에 명시
"""
p = '/home/ubuntu/naver-sync/ai_booking.py'
src = open(p).read()

old = """    # 🆕 공통 번호(WhatsApp 단일계정) 사전 branch 매칭
    # 고객이 "잠실/마곡/홍대/용산" 등 명시하면 해당 지점으로 동적 변경
    # 매칭 실패 시 branch_name을 "(미정)"으로 표시 → LLM이 ask_info로 처리하게 유도
    _is_shared_channel = (account_id not in ACC_BRANCH)
    _shared_branch_matched = False
    if _is_shared_channel:
        _scan_text = history_text + "\\n" + (user_msg or "")
        try:
            _matched_bid = _match_branch_by_name(_scan_text)
            if _matched_bid:
                _b_row = branches_cache.get(_matched_bid, {}) if isinstance(branches_cache, dict) else {}
                _bn = _b_row.get("name") or _b_row.get("short") or branch_name
                log.info(f"[ai_booking] shared-channel branch match: {branch_id} -> {_matched_bid} ({_bn})")
                branch_id = _matched_bid
                branch_name = _bn
                _shared_branch_matched = True
            else:
                log.info(f"[ai_booking] shared-channel: no branch keyword detected → branch_name=(미정)")
                branch_name = "(미정 — 고객에게 지점 물어볼 것)"
                branch_id = None
        except Exception as _be:
            log.warning(f"[ai_booking] pre-branch match err: {_be}")"""

new = """    # 🆕 공통 번호(WhatsApp 단일계정) 사전 branch 매칭
    # 고객이 "잠실/마곡/홍대/용산" 등 명시하면 해당 지점으로 동적 변경
    # 매칭 실패 시 → 고객 chat 정보로 이전 예약 lookup → 거기서 자주 가던 지점·고객정보 추출
    _is_shared_channel = (account_id not in ACC_BRANCH)
    _shared_branch_matched = False
    _cust_history = None  # {cust_id, name, phone, email, gender, last_bid, last_branch_name}
    if _is_shared_channel:
        _scan_text = history_text + "\\n" + (user_msg or "")
        try:
            _matched_bid = _match_branch_by_name(_scan_text)
            if _matched_bid:
                _b_row = branches_cache.get(_matched_bid, {}) if isinstance(branches_cache, dict) else {}
                _bn = _b_row.get("name") or _b_row.get("short") or branch_name
                log.info(f"[ai_booking] shared-channel branch match: {branch_id} -> {_matched_bid} ({_bn})")
                branch_id = _matched_bid
                branch_name = _bn
                _shared_branch_matched = True
            else:
                # 🆕 고객 이력 lookup — chat 정보로 같은 고객의 최근 예약 찾기
                try:
                    _r = requests.get(
                        f"{SUPABASE_URL}/rest/v1/reservations",
                        params={
                            "chat_channel": f"eq.{channel}",
                            "chat_account_id": f"eq.{account_id}",
                            "chat_user_id": f"eq.{user_id}",
                            "cust_id": "not.is.null",
                            "status": "not.in.(cancelled,naver_cancelled,naver_changed)",
                            "select": "cust_id,bid,date",
                            "order": "date.desc",
                            "limit": "1",
                        },
                        headers=HEADERS, timeout=8,
                    )
                    _rows = _r.json() if _r.ok else []
                    if _rows and _rows[0].get("cust_id") and _rows[0].get("bid"):
                        _cid = _rows[0]["cust_id"]
                        _last_bid = _rows[0]["bid"]
                        # customer 정보 조회
                        _cr = requests.get(
                            f"{SUPABASE_URL}/rest/v1/customers?id=eq.{_cid}&select=id,name,phone,email,gender",
                            headers=HEADERS, timeout=8,
                        )
                        _cust_rows = _cr.json() if _cr.ok else []
                        _cust_row = _cust_rows[0] if _cust_rows else {}
                        _b_row = branches_cache.get(_last_bid, {}) if isinstance(branches_cache, dict) else {}
                        _bn = _b_row.get("name") or _b_row.get("short") or "(지점)"
                        _cust_history = {
                            "cust_id": _cid,
                            "name": _cust_row.get("name") or "",
                            "phone": _cust_row.get("phone") or "",
                            "email": _cust_row.get("email") or "",
                            "gender": _cust_row.get("gender") or "",
                            "last_bid": _last_bid,
                            "last_branch_name": _bn,
                        }
                        # 자동 default — AI가 별도 지점 언급 없으면 이 지점으로 진행
                        branch_id = _last_bid
                        branch_name = _bn
                        _shared_branch_matched = True
                        log.info(f"[ai_booking] shared-channel cust history found: cust={_cid[:12]} name={_cust_history['name']} last_branch={_bn} ({_last_bid})")
                    else:
                        log.info(f"[ai_booking] shared-channel: no branch keyword + no cust history → branch_name=(미정)")
                        branch_name = "(미정 — 고객에게 지점 물어볼 것)"
                        branch_id = None
                except Exception as _he:
                    log.warning(f"[ai_booking] cust history lookup err: {_he}")
                    branch_name = "(미정 — 고객에게 지점 물어볼 것)"
                    branch_id = None
        except Exception as _be:
            log.warning(f"[ai_booking] pre-branch match err: {_be}")"""

if old not in src:
    print('PATTERN_NOT_FOUND'); raise SystemExit(1)
src = src.replace(old, new)
open(p, 'w').write(src)
print('PATCHED OK')
