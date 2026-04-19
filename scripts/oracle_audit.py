"""
Oracle ↔ Supabase(Bliss) 데이터 감사

원칙:
- Oracle cust_num = 유일한 정답 (이름·연락처는 중복 가능)
- 4/16 이전 Supabase 데이터 = Oracle 원본
- Bliss 네이티브(4/17~)는 order_num이 숫자가 아니거나 date > 2026-04-16
- 결과는 CSV로만 저장, 자동 수정 없음

출력 (C:/Users/TP005/bliss-app/tmp_review/oracle_audit/):
  01_missing_in_bliss.csv      Oracle 있고 Bliss 없음 + 매출/메모 존재
  02_field_mismatch.csv        cust_num 매칭되는데 name/phone/memo/email 불일치
  03_missing_sales.csv         Oracle 매출이 Bliss에 누락
  04_wrong_cust_num.csv        Bliss 매출 cust_num/phone/name이 Oracle과 다름
  05_duplicate_custs.csv       Bliss 내 중복 고객 (같은 phone or 같은 name, cust_num 다름)
  99_summary.txt                요약
"""
import oracledb, os, json, urllib.request, urllib.error, csv, sys, time
from collections import defaultdict
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

OUT = r'C:/Users/TP005/bliss-app/tmp_review/oracle_audit'
os.makedirs(OUT, exist_ok=True)

# === Oracle ===
os.environ['NLS_LANG'] = 'KOREAN_KOREA.KO16MSWIN949'
oracledb.init_oracle_client(lib_dir=r'C:\oracle\instantclient_23_7')
ora = oracledb.connect(user='housewaxing', password='oracle', dsn='googlea.withbiz.co.kr:5063/ORA11GHW')
cur = ora.cursor()

# === Supabase ===
SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
SB_KEY = "sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj"
BIZ_ID = "biz_khvurgshb"
HEADERS = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}


def sb_get_all(path_without_offset, page_size=1000):
    """paginated GET"""
    rows = []
    offset = 0
    while True:
        sep = '&' if '?' in path_without_offset else '?'
        url = f"{SB_URL}/rest/v1/{path_without_offset}{sep}limit={page_size}&offset={offset}"
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req) as r:
                batch = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            print(f"  [HTTP {e.code}] {e.read().decode()[:200]}")
            break
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def norm_phone(p):
    if not p:
        return ''
    return str(p).replace('-', '').replace(' ', '').strip()


def norm_str(s):
    if s is None:
        return ''
    return str(s).strip()


print(f"=== Oracle ↔ Bliss 감사 시작 {datetime.now():%Y-%m-%d %H:%M} ===\n")

# ─── 1. Oracle 데이터 로드 ───
print("[1/4] Oracle MEMBER 로드...")
cur.execute("""
    SELECT NO, NAME, HIDDENNAME, SEXDIV, TEL, EMAIL, JOINDATE, LASTDATE, MEMO, LASTBRANCHNO
    FROM MEMBER
    ORDER BY NO
""")
ora_members = {}
for row in cur.fetchall():
    no, name, hn, sex, tel, email, jd, ld, memo, bno = row
    ora_members[str(no)] = {
        'cust_num': str(no),
        'name': norm_str(name),
        'hiddenname': norm_str(hn),
        'sex': norm_str(sex),
        'phone': norm_phone(tel),
        'email': norm_str(email),
        'join_date': jd.strftime('%Y-%m-%d') if jd else '',
        'last_visit': ld.strftime('%Y-%m-%d') if ld else '',
        'memo': norm_str(memo),
        'branch_no': bno,
    }
print(f"    Oracle MEMBER: {len(ora_members):,}명")

