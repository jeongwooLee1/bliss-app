"""ORDERDETAIL 누락분 재마이그레이션 — 새로 추가된 sales에 연결"""
import oracledb, os, sys, json, urllib.request, time
sys.stdout.reconfigure(encoding='utf-8')
os.environ['NLS_LANG'] = 'KOREAN_KOREA.KO16MSWIN949'
oracledb.init_oracle_client(lib_dir=r'C:\oracle\instantclient_23_7')
ora = oracledb.connect(user='housewaxing', password='oracle', dsn='googlea.withbiz.co.kr:5063/ORA11GHW')
cur = ora.cursor()
SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
SB_KEY = "sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj"
BIZ_ID = "biz_khvurgshb"

def sb_upsert(data):
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(f"{SB_URL}/rest/v1/sale_details", data=body,
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                 "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}, method="POST")
    try: urllib.request.urlopen(req, timeout=30); return True
    except Exception as e: print(f"  ❌ {e}"); return False

# 1. sale_map
print("[1] sales order_num → id...")
sale_map = {}
offset = 0
while True:
    req = urllib.request.Request(f"{SB_URL}/rest/v1/sales?select=id,order_num&business_id=eq.{BIZ_ID}&limit=1000&offset={offset}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    rows = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if not rows: break
    for r in rows:
        if r.get("order_num"): sale_map[str(r["order_num"])] = r["id"]
    offset += len(rows)
    if len(rows) < 1000: break
print(f"  {len(sale_map):,}개 매핑")

# 2. 기존 sale_details id 세트
print("[2] 기존 sale_details id...")
existing = set()
offset = 0
while True:
    req = urllib.request.Request(f"{SB_URL}/rest/v1/sale_details?select=id&business_id=eq.{BIZ_ID}&limit=1000&offset={offset}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    rows = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if not rows: break
    for r in rows: existing.add(r["id"])
    offset += len(rows)
    if len(rows) < 1000: break
print(f"  기존: {len(existing):,}건")

# 3. Oracle
print("[3] Oracle ORDERDETAIL 조회...")
cur.execute("""
    SELECT d.ORDERNO, d.SRVNO, NVL(s.FIRSTNAME,'')||' '||NVL(s.SECONDNAME,'') AS SNAME,
           s.PRICE, s.SEXDIV, d.CASH, d.CARD, d.BANK, d.SRVCNT, d.POINT,
           ROW_NUMBER() OVER (PARTITION BY d.ORDERNO ORDER BY d.SRVNO) AS RN
    FROM ORDERDETAIL d LEFT JOIN SERVICE s ON d.SRVNO = s.NO ORDER BY d.ORDERNO
""")
all_rows = cur.fetchall()
print(f"  {len(all_rows):,}건")

batch = []
inserted = 0
skipped_no_sale = 0
skipped_exists = 0
for row in all_rows:
    orderno, srvno, sname, price, sexdiv, cash, card, bank, srvcnt, point, rn = row
    did = f"sd_{orderno}_{rn}"
    if did in existing: skipped_exists += 1; continue
    sale_id = sale_map.get(str(orderno))
    if not sale_id: skipped_no_sale += 1; continue
    batch.append({"id": did, "business_id": BIZ_ID, "sale_id": sale_id, "order_num": str(orderno),
        "service_no": int(srvno) if srvno else None, "service_name": (sname or "").strip(),
        "unit_price": int(price) if price else 0, "qty": int(srvcnt) if srvcnt else 1,
        "cash": int(cash) if cash else 0, "card": int(card) if card else 0,
        "bank": int(bank) if bank else 0, "point": int(point) if point else 0,
        "sex_div": str(sexdiv) if sexdiv else None})
    if len(batch) >= 200:
        if sb_upsert(batch): inserted += len(batch)
        if inserted % 10000 == 0: print(f"  진행: +{inserted:,}")
        batch = []
if batch:
    if sb_upsert(batch): inserted += len(batch)
print(f"\n=== 완료: +{inserted:,}건 / 기존 {skipped_exists:,} / 매칭없음 {skipped_no_sale:,} ===")
ora.close()
