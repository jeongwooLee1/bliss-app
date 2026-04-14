"""
3소스 병합 → pkg_audit 테이블 업로드
소스: 매출메모(pkg_analysis.json), 오라클(ORDERDETAIL), 블리스(customer_packages)
"""
import sys, re, json, time
sys.stdout.reconfigure(encoding='utf-8')
import requests
from datetime import datetime, timedelta
from collections import defaultdict

# ── 설정 ──
SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
SB_KEY = "sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj"
SB_HEADERS = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"}
BIZ_ID = "biz_khvurgshb"
BRANCH_MAP = {9:"강남점", 10:"왕십리점", 11:"홍대점", 20:"잠실점(구)",
              30:"용산점(구)", 40:"잠실점", 50:"마곡점", 60:"용산점", 70:"위례점", 71:"천호점"}
today = datetime.now()

# ═══════════════════════════════════════
# 1. 매출메모 (pkg_analysis.json)
# ═══════════════════════════════════════
print("1. 매출메모 로드 중...")
with open(r"C:\Users\TP005\pkg_analysis.json", "r", encoding="utf-8") as f:
    memo_data = json.load(f)
print(f"   {len(memo_data)}명")

# ═══════════════════════════════════════
# 2. 오라클 패키지 + 선불금
# ═══════════════════════════════════════
print("2. 오라클 데이터 추출 중...")
import oracledb
oracledb.init_oracle_client(lib_dir=r"C:\Users\TP005\instantclient_21_15")
conn = oracledb.connect(user="housewaxing", password="oracle", dsn="googlea.withbiz.co.kr:5063/ORA11GHW")
cur = conn.cursor()

def normalize_pkg(name):
    n = name.replace("패키지권","").replace("패키지","").strip()
    n = re.sub(r'\d+$', '', n).strip()
    return n

# 2a. 패키지 (ORDERDETAIL)
cur.execute("""
    SELECT o.MEMNO, s.FIRSTNAME, s.OPKGC, o.ORDERDATE, o.BRANCHNO
    FROM ORDERS o JOIN ORDERDETAIL d ON d.ORDERNO = o.NO
    JOIN SERVICE s ON d.SRVNO = s.NO
    WHERE s.SRVDIV = 'PACK' ORDER BY o.MEMNO, o.ORDERDATE
""")
pkg_events = defaultdict(list)
for memno, svcname, opkgc, orderdate, branchno in cur.fetchall():
    key = (memno, normalize_pkg(svcname))
    if opkgc and opkgc > 0:
        pkg_events[key].append((orderdate, "buy", opkgc, branchno))
    else:
        pkg_events[key].append((orderdate, "use", 1, branchno))

oracle_by_memno = defaultdict(list)
for (memno, pkg_type), evts in pkg_events.items():
    evts.sort(key=lambda x: x[0])
    bought = sum(e[2] for e in evts if e[1] == "buy")
    used = sum(e[2] for e in evts if e[1] == "use")
    remain = bought - used
    if remain <= 0:
        continue
    buy_evts = [e for e in evts if e[1] == "buy"]
    use_evts = [e for e in evts if e[1] == "use"]
    last_buy = buy_evts[-1][0] if buy_evts else None
    last_use = use_evts[-1][0] if use_evts else None
    base_date = last_use if last_use else last_buy
    if base_date and (today - base_date).days > 730:
        continue
    branch = buy_evts[-1][3] if buy_evts else None
    oracle_by_memno[str(memno)].append({
        "type": "package", "pkg_type": pkg_type, "bought": bought, "used": used,
        "remain": remain, "last_buy": last_buy.strftime("%Y-%m-%d") if last_buy else None,
        "last_use": last_use.strftime("%Y-%m-%d") if last_use else None,
        "branch": BRANCH_MAP.get(branch, str(branch) if branch else "")
    })

# 2b. 선불금 (ORDERS.NOTE)
cur.execute("""
    SELECT o.MEMNO, m.NAME, m.TEL, o.ORDERDATE, o.NOTE, o.BRANCHNO
    FROM ORDERS o JOIN MEMBER m ON o.MEMNO = m.NO
    WHERE o.NOTE LIKE '%잔여%' OR o.NOTE LIKE '%다담%' OR o.NOTE LIKE '%선불%'
    ORDER BY o.MEMNO, o.ORDERDATE DESC
""")
seen_prepaid = set()
for memno, name, tel, dt, note, branch in cur.fetchall():
    if memno in seen_prepaid:
        continue
    seen_prepaid.add(memno)
    matches = re.findall(r'잔여[금액:\s]*([0-9,.]+)', note or "")
    if matches:
        amt_str = matches[-1].replace(",", "").replace(".", "").strip()
        try:
            amt = int(amt_str)
            if amt > 0 and dt and (today - dt).days <= 730:
                oracle_by_memno[str(memno)].append({
                    "type": "prepaid", "pkg_type": "다담권", "remain": amt,
                    "last_use": dt.strftime("%Y-%m-%d"),
                    "branch": BRANCH_MAP.get(branch, str(branch) if branch else ""),
                    "memo": (note or "")[:100]
                })
        except:
            pass

# 오라클 고객 정보
all_memnos = list(set(
    list(k for k in oracle_by_memno.keys()) +
    list(memo_data.keys())
))
oracle_mem = {}
for i in range(0, len(all_memnos), 500):
    batch = [m for m in all_memnos[i:i+500] if m.isdigit()]
    if not batch:
        continue
    cur.execute(f"SELECT NO, NAME, TEL FROM MEMBER WHERE NO IN ({','.join(batch)})")
    for r in cur.fetchall():
        oracle_mem[str(r[0])] = {"name": r[1], "tel": r[2]}

