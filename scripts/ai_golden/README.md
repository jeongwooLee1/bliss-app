# 받은메시지함 AI 응대 — 골든셋 회귀 하니스

받은메시지함 자동응답 AI(`ai_booking.ai_booking_agent`)의 **의사결정**을 고정된
시나리오 세트로 회귀 검증한다. 룰 본문(프롬프트)을 바꿀 때마다 돌려서 **다른 케이스가
깨지지 않았는지(회귀 0)** 확인한 뒤 배포하는 게이트.

## 왜 만들었나 (근본 문제)

`ai_booking.py`의 프롬프트는 사고가 날 때마다 "이 버그를 막아라"는 하드코딩 룰을
한 줄씩 쌓아 146개 넘게 평탄하게 쌓여 있었다. 그 결과:

- 룰끼리 충돌 (성별 묻지마 ↔ 물어라 / 예약금 16번룰 ↔ cross_day / FAQ ↔ 무조건담당자)
- 같은 의도 8중 중복 (성별만 8군데)
- 코드 가드와 프롬프트 룰이 **다른 임계치**로 이중 강제 (필수 3개 vs 6개 등)

새 룰을 추가하면 다른 답이 깨지고, 그걸 막는 룰을 또 추가하는 **악순환**.

## 원칙 (이게 핵심)

> **새 사고가 나면 `ai_booking.py` 룰을 늘리지 말고, 여기 `golden_set.json`에
> 케이스 1줄을 추가하라. 그리고 이 하니스를 돌려 회귀 0을 확인한 뒤 배포하라.**

룰을 고치는 건 자유지만, 고친 뒤 **반드시** 골든셋이 전부 PASS여야 라이브로 보낸다.
이러면 "버그 막는 룰이 다른 답을 깨는" 악순환이 회귀 게이트에서 잡힌다.

## 실행 (서버에서)

하니스는 운영 코드(`ai_booking.py`)·매장 캐시(가격·시술·지점)를 그대로 import하므로
**서버에서** 돌린다. 부작용은 0 (아래 참고).

```bash
# 서버
cd /home/ubuntu/naver-sync
python3 golden_run.py            # golden_set.json 채점
# exit 0 = 전부 PASS, exit 1 = 하나라도 FAIL (CI 게이트)
```

배포 워크플로우:
```
1) ai_booking.py 프롬프트/룰 수정
2) python3 golden_run.py  → 14/14 PASS 확인 (회귀 0)
3) PASS면 systemctl restart bliss-naver 로 반영
4) FAIL이면 어떤 케이스가 깨졌는지 보고 룰을 되돌리거나 케이스를 재검토
```

> 배포 시 이 두 파일(`golden_set.json`, `golden_run.py`)도 서버로 scp 해서 최신 유지.
> git( `scripts/ai_golden/` )이 원본(source of truth), 서버 `/home/ubuntu/naver-sync/`가 실행본.

## 부작용 0 (안전)

`golden_run.py`가 import 직후 운영 함수를 전부 mock 한다 — **DB 변경·텔레그램 발송·예약
생성 전무**. read만 실데이터(매장 가격·시술·지점 캐시)로 production과 동일한 답을 받는다.

- `create_booking_from_ai` / `cancel_booking` / `_insert_ai_change_request` → 호출만 기록(no-op)
- `_state_save` / `check_availability(→가용)` / `_change_slot_clear(→clear)` → mock (AI 결정만 격리)
- `_tg_notify` / `_bill_ai_call` / `_flag_inbox_followup` → no-op (텔레그램·빌링 노이즈 차단)
- `_load_history`·`find_existing_booking` → 케이스별 monkeypatch (대화·기존예약 주입)
- 호출은 `ai_booking_agent(..., force=True, suggest_only=True)` — 손님이 받는 답과 동일 경로

> **book 결정 캡처 주의(2026-06-13 운영 변경 반영)**: 이제 `suggest_only=True` 모드는 예약을
> 실제로 생성하지 않고 "답변 초안"만 만든다(`create_booking_from_ai` 미호출 + "booking 생성 skip"
> 로깅 + reply는 "예약 도와드릴까요? / Would you like me to book…?" 확인 요청). 그래서 하니스는
> 그 skip 로그를 가로채 'book 결정'으로 기록한다(create mock도 그대로 둬 이중 안전). 심판에게도
> "draft 모드라 book 결정이어도 reply가 확인 요청일 수 있다 — 그걸로 under-booking 판정 말 것"을 명시.

## 채점 방식

각 케이스마다:
1. **action_behavior (결정적)**: 봇이 실제로 한 동작군 — `book`(예약 진행 결정) / `cancel`(취소) / `noop`(대화·정보질문·보류). 기대 동작군과 일치해야 함. (이 신호는 노이즈 없음)
2. **LLM 심판 (Gemini 무료, 2-of-3 다수결)**: 케이스의 `must_pass` 기준 충족 여부 + 언어·환각 체크.
   `ideal`은 톤 참고용일 뿐, 형식·문구가 달라도 `must_pass`만 지키면 통과.
   첫 판정이 PASS면 그대로(빠른 경로), FAIL/에러면 2회 재심해 **3표 다수결**로 확정 → temp=0이라도 생기는 LLM 단발 노이즈로 게이트가 흔들리는 것 차단.
3. **PASS = action 일치 AND 심판 pass**.

### 게이트 vs known-open(xfail)

