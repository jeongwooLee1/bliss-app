"""네이버 예약 시스템 태그 자동 부여 — service_tags.auto_trigger 평가.
신규/마지막회차/기존상담/쿠폰만료/N일미방문 트리거를 Python으로 포팅.
ai_analyze_reservation에서 AI 결과와 합쳐 selected_tags에 저장."""
import re
p = '/home/ubuntu/naver-sync/bliss_naver.py'
src = open(p).read()

# 1) service_tags select에 auto_trigger 추가
old1 = '''        tags_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/service_tags?business_id=eq.{BUSINESS_ID}&use_yn=eq.true&schedule_yn=eq.false&select=id,name",'''
new1 = '''        tags_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/service_tags?business_id=eq.{BUSINESS_ID}&use_yn=eq.true&schedule_yn=eq.false&select=id,name,auto_trigger",'''

if old1 not in src:
    print('PATTERN_NOT_FOUND_1'); raise SystemExit(1)
src = src.replace(old1, new1)

# 2) 평가 함수 + 헬퍼 추가 (claude_ask 함수 위에 삽입)
old2 = 'def claude_ask(prompt, timeout=30, system=None, model=None):'
new2 = '''# ─── 시스템 태그 자동 부여 트리거 평가 (Python 포팅 — 클라이언트 src/lib/tagAutoTrigger.js와 동일 로직) ───
def _at_pkg_expires_at(pkg):
    note = str(pkg.get('note') or '')
    m = re.search(r'유효\\s*[:：]\\s*(\\d{4}-\\d{2}-\\d{2})', note)
    if m: return m.group(1)
    if pkg.get('expires_at'): return str(pkg['expires_at'])[:10]
    return None

def _at_is_expired(pkg, today_str):
    exp = _at_pkg_expires_at(pkg)
    if not exp: return False
    return exp < today_str

def _at_remaining(pkg):
    t = int(pkg.get('total_count') or 0)
    u = int(pkg.get('used_count') or 0)
    if t <= 0: return float('inf')
    return max(0, t - u)

def _at_is_prepaid(pkg):
    note = str(pkg.get('note') or '')
    if re.search(r'잔액\\s*[:：]\\s*[0-9]', note): return True
    name = str(pkg.get('service_name') or '')
    if re.search(r'다담권|바프권', name): return True
    return False

def _at_is_coupon(pkg):
    note = str(pkg.get('note') or '')
    if re.search(r'쿠폰\\s*SEQ\\s*[:：]', note, re.IGNORECASE): return True
    name = str(pkg.get('service_name') or '')
    if '쿠폰' in name: return True
    return False

def evaluate_tag_triggers(tags_cfg, customer, cust_pkgs, today_str=None):
    """tags_cfg: [{id, name, auto_trigger}], customer: dict|None, cust_pkgs: [pkg, ...]
       Returns: list of matched tag ids"""
    if not today_str:
        from datetime import datetime as _dt2, timedelta as _td2, timezone as _tz2
        kst = _dt2.now(_tz2.utc) + _td2(hours=9)
        today_str = kst.strftime('%Y-%m-%d')
    matched = []
    for t in (tags_cfg or []):
        trig = t.get('auto_trigger') or {}
        if isinstance(trig, str):
            try:
                import json as _j
                trig = _j.loads(trig)
            except Exception:
                continue
        if not trig or not trig.get('type'): continue
        ttype = trig.get('type')
        ok = False
        try:
            if ttype == 'is_new_customer':
                ok = (not customer) or int((customer or {}).get('visits') or 0) == 0
            elif ttype == 'package_low_count':
                threshold = int(trig.get('threshold', 1))
                for p in cust_pkgs:
                    if _at_is_prepaid(p) or _at_is_coupon(p): continue
                    if int(p.get('total_count') or 0) <= 0: continue
                    rem = _at_remaining(p)
                    if rem <= 0: continue
                    if _at_is_expired(p, today_str): continue
                    if rem <= threshold:
                        ok = True; break
            elif ttype == 'package_expired':
                for p in cust_pkgs:
                    if _at_is_coupon(p): continue
                    if _at_is_expired(p, today_str):
                        ok = True; break
            elif ttype == 'coupon_expiring_days':
                days = int(trig.get('days', 7))
                from datetime import datetime as _dt3
                today_dt = _dt3.strptime(today_str, '%Y-%m-%d')
                for p in cust_pkgs:
                    if _at_is_prepaid(p) or _at_is_coupon(p): continue
                    rem = _at_remaining(p)
                    if rem <= 0: continue
                    if _at_is_expired(p, today_str): continue
                    exp = _at_pkg_expires_at(p)
                    if not exp: continue
                    exp_dt = _dt3.strptime(exp, '%Y-%m-%d')
                    diff = (exp_dt - today_dt).days
                    if 0 <= diff <= days:
                        ok = True; break
            elif ttype == 'customer_inactive_days':
                if not customer: continue
                days = int(trig.get('days', 90))
                last = customer.get('last_date') or customer.get('lastDate') or ''
                if not last: continue
                from datetime import datetime as _dt4
                today_dt = _dt4.strptime(today_str, '%Y-%m-%d')
                last_dt = _dt4.strptime(str(last)[:10], '%Y-%m-%d')
                if (today_dt - last_dt).days >= days:
                    ok = True
        except Exception as _ex:
            continue
        if ok:
            matched.append(t.get('id'))
    return matched

def fetch_customer_packages(cust_id):
    """customer_packages 조회 (시스템 태그 평가용)"""
    if not cust_id: return []
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/customer_packages?customer_id=eq.{cust_id}&select=id,service_name,total_count,used_count,note",
            headers=HEADERS, timeout=8,
        )
        return r.json() if r.ok else []
    except Exception:
        return []

def fetch_customer_summary(cust_id):
    """customer 단일 조회 (visits/last_date 포함)"""
    if not cust_id: return None
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/customers?id=eq.{cust_id}&select=id,visits,last_date",
            headers=HEADERS, timeout=8,
        )
        rows = r.json() if r.ok else []
        return rows[0] if rows else None
    except Exception:
        return None

def claude_ask(prompt, timeout=30, system=None, model=None):'''

