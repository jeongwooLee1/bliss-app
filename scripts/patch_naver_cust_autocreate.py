"""네이버 _process_one: 고객 매칭 실패 시 customers 자동 INSERT.
이름+전화 있으면 cust_id 새로 만들고 reservation에 연결.
cust_num은 비움 (매출 등록 시 SaleForm fetchNextCustNum이 부여)."""
p = '/home/ubuntu/naver-sync/bliss_naver.py'
src = open(p).read()

old = '''        else:
            matched_cust_id = None
            # 상품명에 "재방문" 포함되면 신규 아님 (네이버 API bookingCount가 0이어도)
            svc_names = " ".join(raw.get("services", []))
            biz_item_name = raw.get("biz_item_name", "")
            is_revisit = "재방문" in svc_names or "재방문" in biz_item_name
            is_new = visit_count == 0 and not is_revisit'''

new = '''        else:
            matched_cust_id = None
            # 상품명에 "재방문" 포함되면 신규 아님 (네이버 API bookingCount가 0이어도)
            svc_names = " ".join(raw.get("services", []))
            biz_item_name = raw.get("biz_item_name", "")
            is_revisit = "재방문" in svc_names or "재방문" in biz_item_name
            is_new = visit_count == 0 and not is_revisit
            # 🆕 신규 고객 자동 생성 — 이름+전화 있을 때만 customers INSERT
            # cust_num은 비움 (매출 등록 시 SaleForm.fetchNextCustNum이 부여)
            _new_name = (raw.get("name") or "").strip()
            _new_phone = (phone or "").strip()
            if _new_name and _new_phone:
                _new_cust_id = "cust_naver_" + _new_uid()
                try:
                    _today_str = _dt.now(_tz(_td(hours=9))).strftime("%Y-%m-%d") if False else __import__("datetime").datetime.now().strftime("%Y-%m-%d")
                    requests.post(
                        f"{SUPABASE_URL}/rest/v1/customers",
                        headers={**HEADERS, "Prefer": "return=minimal"},
                        json={
                            "id": _new_cust_id,
                            "business_id": BUSINESS_ID,
                            "bid": bid,
                            "name": _new_name,
                            "phone": _new_phone,
                            "email": (raw.get("email") or "").strip(),
                            "gender": gender,
                            "memo": "네이버 신규 예약 자동 생성",
                            "join_date": _today_str,
                            "sms_consent": True,
                            "is_hidden": False,
                        },
                        timeout=10,
                    )
                    matched_cust_id = _new_cust_id
                    log.info(f"  🆕 네이버 신규 고객 자동 생성: {_new_name} ({_new_phone}) → cust_id={_new_cust_id}")
                except Exception as _ce:
                    log.warning(f"  네이버 신규 고객 INSERT 실패: {_ce}")'''

if old not in src:
    print('PATTERN_NOT_FOUND'); raise SystemExit(1)
src = src.replace(old, new)
open(p, 'w').write(src)
print('PATCHED OK')
