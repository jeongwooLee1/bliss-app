"""
Oracle ORDERS 전체 → Supabase sales 마이그레이션 (누락분 추가)
- 기존 sales에 이미 있는 order_num은 스킵
- cust_num으로 고객 매핑
"""
import oracledb, os, sys, json, urllib.request, time, random, string
from datetime import datetime
sys.stdout.reconfigure(encoding='utf-8')

os.environ['NLS_LANG'] = 'KOREAN_KOREA.KO16MSWIN949'
oracledb.init_oracle_client(lib_dir=r'C:\oracle\instantclient_23_7')
ora = oracledb.connect(user='housewaxing', password='oracle', dsn='googlea.withbiz.co.kr:5063/ORA11GHW')
cur = ora.cursor()

SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
SB_KEY = "sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj"
BIZ_ID = "biz_khvurgshb"

BRANCH_MAP = {
    9: "br_4bcauqvrb", 10: "br_wkqsxj6k1", 11: "br_l6yzs2pkq",
    20: "br_lfv2wgdf1", 30: "br_ybo3rmulv",
    40: "br_lfv2wgdf1", 50: "br_k57zpkbx1", 60: "br_ybo3rmulv",
    70: "br_g768xdu4w", 71: "br_xu60omgdf",
}
DEFAULT_BRANCH = "br_4bcauqvrb"

def gen_id():
    return "sale_" + ''.join(random.choices(string.ascii_lowercase + string.digits, k=9))

def sb_get(path):
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

def sb_upsert(table, rows):
    body = json.dumps(rows, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{table}", data=body,
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                 "Content-Type": "application/json",
                 "Prefer": "return=minimal,resolution=merge-duplicates"},
        method="POST")
    try:
        urllib.request.urlopen(req, timeout=30)
        return True
    except Exception as e:
        print(f"  ❌ {e}")
        try: print(f"  {e.read().decode()[:200]}")
        except: pass
        return False

print("=== Oracle ORDERS 전체 → Supabase sales 마이그레이션 ===\n")

# 1. 기존 sales의 order_num 세트 로드
print("[1] 기존 sales order_num 로드...")
existing = set()
offset = 0
while True:
    batch = sb_get(f"sales?select=order_num&business_id=eq.{BIZ_ID}&limit=1000&offset={offset}")
    if not batch: break
    for s in batch:
        if s.get("order_num"): existing.add(str(s["order_num"]))
    offset += len(batch)
    if len(batch) < 1000: break
print(f"  기존 매출: {len(existing):,}건")

# 2. 고객 매핑 (cust_num → id/name/phone/gender)
print("[2] 고객 매핑 로드...")
cust_map = {}
offset = 0
while True:
    batch = sb_get(f"customers?select=id,name,phone,gender,cust_num&business_id=eq.{BIZ_ID}&limit=1000&offset={offset}")
    if not batch: break
    for c in batch:
        if c.get("cust_num"): cust_map[int(c["cust_num"])] = c
    offset += len(batch)
    if len(batch) < 1000: break
print(f"  고객 매핑: {len(cust_map):,}명")

# 3. 담당자 매핑
cur.execute("SELECT NO, NAME FROM MEMBER WHERE MEMDIV = '관리자'")
mgr_map = {r[0]: r[1] for r in cur.fetchall()}

# 4. Oracle 전체 ORDERS 조회
print("[3] Oracle ORDERS 전체 조회...")
cur.execute("""
    SELECT NO, MEMNO, MGRNO, ORDERDATE, WAXCASH, WAXBANK, WAXCARD,
           PRODCASH, PRODBANK, PRODCARD, BRANCHNO, WAXPOINT, PRODPOINT,
           NOTE, ORDERDIV
    FROM ORDERS ORDER BY NO
""")
all_orders = cur.fetchall()
print(f"  Oracle 전체: {len(all_orders):,}건")

# 5. 누락분 삽입
print("[4] 누락분 삽입...")
new_sales = []
skipped = 0
for o in all_orders:
    (no, memno, mgrno, orderdate, waxcash, waxbank, waxcard,
     prodcash, prodbank, prodcard, branchno, waxpoint, prodpoint,
     note, orderdiv) = o
    if not orderdate: continue
    order_num = str(no)
    if order_num in existing:
        skipped += 1
        continue
    cust = cust_map.get(memno, {})
    bid = BRANCH_MAP.get(branchno, DEFAULT_BRANCH) if branchno else DEFAULT_BRANCH
    if bid is None: bid = DEFAULT_BRANCH
    new_sales.append({
        "id": gen_id(),
        "business_id": BIZ_ID,
        "bid": bid,
        "cust_id": cust.get("id", ""),
        "cust_name": cust.get("name", ""),
        "cust_phone": cust.get("phone", ""),
        "cust_gender": cust.get("gender", ""),
        "cust_num": str(memno) if memno else "",
        "staff_name": mgr_map.get(mgrno, ""),
        "date": orderdate.strftime("%Y-%m-%d"),
        "svc_cash": waxcash or 0, "svc_transfer": waxbank or 0,
        "svc_card": waxcard or 0, "svc_point": waxpoint or 0,
        "prod_cash": prodcash or 0, "prod_transfer": prodbank or 0,
        "prod_card": prodcard or 0, "prod_point": prodpoint or 0,
        "gift": 0, "order_num": order_num,
        "memo": (note or "").strip()[:500],
    })

print(f"  기존 스킵: {skipped:,}건, 신규: {len(new_sales):,}건")

BATCH = 200
inserted = 0
for i in range(0, len(new_sales), BATCH):
    batch = new_sales[i:i+BATCH]
    if sb_upsert("sales", batch):
        inserted += len(batch)
        if inserted % 5000 == 0:
            print(f"  진행: {inserted:,}건")
    time.sleep(0.05)

print(f"\n=== 완료: {inserted:,}건 삽입 ===")
ora.close()