print("[2/4] Oracle ORDERS 로드...")
cur.execute("""
    SELECT NO, MEMNO, ORDERDATE, WAXCASH, WAXBANK, WAXCARD, PRODCASH, PRODBANK, PRODCARD,
           WAXPOINT, PRODPOINT, NOTE, MGRNO, BRANCHNO
    FROM ORDERS
    ORDER BY NO
""")
ora_orders = {}
ora_orders_by_memno = defaultdict(list)
for row in cur.fetchall():
    no, memno, dt, wc, wb, wk, pc, pb, pk, wp, pp, note, mgrno, brno = row
    total = sum(x or 0 for x in [wc, wb, wk, pc, pb, pk, wp, pp])
    rec = {
        'order_num': str(no),
        'cust_num': str(memno),
        'date': dt.strftime('%Y-%m-%d') if dt else '',
        'total': total,
        'wax_cash': wc or 0, 'wax_bank': wb or 0, 'wax_card': wk or 0,
        'prod_cash': pc or 0, 'prod_bank': pb or 0, 'prod_card': pk or 0,
        'wax_point': wp or 0, 'prod_point': pp or 0,
        'note': norm_str(note),
        'mgrno': mgrno,
        'branch_no': brno,
    }
    ora_orders[str(no)] = rec
    ora_orders_by_memno[str(memno)].append(rec)
print(f"    Oracle ORDERS: {len(ora_orders):,}건")

# ─── 2. Supabase 데이터 로드 ───
print("[3/4] Supabase customers 로드...")
sb_custs = sb_get_all(f"customers?select=id,cust_num,name,name2,phone,phone2,email,gender,bid,memo,join_date,visits,last_visit,created_at&business_id=eq.{BIZ_ID}")
sb_cust_by_custnum = {}   # cust_num -> sb row
sb_cust_by_id = {}         # id -> sb row
for c in sb_custs:
    sb_cust_by_id[c['id']] = c
    if c.get('cust_num'):
        sb_cust_by_custnum[str(c['cust_num'])] = c
print(f"    Bliss customers: {len(sb_custs):,}명 (cust_num 있음: {len(sb_cust_by_custnum):,})")

print("[4/4] Supabase sales 로드 (연도 분할)...")
sb_sales = []
for y in range(2011, 2027):
    chunk = sb_get_all(
        f"sales?select=id,order_num,cust_id,cust_num,cust_name,cust_phone,date,bid,svc_cash,svc_transfer,svc_card,svc_point,prod_cash,prod_transfer,prod_card,prod_point,staff_name,created_at"
        f"&business_id=eq.{BIZ_ID}&date=gte.{y}-01-01&date=lt.{y+1}-01-01"
    )
    if chunk:
        print(f"    {y}: {len(chunk):,}건")
        sb_sales.extend(chunk)
sb_sales_by_order_num = {}   # order_num(숫자) -> sb row  (오라클에서 온 건)
sb_sales_native = []          # Bliss 네이티브 매출 (order_num 없거나 비숫자)
for s in sb_sales:
    on = s.get('order_num')
    if on and str(on).isdigit():
        sb_sales_by_order_num[str(on)] = s
    else:
        sb_sales_native.append(s)
print(f"    Bliss sales: {len(sb_sales):,}건 (오라클 {len(sb_sales_by_order_num):,} / 네이티브 {len(sb_sales_native):,})")

# ─── 리포트 ①: Oracle 있고 Bliss 없음 + 매출/메모 존재 ───
print("\n▶ 리포트 ① Oracle 있고 Bliss 없음 (매출/메모 존재)")
report1 = []
for cn, m in ora_members.items():
    if cn in sb_cust_by_custnum:
        continue
    has_orders = len(ora_orders_by_memno.get(cn, [])) > 0
    has_memo = bool(m['memo'])
    if not (has_orders or has_memo):
        continue
    report1.append({
        'cust_num': cn,
        'name': m['name'],
        'phone': m['phone'],
        'email': m['email'],
        'join_date': m['join_date'],
        'last_visit': m['last_visit'],
        'orders_count': len(ora_orders_by_memno.get(cn, [])),
        'has_memo': has_memo,
        'memo_preview': m['memo'][:80],
    })
print(f"    → {len(report1):,}명")

