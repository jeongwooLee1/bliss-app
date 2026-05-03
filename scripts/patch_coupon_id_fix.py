"""_at_is_coupon에서 note의 '쿠폰SEQ:' 패턴 제거 — 네이버 결제 추적용이라 실제 쿠폰 여부 아님.
service_name '쿠폰' 키워드만으로 판정."""
p = '/home/ubuntu/naver-sync/bliss_naver.py'
src = open(p).read()
old = """def _at_is_coupon(pkg):
    note = str(pkg.get('note') or '')
    if re.search(r'쿠폰\\s*SEQ\\s*[:：]', note, re.IGNORECASE): return True
    name = str(pkg.get('service_name') or '')
    if '쿠폰' in name: return True
    return False"""
new = """def _at_is_coupon(pkg):
    # service_name '쿠폰' 키워드만 (note의 '쿠폰SEQ:'는 네이버 결제 추적 번호 — 실제 쿠폰 여부 X)
    name = str(pkg.get('service_name') or '')
    if '쿠폰' in name: return True
    return False"""
if old not in src:
    print('PATTERN_NOT_FOUND'); raise SystemExit(1)
src = src.replace(old, new)
open(p, 'w').write(src)
print('PATCHED OK')
