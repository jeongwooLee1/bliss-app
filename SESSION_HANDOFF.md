# SESSION HANDOFF — 2026-04-14

## 이번 세션에서 완료한 작업

### 1. 회원가(Member Pricing) 시스템 구현
- `services` 테이블에 `member_price_f`, `member_price_m` 컬럼 추가 (Supabase SQL Editor)
- 10개 시술에 회원가 설정 완료:
  - 브라질리언+케어: F 105,000 / M 127,000
  - 브라질리언: F 88,000 / M 110,000
  - 비키니: F 33,000 / M 55,000
  - 항문왁싱: F/M 33,000
  - 산모관리: F 160,000
  - 재생관리: F/M 25,000
  - 기기진정관리: F/M 19,000
  - 진정팩: F/M 19,000
  - 풀페이스: F 150,000 / M 175,000 (패키지 가격)
  - 속눈썹펌: F 40,000
- `db.js`: DBMAP/DB_COLS에 memberPriceF/memberPriceM 추가
- **SaleForm**: `_defPrice()` 함수로 보유권 보유 고객에게 자동 회원가 적용
  - 자격: 다담권 / 다회권 / 연간회원권 / 연간할인권
  - 비자격: 에너지이용권, 제품구매권
  - SaleSvcRow: "회원" 태그 + 정상가 취소선 표시
  - 성별 변경 시 체크된 시술 가격 재계산
- **AdminSaleItems**: 회원가 화살표 표시 + 편집 폼에 회원가 필드
- **ReservationModal**: `_memberPrice()` 함수로 시술 선택 가격에 회원가 반영

### 2. 이전 세션 완료 (요약)
- SalesPage: sale_details 레이지 로딩 + PaySummary (결제수단 표시)
- 프로덕션 debug alert() / console.log() 전량 제거
- oracle_sync.py: 이름 없는 매출 수정 (Oracle MEMBER fallback)
- sale_details 중복 237K건 + sales 중복 60K건 삭제

---

## 현재 분석 중인 문제: 매출 메모 패키지 분석 정확도

### 배경
`analyze_pkg_memos.py` 스크립트로 sales.memo를 파싱해서 고객별 보유권 현황을 추출하려 함.
결과: `pkg_analysis.tsv` (1,394건, 1,201명)

### 발견된 regex 한계

#### 문제 1: Donado 고객 - ★남은금액★ 패턴 미인식
실제 메모:
```
★사용금액:045,000원/남은금액:285,000원★
① 시술내역 : 눈썹45,000 /다담 30구매
```

현재 스크립트:
- `★남은금액:285,000원★` → 다담권 잔액임이 명백하지만 현재 regex 패턴에 없음
- `다담 30구매` → `dadam_purchase` 타입으로만 잡힘 (구매 이력만, 잔액 없음)
- TSV 결과: `Donado  #55281  2026-04-07  다담권구매` ← 잔액 누락

**원인**: 다담 잔액 regex(line 47)가 `다담` 키워드 + 잔액을 같은 줄에 요구하는데,
이 메모는 잔액이 `★...★` 헤더 줄에 있고 `다담` 키워드는 다른 줄에 있음.

#### 문제 2: 마윤지(마운지) 고객 - TSV에 아예 없음
- `grep 마윤지 pkg_analysis.tsv` → 결과 없음
- 유저가 직접 확인한 메모에는 패키지 구매 내역이 있음
- **원인 추정**: 해당 고객의 패키지 표기가 현재 regex 패턴에 없는 형식일 가능성
  - 예: "왁싱PKG", "브라질리언팩", "깨꼼팩" 등 비표준 표기
  - 또는 날짜 범위 (`2025-10-01` 이후) 미포함

#### 문제 3: 메모 날짜 범위 제한
- 현재 스크립트: `date >= 2025-10-01` 필터
- 더 오래된 패키지 구매는 잡히지 않음 (단, 최신 잔액/회차 메모는 잡혀야 함)