# ─── 리포트 ②: 필드 불일치 (cust_num 매칭되는 경우) ───
print("▶ 리포트 ② 필드 불일치 (필드별 분리)")
report2_name = []
report2_phone = []
report2_email = []
report2_join = []
report2_memo = []
for cn, m in ora_members.items():
    b = sb_cust_by_custnum.get(cn)
    if not b:
        continue
    common = {'cust_num': cn, 'bliss_id': b['id']}
    if norm_str(b.get('name')) != m['name']:
        report2_name.append({**common, 'ora_name': m['name'], 'bliss_name': norm_str(b.get('name'))})
    ora_phone = m['phone']
    sb_phone = norm_phone(b.get('phone'))
    sb_phone2 = norm_phone(b.get('phone2'))
    if ora_phone and ora_phone != sb_phone and ora_phone != sb_phone2:
        report2_phone.append({**common, 'bliss_name': norm_str(b.get('name')), 'ora_phone': ora_phone, 'bliss_phone': sb_phone, 'bliss_phone2': sb_phone2})
    if m['email'] and norm_str(b.get('email')) and m['email'] != norm_str(b.get('email')):
        report2_email.append({**common, 'bliss_name': norm_str(b.get('name')), 'ora_email': m['email'], 'bliss_email': norm_str(b.get('email'))})
    if m['join_date'] and b.get('join_date') and m['join_date'] != str(b.get('join_date'))[:10]:
        report2_join.append({**common, 'bliss_name': norm_str(b.get('name')), 'ora_join': m['join_date'], 'bliss_join': str(b.get('join_date'))[:10]})
    if m['memo']:
        sb_memo = norm_str(b.get('memo'))
        if sb_memo and m['memo'][:50] != sb_memo[:50]:
            report2_memo.append({**common, 'bliss_name': norm_str(b.get('name')), 'ora_memo': m['memo'][:150], 'bliss_memo': sb_memo[:150]})
        elif not sb_memo:
            report2_memo.append({**common, 'bliss_name': norm_str(b.get('name')), 'ora_memo': m['memo'][:150], 'bliss_memo': '(비어있음)'})
print(f"    → name {len(report2_name):,} / phone {len(report2_phone):,} / email {len(report2_email):,} / join {len(report2_join):,} / memo {len(report2_memo):,}")

# ─── 리포트 ③: Oracle 매출 누락 ───
print("▶ 리포트 ③ Oracle 매출 누락")
report3 = []
for on, o in ora_orders.items():
    if on not in sb_sales_by_order_num:
        m = ora_members.get(o['cust_num'])
        report3.append({
            'order_num': on,
            'date': o['date'],
            'cust_num': o['cust_num'],
            'cust_name': m['name'] if m else '',
            'cust_phone': m['phone'] if m else '',
            'total': o['total'],
            'in_bliss_cust': o['cust_num'] in sb_cust_by_custnum,
        })
print(f"    → {len(report3):,}건")

# ─── 리포트 ⑥: Bliss에만 있는 매출 (Oracle order_num 없음) ───
print("▶ 리포트 ⑥ Bliss 매출인데 Oracle에 없음 (order_num 불일치)")
report6 = []
for on, s in sb_sales_by_order_num.items():
    if on not in ora_orders:
        report6.append({
            'order_num': on,
            'bliss_id': s.get('id'),
            'date': s.get('date'),
            'cust_num': s.get('cust_num'),
            'cust_name': s.get('cust_name'),
            'cust_phone': s.get('cust_phone'),
            'staff_name': s.get('staff_name'),
            'bliss_created_at': s.get('created_at'),
        })
print(f"    → {len(report6):,}건")