if old2 not in src:
    print('PATTERN_NOT_FOUND_2'); raise SystemExit(1)
src = src.replace(old2, new2)

# 3) AI 분석 후 시스템 태그 합치기 (merged_tags 라인)
old3 = '''    # ── 최종 태그 계산 ────────────────────────────────────────────────────────
    # 기존 시스템 태그 보존 + AI 태그 추가 (중복 제거)
    system_tags = [t for t in existing_tags if t in SYSTEM_TAG_IDS]
    merged_tags = list(dict.fromkeys(system_tags + ai_tag_ids))  # 순서 유지, 중복 제거

    # is_new_cust면 신규 태그 자동 추가
    if is_new_cust and NEW_CUST_TAG_ID not in merged_tags:
        merged_tags.append(NEW_CUST_TAG_ID)'''

new3 = '''    # ── 최종 태그 계산 ────────────────────────────────────────────────────────
    # 기존 시스템 태그 보존 + AI 태그 추가 (중복 제거)
    system_tags = [t for t in existing_tags if t in SYSTEM_TAG_IDS]
    merged_tags = list(dict.fromkeys(system_tags + ai_tag_ids))  # 순서 유지, 중복 제거

    # is_new_cust면 신규 태그 자동 추가 (레거시 — auto_trigger is_new_customer로 대체 권장)
    if is_new_cust and NEW_CUST_TAG_ID not in merged_tags:
        merged_tags.append(NEW_CUST_TAG_ID)

    # 🆕 service_tags.auto_trigger 평가 — 신규/마지막회차/기존상담/쿠폰만료/N일미방문
    # AI는 메모 기반 태그(주차/산모님/커플룸 등)만 매칭 → 시스템 태그는 코드로 직접 평가
    try:
        # reservation row에서 cust_id 가져옴 (이미 _process_one에서 매칭됨)
        _r = requests.get(
            f"{SUPABASE_URL}/rest/v1/reservations?reservation_id=eq.{rid}&select=cust_id",
            headers=HEADERS, timeout=5,
        )
        _rrows = _r.json() if _r.ok else []
        _cust_id = (_rrows[0].get('cust_id') if _rrows else '') or ''
        _customer = fetch_customer_summary(_cust_id) if _cust_id else None
        _cust_pkgs = fetch_customer_packages(_cust_id) if _cust_id else []
        _trigger_tag_ids = evaluate_tag_triggers(tags or [], _customer, _cust_pkgs)
        for _tid in _trigger_tag_ids:
            if _tid and _tid not in merged_tags:
                merged_tags.append(_tid)
        if _trigger_tag_ids:
            log.info(f"  🏷️  자동 트리거 태그 부여 #{rid}: {_trigger_tag_ids}")
    except Exception as _te:
        log.warning(f"  자동 트리거 평가 오류 #{rid}: {_te}")'''

if old3 not in src:
    print('PATTERN_NOT_FOUND_3'); raise SystemExit(1)
src = src.replace(old3, new3)

open(p, 'w').write(src)
print('PATCHED OK')