#### 문제 4: 회차 패턴 매칭 누락 가능성
현재 regex: `(\S+(?:패키지|PKG|팩))\s*(\d+)\s*회차\s*/?\s*(\d+)\s*회\s*남`

못 잡는 패턴:
- `② 브라질리언 패키지  회차/ 회남음` → 회차/남음 숫자가 비어있는 경우
- `깨꼼팩 2/3` → 슬래시 형식
- `PKG 브라질리언 1/5회` → PKG가 앞에 오는 경우
- `왁싱PKG5 4회남음` → 회차 없이 남음만 있는 경우
- `브라질리언 3회구매 2회사용` → "구매/사용" 형식

---

## 다음 세션에서 해야 할 일

### 우선순위 1: 마윤지 실제 메모 확인
1. Supabase Dashboard SQL Editor에서 직접 조회:
   ```sql
   SELECT date, memo FROM sales 
   WHERE business_id = 'biz_khvurgshb' 
   AND cust_name = '마윤지' 
   AND memo != ''
   ORDER BY date DESC 
   LIMIT 10;
   ```
   (REST API는 sales 테이블 full scan으로 timeout 발생 — 직접 SQL 필요)
2. 어떤 패턴이 누락됐는지 파악 → regex 추가

### 우선순위 2: analyze_pkg_memos.py 개선

추가할 패턴:
```python
# ★사용금액:N원/남은금액:N원★ 형태의 다담권 잔액
m_star = re.search(r'★.*?(?:사용금액|이용금액)\s*:?\s*[\d,]+\s*원?\s*/\s*남은금액\s*:?\s*([\d,]+)', memo)
if m_star:
    remaining = re.sub(r'[,]','', m_star.group(1))
    pkgs_found.append({'type':'dadam_balance','remaining':remaining,'date':date})

# 남은금액/잔액만 단독으로 있는 경우 + 같은 메모에 다담 언급 있으면
m_remain = re.search(r'남은금액\s*:?\s*([\d,]+)', memo)
if m_remain and re.search(r'다담', memo):
    remaining = re.sub(r'[,]','', m_remain.group(1))
    pkgs_found.append({'type':'dadam_balance','remaining':remaining,'date':date})

# 회차 숫자 없는 경우 처리 (직원이 안 채운 경우)
# "왁싱패키지  회차/  회남음" → remaining=None으로 기록
for m in re.finditer(r'(\S+(?:패키지|PKG|팩))\s*(\d*)\s*회차\s*/?\s*(\d*)\s*회?\s*남', memo, re.I):
    ...

# 깨꼼팩 / 깨끗꼼꼼 패키지 명칭
# "깨꼼팩 2회차/3회남음" or "깨꼼팩"
```

### 우선순위 3: 날짜 범위 확장 고려
- `2025-10-01` → `2024-01-01` 로 확장해서 더 많은 이력 포함
- 단, 오래된 메모는 이미 소진된 패키지일 수 있음 → 최신 날짜 기준 필터 필요

### 우선순위 4: TSV 유저 검수 후 customer_packages 업데이트
- 분석 스크립트 개선 → 재실행 → TSV 재생성
- 유저가 엑셀에서 검토 (틀린 항목 삭제, 맞는 항목 확인)
- 확인된 항목만 customer_packages에 INSERT/UPDATE
- 주의: 이미 올바르게 등록된 패키지는 덮어쓰면 안 됨

---

## 기술 참고

### Supabase REST API sales 테이블 timeout 문제
- sales 테이블 236K건 → cust_name ilike 검색은 full scan으로 timeout
- 해결: Supabase SQL Editor에서 직접 실행 또는 cust_num으로 조회

### pkg_analysis 파일 위치
- `C:\Users\TP005\pkg_analysis.tsv` — 엑셀로 열기
- `C:\Users\TP005\pkg_analysis.json` — 상세 데이터
- `C:\Users\TP005\analyze_pkg_memos.py` — 분석 스크립트

### 분석 스크립트 실행
```
cd C:\Users\TP005
python analyze_pkg_memos.py > analyze_output.txt 2>&1
```
