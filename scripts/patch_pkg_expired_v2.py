"""package_expired 트리거 의미 변경 — 만료 보유권 + 활성 보유권 없음.
활성 보유권 있는 단골 고객은 '기존상담' 부여 X."""
p = '/home/ubuntu/naver-sync/bliss_naver.py'
src = open(p).read()

# 1) _at_has_active_pkg 헬퍼 추가 (claude_ask 위)
old1 = "def claude_ask(prompt, timeout=30, system=None, model=None):"
new1 = """def _at_has_active_pkg(cust_pkgs, today_str):
    \"\"\"활성 보유권 보유 여부 — 다담권 잔액>0 또는 다회권/연간권 잔여>0 + 비만료\"\"\"
    for p in cust_pkgs or []:
        if _at_is_coupon(p): continue
        if _at_is_expired(p, today_str): continue
        if _at_is_prepaid(p):
            m = re.search(r'잔액\\s*[:：]\\s*([0-9,]+)', str(p.get('note') or ''))
            bal = int(m.group(1).replace(',','')) if m else 0
            if bal > 0: return True
            continue
        if int(p.get('total_count') or 0) <= 0: continue
        if _at_remaining(p) > 0: return True
    return False

def claude_ask(prompt, timeout=30, system=None, model=None):"""
if old1 not in src:
    print('PATTERN_NOT_FOUND_1'); raise SystemExit(1)
src = src.replace(old1, new1)

# 2) package_expired 분기 변경
old2 = """            elif ttype == 'package_expired':
                for p in cust_pkgs:
                    if _at_is_coupon(p): continue
                    if _at_is_expired(p, today_str):
                        ok = True; break"""
new2 = """            elif ttype == 'package_expired':
                # 만료된 보유권 1건 이상 + 활성 보유권 없음 (재구매 유도 대상)
                _has_exp = any((not _at_is_coupon(p)) and _at_is_expired(p, today_str) for p in cust_pkgs)
                if _has_exp and not _at_has_active_pkg(cust_pkgs, today_str):
                    ok = True"""
if old2 not in src:
    print('PATTERN_NOT_FOUND_2'); raise SystemExit(1)
src = src.replace(old2, new2)

open(p, 'w').write(src)
print('PATCHED OK')