print(f"   오라클 패키지: {sum(len(v) for v in oracle_by_memno.values())}건, {len(oracle_by_memno)}명")

cur.close()
conn.close()

# ═══════════════════════════════════════
# 3. 블리스 customer_packages + customers
# ═══════════════════════════════════════
print("3. 블리스 데이터 조회 중...")
bliss_custs = {}
offset = 0
while True:
    r = requests.get(f"{SB_URL}/rest/v1/customers?select=id,name,phone,cust_num&business_id=eq.{BIZ_ID}&offset={offset}&limit=1000",
                     headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}, timeout=15)
    batch = r.json() if r.ok else []
    if not batch: break
    for c in batch:
        if c.get("cust_num"):
            bliss_custs[c["cust_num"]] = c
    offset += len(batch)
    if len(batch) < 1000: break

bliss_pkgs_raw = []
offset = 0
while True:
    r = requests.get(f"{SB_URL}/rest/v1/customer_packages?select=*&business_id=eq.{BIZ_ID}&offset={offset}&limit=1000",
                     headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}, timeout=15)
    batch = r.json() if r.ok else []
    if not batch: break
    bliss_pkgs_raw.extend(batch)
    offset += len(batch)
    if len(batch) < 1000: break

# cust_id → cust_num 매핑
cust_id_to_num = {c["id"]: c["cust_num"] for c in bliss_custs.values()}
bliss_by_custnum = defaultdict(list)
for p in bliss_pkgs_raw:
    cust_num = cust_id_to_num.get(p.get("customer_id"), "")
    if not cust_num:
        continue
    total = p.get("total_count", 0) or 0
    used = p.get("used_count", 0) or 0
    bliss_by_custnum[cust_num].append({
        "id": p["id"], "svc_name": p.get("service_name", ""),
        "total": total, "used": used, "remain": total - used,
        "note": p.get("note", "")[:100]
    })

print(f"   블리스 패키지: {len(bliss_pkgs_raw)}건, 고객: {len(bliss_by_custnum)}명")

# ═══════════════════════════════════════
# 4. 3소스 병합
# ═══════════════════════════════════════
print("4. 3소스 병합 중...")
all_cust_nums = set(memo_data.keys()) | set(oracle_by_memno.keys()) | set(bliss_by_custnum.keys())

rows = []
for cust_num in all_cust_nums:
    memo = memo_data.get(cust_num, {})
    oracle_pkgs = oracle_by_memno.get(cust_num, [])
    bliss_pkgs = bliss_by_custnum.get(cust_num, [])

    # 3소스 모두 비어있으면 스킵
    memo_pkgs = memo.get("packages", [])
    if not memo_pkgs and not oracle_pkgs and not bliss_pkgs:
        continue

    # 고객 정보 (메모 > 오라클 > 블리스 순으로)
    cust_name = memo.get("name", "")
    cust_phone = ""
    cust_id = ""
    if not cust_name:
        om = oracle_mem.get(cust_num, {})
        cust_name = om.get("name", "")
        cust_phone = om.get("tel", "")
    if cust_num in bliss_custs:
        bc = bliss_custs[cust_num]
        if not cust_name: cust_name = bc.get("name", "")
        if not cust_phone: cust_phone = bc.get("phone", "")
        cust_id = bc.get("id", "")
    if not cust_phone:
        om = oracle_mem.get(cust_num, {})
        cust_phone = om.get("tel", "")

    # 지점 추정 (오라클 패키지에서)
    branch = ""
    for op in oracle_pkgs:
        if op.get("branch"):
            branch = op["branch"]
            break
    if not branch:
        for bp in bliss_pkgs:
            note = bp.get("note", "")
            for br_name in ["강남", "왕십리", "홍대", "잠실", "마곡", "용산", "위례", "천호"]:
                if br_name in note:
                    branch = br_name + "점"
                    break
            if branch: break

    rows.append({
        "id": f"pa_{cust_num}",
        "business_id": BIZ_ID,
        "cust_num": cust_num,
        "cust_name": cust_name,
        "cust_phone": cust_phone,
        "cust_id": cust_id,
        "branch": branch,
        "memo_packages": json.dumps(memo_pkgs, ensure_ascii=False) if memo_pkgs else "[]",
        "oracle_packages": json.dumps(oracle_pkgs, ensure_ascii=False) if oracle_pkgs else "[]",
        "bliss_packages": json.dumps(bliss_pkgs, ensure_ascii=False) if bliss_pkgs else "[]",
        "status": "pending"
    })

print(f"   병합 결과: {len(rows)}명")

# ═══════════════════════════════════════
# 5. Supabase 업로드
# ═══════════════════════════════════════
print("5. pkg_audit 테이블 업로드 중...")
batch_size = 200
uploaded = 0
for i in range(0, len(rows), batch_size):
    batch = rows[i:i+batch_size]
    r = requests.post(f"{SB_URL}/rest/v1/pkg_audit", headers=SB_HEADERS, json=batch, timeout=30)
    if r.ok:
        uploaded += len(batch)
    else:
        print(f"   ERROR batch {i}: {r.status_code} {r.text[:200]}")
    if i > 0 and i % 1000 == 0:
        print(f"   {uploaded}/{len(rows)}...")
    time.sleep(0.1)

print(f"\n완료: {uploaded}/{len(rows)}건 업로드")

# 통계
has_memo = sum(1 for r in rows if r["memo_packages"] != "[]")
has_oracle = sum(1 for r in rows if r["oracle_packages"] != "[]")
has_bliss = sum(1 for r in rows if r["bliss_packages"] != "[]")
print(f"\n메모 있음: {has_memo}명")
print(f"오라클 있음: {has_oracle}명")
print(f"블리스 있음: {has_bliss}명")