# ─── 리포트 ④: Bliss 매출 잘못된 cust_num ───
print("▶ 리포트 ④ Bliss 매출 cust_num 오염")
report4 = []
for on, sb_s in sb_sales_by_order_num.items():
    ora_o = ora_orders.get(on)
    if not ora_o:
        continue  # Bliss에 있는 order_num이 Oracle에 없는 경우는 나중 검토
    ora_memno = ora_o['cust_num']  # 정답
    sb_custnum = norm_str(sb_s.get('cust_num'))
    # Bliss 매출의 cust_id가 가리키는 고객
    cust_id = sb_s.get('cust_id')
    linked_cust = sb_cust_by_id.get(cust_id) if cust_id else None
    linked_custnum = norm_str(linked_cust.get('cust_num')) if linked_cust else ''
    if ora_memno and sb_custnum and ora_memno != sb_custnum:
        ora_m = ora_members.get(ora_memno)
        report4.append({
            'order_num': on,
            'date': sb_s.get('date') or ora_o['date'],
            'ora_cust_num': ora_memno,
            'ora_name': ora_m['name'] if ora_m else '',
            'ora_phone': ora_m['phone'] if ora_m else '',
            'bliss_cust_num': sb_custnum,
            'bliss_cust_name': norm_str(sb_s.get('cust_name')),
            'bliss_linked_cust_num_via_id': linked_custnum,
        })
    elif ora_memno and cust_id and linked_custnum and ora_memno != linked_custnum:
        ora_m = ora_members.get(ora_memno)
        report4.append({
            'order_num': on,
            'date': sb_s.get('date') or ora_o['date'],
            'ora_cust_num': ora_memno,
            'ora_name': ora_m['name'] if ora_m else '',
            'ora_phone': ora_m['phone'] if ora_m else '',
            'bliss_cust_num': sb_custnum,
            'bliss_cust_name': norm_str(sb_s.get('cust_name')),
            'bliss_linked_cust_num_via_id': linked_custnum,
        })
print(f"    → {len(report4):,}건")

# ─── 리포트 ⑦: Oracle 동명이인 누락 + 매출 흡수 (최우선 복구 대상) ───
print("▶ 리포트 ⑦ Oracle 누락 + 매출 흡수")
from collections import Counter
absorption = defaultdict(lambda: {'absorbed_by': Counter(), 'first_date': '9999', 'last_date': '0000'})
for r in report4:
    oc = r['ora_cust_num']
    bc = r['bliss_cust_num']
    absorption[oc]['absorbed_by'][bc] += 1
    dt = r['date'] or ''
    if dt < absorption[oc]['first_date']: absorption[oc]['first_date'] = dt
    if dt > absorption[oc]['last_date']: absorption[oc]['last_date'] = dt

report7 = []
missing_with_absorb = 0
for ora_cn, info in absorption.items():
    if ora_cn in sb_cust_by_custnum:
        continue  # Bliss에 원본 cust_num 존재 → 단순 매출 매핑 오류 (누락 아님)
    m = ora_members.get(ora_cn)
    if not m:
        continue
    missing_with_absorb += 1
    for bliss_cn, cnt in info['absorbed_by'].most_common():
        bliss_cust = sb_cust_by_custnum.get(bliss_cn)
        report7.append({
            'ora_cust_num': ora_cn,
            'ora_name': m['name'],
            'ora_phone': m['phone'],
            'ora_join_date': m['join_date'],
            'absorbed_by_cust_num': bliss_cn,
            'bliss_id': bliss_cust['id'] if bliss_cust else '',
            'absorbed_sales_count': cnt,
            'date_range': f"{info['first_date']} ~ {info['last_date']}",
        })
print(f"    → {len(report7):,}쌍 (누락된 원본 고객 {missing_with_absorb:,}명)")

# ─── 리포트 ⑤: Bliss 중복 고객 ───
print("▶ 리포트 ⑤ Bliss 내 중복 고객")
report5 = []
by_phone = defaultdict(list)
by_namephone = defaultdict(list)
for c in sb_custs:
    ph = norm_phone(c.get('phone'))
    nm = norm_str(c.get('name'))
    # 유효 전화번호만 (10자 이상, 'no_phone' 제외, '010'만 있는 것 제외)
    valid_phone = ph and len(ph) >= 10 and not ph.startswith('no_phone')
    if valid_phone:
        by_phone[ph].append(c)
    if nm and valid_phone:
        by_namephone[(nm, ph)].append(c)

