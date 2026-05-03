"""ai_booking.py prompt에 _cust_history 정보 주입.
공통 채널 + cust 매칭 시 → 이름/전화/이메일/성별 + 마지막 지점을 prompt에 명시.
AI가 정보 재질문 안 하고 booking 즉시 진행하게 가이드."""
p = '/home/ubuntu/naver-sync/ai_booking.py'
src = open(p).read()

old = """[채널 자동 수집 정보 — 고객에게 재질문 절대 금지, booking에 그대로 사용]
- 채널: {channel}
- 이름 (user_name 자동 수집): {_auto_name}
- 연락처 (WhatsApp user_id에서 자동 추출): {_phone_wa_hint}
  → _auto_name 있으면 booking.custName에, _phone_wa_hint 있으면 booking.custPhone에 채워 넣기
  → 이미 시스템이 갖고 있는 정보이므로 "이름/연락처 알려주세요" 질문 금지
{existing_bookings}
{customer_packages_block}"""

new = """[채널 자동 수집 정보 — 고객에게 재질문 절대 금지, booking에 그대로 사용]
- 채널: {channel}
- 이름 (user_name 자동 수집): {_auto_name}
- 연락처 (WhatsApp user_id에서 자동 추출): {_phone_wa_hint}
  → _auto_name 있으면 booking.custName에, _phone_wa_hint 있으면 booking.custPhone에 채워 넣기
  → 이미 시스템이 갖고 있는 정보이므로 "이름/연락처 알려주세요" 질문 금지
{cust_history_block}
{existing_bookings}
{customer_packages_block}"""

if old not in src:
    print('PATTERN_NOT_FOUND_PROMPT'); raise SystemExit(1)
src = src.replace(old, new)

# cust_history_block 변수 빌드 — prompt 직전에 추가
build_old = """    prompt = f\"\"\"당신은 하우스왁싱 {branch_name} 예약 접수 AI입니다."""
build_new = """    # 🆕 등록 고객 + 이전 예약 이력 정보 (공통 채널에서 cust 매칭된 경우)
    cust_history_block = ""
    if _cust_history:
        ch = _cust_history
        cust_history_block = f\"\"\"[등록 고객 — 이 고객은 이미 등록되어 있고 이전 예약 이력 있음. 정보 재질문 금지]
- 고객 ID: {ch.get('cust_id','')}
- 이름: {ch.get('name','')}
- 전화: {ch.get('phone','')}
- 이메일: {ch.get('email','')}
- 성별: {ch.get('gender','')}
- 최근 예약 지점: {ch.get('last_branch_name','')} (별도 지점 언급 없으면 이 지점으로 booking)
★ booking에 위 정보를 그대로 채워넣으세요. 이름/전화/이메일/지점 다시 묻지 마세요.
\"\"\"

    prompt = f\"\"\"당신은 하우스왁싱 {branch_name} 예약 접수 AI입니다."""

if build_old not in src:
    print('PATTERN_NOT_FOUND_BUILD'); raise SystemExit(1)
src = src.replace(build_old, build_new)

open(p, 'w').write(src)
print('PATCHED OK')