- 게이트 대상 케이스가 **하나라도 FAIL이면 `exit 1`** (CI 차단).
- 케이스에 `"known_fail": true`를 달면 **known-open** — 아직 못 고친(또는 룰끼리 충돌해 비결정적인) 동작을 추적용으로 박아두되 게이트에서는 제외한다.
  - known-open이 FAIL → `XFAIL`(예상된 실패, 게이트 무관)
  - known-open이 PASS → `XPASS`(고쳐진 듯 → `known_fail` 제거 검토 알림)
- `"known_note"`에 왜 미해결인지(어떤 룰 충돌인지) 적어둔다.

## golden_set.json 케이스 스키마

```jsonc
{
  "id": "cancel_basic",            // 고유 식별자
  "kind": "취소요청",               // 사람이 읽는 분류
  "channel": "whatsapp",           // whatsapp/instagram/kakao/sms (전부 공통채널로 취급 → 지점 명시 필요)
  "lang": "en",                    // 기대 응답 언어(참고)
  "conv": [["out","..."],["in","..."]],   // 대화. out=이전 봇/직원, in=손님. 마지막 in이 봇이 답할 메시지
  "existing_booking": {"id":"g_ex1","date":"2026-06-15","time":"13:30","branch":"강남","service":"브라질리언"},
                                   // 기존 예약(취소/변경용). 없으면 null. date에 "TODAY" 쓰면 실행일로 치환
  "expected_action": "cancel",     // book | cancel | chat | ask_info  (chat·ask_info는 noop으로 채점)
  "must_pass": "...",              // 이 답이 반드시 지켜야 할 하드 기준 (심판이 이것만 본다)
  "ideal": "...",                  // 이상적 답 예시 (톤 참고용, 강제 아님)
  "known_fail": true,              // (선택) known-open으로 표시 — 게이트에서 제외, 추적만
  "known_note": "..."              // (선택) 왜 미해결인지(룰 충돌 등)
}
```

> **결정성 원칙(가장 중요)**: 회귀 게이트는 결정적이어야 한다. 운영 AI는 temp>0라 같은 입력에도 표현이 매번 다르다.
> `must_pass`는 봇이 '정당하게 낼 수 있는 모든 올바른 답'을 통과시키고 '진짜 틀린 답'만 실패시켜야 한다.
> 특정 문구·특정 지점·길이·이모지 수를 강요하지 말 것 — '동작(action)'과 '하드 금지선(환각·언어이탈·시간재안내·잘못된 취소/예약)'만 검증.
> (실수 예: `address_question`을 공통 whatsapp 채널에서 "강남 주소를 답하라"로 박으면, 봇이 정상적으로 "어느 지점이세요?"라 되물을 때 run마다 PASS/FAIL이 흔들린다 → 8지점이라 되묻는 게 맞으니 둘 다 허용해야 함.)

## 현재 베이스라인

`golden_set.json` **25케이스** (과거 사고 + 핵심 시나리오 + 구조적 룰-충돌 구역):

| 구역 | 케이스 | 잠그는 사고/시나리오 |
|---|---|---|
| 취소 | cancel_basic | Yalguun 취소 미처리(분할 메시지 → 반드시 cancel, 미래 방문 재안내 금지) |
| 작별 | farewell_after_cancel · farewell_thanks · price_budget_farewell | 취소·작별·예산초과에 "See you at HH:MM" 시간 재안내·예약 강행 금지 |
| 변경 | change_time · crossday_change | 같은 날 시간이동 → book / 다른 날(cross-day) → 예약금 안내+담당자(noop) |
| 신규예약 | new_booking_foreign · multimsg_booking · couple_booking | 정보 다 모이면 book(under-booking 방지), 분할 메시지·커플 2인 종합 |
| 가격 | price_male_complex · fullbody_brazilian | 가격 정확(전신왁싱=풀바디), 금액 날조 금지 |
| 성별 | gender_flow `(known-open)` · gender_flow_2 | 성별 1회 질문 / 거부 시 빈값 book. **gender_flow = 룰 충돌 추적** |
| 가용성 | capacity_no_reject · capacity_no_reject_2 | capacity(자리참)로 거절 금지, 받아서 확정대기 |
| 영업/FAQ | business_hours · faq_not_defer · nose_waxing · address_question · address_known_branch | 영업시간 외 거절 / FAQ 직접답(담당자 떠넘기기 금지) / 불가시술 / 주소 환각·되묻기 |
| 기타 | collab_paid · simple_greeting · hold_defer · returning_existing · language_consistency | 콜라보 보류 / 인사 되묻기 / 보류 수용 / 기존예약 날짜 정확 / 외국어(일본어) 언어 일관성 |

**베이스라인: 24/24 게이트 PASS + 1 known-open** (2026-06-13, 현행 운영 프롬프트, 3회 연속 동일 — 결정적).

### known-open(추적 중인 미해결 룰 충돌)

- **`gender_flow`** — named-profile 채널(kakao/insta/whatsapp)에서 `custName`이 프로필명으로 자동 채워지면 **'사후보정1(필수4+이름 → ask_info→book 승격)'이 '성별 1회 질문' 룰을 덮어써**, 성별을 안 묻고 빈 성별로 즉시 book. 브라질리언은 성별별 가격차(F154k/M176k)가 있어 가격 혼선 소지. **under-booking 방지 룰 vs 성별질문 룰 충돌** — 수정 결정 대기. (SMS 등 프로필명 없는 채널에선 정상적으로 성별을 먼저 물음.)
  - 이 케이스는 run마다 book/ask_info를 오가는 **비결정적** 동작이라, 고치기 전까지 게이트에서 제외(known-open)해 가짜 회귀를 막는다. 룰을 정리해 결정적이 되면 `known_fail`을 떼고 하드 게이트로 승격한다.