# phone 중복 (cust_num 다른 경우만)
for ph, lst in by_phone.items():
    if len(lst) < 2:
        continue
    unique_custnums = set(str(c.get('cust_num') or '') for c in lst)
    unique_custnums.discard('')
    if len(unique_custnums) < 2 and len(lst) < 2:
        continue
    report5.append({
        'type': 'same_phone',
        'phone': ph,
        'count': len(lst),
        'cust_nums': ','.join(sorted(unique_custnums)),
        'names': ' / '.join(norm_str(c.get('name')) for c in lst[:5]),
        'ids': ','.join(c['id'] for c in lst[:5]),
    })

# name+phone 중복
for (nm, ph), lst in by_namephone.items():
    if len(lst) < 2:
        continue
    unique_custnums = set(str(c.get('cust_num') or '') for c in lst)
    unique_custnums.discard('')
    if len(unique_custnums) < 2:
        continue
    report5.append({
        'type': 'same_name_phone',
        'phone': ph,
        'count': len(lst),
        'cust_nums': ','.join(sorted(unique_custnums)),
        'names': nm,
        'ids': ','.join(c['id'] for c in lst[:5]),
    })
print(f"    → {len(report5):,}건")

# ─── CSV 출력 ───
def write_csv(name, rows):
    path = os.path.join(OUT, name)
    if not rows:
        with open(path, 'w', encoding='utf-8-sig', newline='') as f:
            f.write('(데이터 없음)\n')
        return
    keys = list(rows[0].keys())
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f"  saved: {name} ({len(rows):,} rows)")

print(f"\n=== CSV 저장 ({OUT}) ===")
write_csv('01_missing_in_bliss.csv', report1)
write_csv('02a_diff_name.csv', report2_name)
write_csv('02b_diff_phone.csv', report2_phone)
write_csv('02c_diff_email.csv', report2_email)
write_csv('02d_diff_join_date.csv', report2_join)
write_csv('02e_diff_memo.csv', report2_memo)
write_csv('03_missing_sales.csv', report3)
write_csv('04_wrong_cust_num.csv', report4)
write_csv('05_duplicate_custs.csv', report5)
write_csv('06_bliss_extra_sales.csv', report6)
write_csv('07_absorption_pairs.csv', report7)

# 요약
summary = f"""Oracle ↔ Bliss 감사 요약 ({datetime.now():%Y-%m-%d %H:%M})

규모:
  Oracle MEMBER:  {len(ora_members):,}명
  Oracle ORDERS:  {len(ora_orders):,}건
  Bliss customers: {len(sb_custs):,}명  (cust_num 있음: {len(sb_cust_by_custnum):,})
  Bliss sales:    {len(sb_sales):,}건  (오라클: {len(sb_sales_by_order_num):,} / 네이티브: {len(sb_sales_native):,})

발견 사항:
  ① Oracle 있고 Bliss 없음 + 매출/메모 존재:  {len(report1):,}명
  ② 필드 불일치 — cust_num 기준 매칭되지만 값이 다름:
      - name:       {len(report2_name):,}명
      - phone:      {len(report2_phone):,}명
      - email:      {len(report2_email):,}명
      - join_date:  {len(report2_join):,}명
      - memo:       {len(report2_memo):,}명   (유저가 직접 수정했을 가능성 큼)
  ③ Oracle 매출 Bliss에 누락:                  {len(report3):,}건
  ④ Bliss 매출 cust_num 오염:                  {len(report4):,}건  ← 최우선 검토
  ⑤ Bliss 내 중복 고객 (phone or name+phone):  {len(report5):,}건
  ⑥ Bliss에만 있고 Oracle에 없는 매출:         {len(report6):,}건  (수동 등록/테스트)
  ⑦ Oracle 누락 + 매출 흡수 쌍:                {len(report7):,}건  ← 실제 복구 대상 (박예지 30035 타입)

각 CSV 파일은 {OUT} 참고.
다음 단계: 유저가 CSV 검토 → 승인된 건만 수정 작업.
"""
with open(os.path.join(OUT, '99_summary.txt'), 'w', encoding='utf-8') as f:
    f.write(summary)
print('\n' + summary)

cur.close()
ora.close()
print("=== 완료 ===")
