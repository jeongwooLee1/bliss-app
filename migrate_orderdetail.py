"""
Oracle ORDERDETAIL → Supabase sale_details 마이그레이션
- ORDERDETAIL + SERVICE JOIN으로 시술명 포함
- ORDERS.NO = sales.order_num 으로 sale_id 매핑
- 중복 제거 (ORDERNO+SRVNO 기준 DISTINCT)
"""
import oracledb, os, sys, json, urllib.request, time
sys.stdout.reconfigure(encoding='utf-8')

# === Oracle ===
os.environ['NLS_LANG'] = 'KOREAN_KOREA.KO16MSWIN949'
oracledb.init_oracle_client(lib_dir=r'C:\oracle\instantclient_23_7')
ora = oracledb.connect(user='housewaxing', password='oracle', dsn='googlea.withbiz.co.kr:5063/ORA11GHW')
cur = ora.cursor()

# === Supabase ===
SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
SB_KEY = "sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj"
BIZ_ID = "biz_khvurgshb"

def sb_post(path, data):
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(
        f"{SB_URL}{path}",
        data=body,
        headers={
            "apikey": SB_KEY,
            "Authorization": f"Bearer {SB_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal"
        },
        method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=30)
        return True
    except Exception as e:
        print(f"  ❌ DB 오류: {e}")
        try:
            print(f"  body: {e.read().decode()[:200]}")
        except:
            pass
        return False

# 1단계: 먼저 sale_details 테이블이 있는지 확인 (없으면 생성 안내)
print("=== Oracle ORDERDETAIL → Supabase sale_details 마이그레이션 ===")

# 2단계: sales 테이블에서 order_num → sale_id 매핑 로드
print("\n[1] sales order_num → id 매핑 로드...")
sale_map = {}  # order_num → sale_id
offset = 0
while True:
    req = urllib.request.Request(
        f"{SB_URL}/rest/v1/sales?select=id,order_num&business_id=eq.{BIZ_ID}&limit=1000&offset={offset}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}
    )
    resp = urllib.request.urlopen(req, timeout=30)
    rows = json.loads(resp.read())
    if not rows:
        break
    for r in rows:
        if r.get("order_num"):
            sale_map[str(r["order_num"])] = r["id"]
    offset += len(rows)
    if len(rows) < 1000:
        break
print(f"  매핑 로드 완료: {len(sale_map)}개 매출")

# 3단계: Oracle ORDERDETAIL + SERVICE 조회 (중복 제거)
print("\n[2] Oracle ORDERDETAIL 조회 중...")
cur.execute("""
    SELECT DISTINCT d.ORDERNO, d.SRVNO,
           NVL(s.FIRSTNAME,'') || ' ' || NVL(s.SECONDNAME,'') AS SNAME,
           s.PRICE, s.SEXDIV,
           d.CASH, d.CARD, d.BANK, d.SRVCNT, d.POINT
    FROM ORDERDETAIL d
    LEFT JOIN SERVICE s ON d.SRVNO = s.NO
    ORDER BY d.ORDERNO
""")

all_rows = cur.fetchall()
print(f"  조회 완료: {len(all_rows)}건 (DISTINCT)")

# 4단계: 배치 upsert
print("\n[3] Supabase sale_details upsert 시작...")
batch = []
inserted = 0
skipped = 0
batch_size = 200

for row in all_rows:
    orderno, srvno, sname, price, sexdiv, cash, card, bank, srvcnt, point = row
    sale_id = sale_map.get(str(orderno))
    if not sale_id:
        skipped += 1
        continue

    detail = {
        "id": f"sd_{orderno}_{srvno}",
        "business_id": BIZ_ID,
        "sale_id": sale_id,
        "order_num": str(orderno),
        "service_no": int(srvno) if srvno else None,
        "service_name": (sname or "").strip(),
        "unit_price": int(price) if price else 0,
        "qty": int(srvcnt) if srvcnt else 1,
        "cash": int(cash) if cash else 0,
        "card": int(card) if card else 0,
        "bank": int(bank) if bank else 0,
        "point": int(point) if point else 0,
        "sex_div": str(sexdiv) if sexdiv else None,
    }
    batch.append(detail)

    if len(batch) >= batch_size:
        if sb_post("/rest/v1/sale_details", batch):
            inserted += len(batch)
            if inserted % 5000 == 0:
                print(f"  진행: {inserted}건 / 스킵: {skipped}건")
        batch = []

# 나머지
if batch:
    if sb_post("/rest/v1/sale_details", batch):
        inserted += len(batch)

print(f"\n=== 완료 ===")
print(f"  총 조회: {len(all_rows)}건")
print(f"  삽입: {inserted}건")
print(f"  스킵 (매칭 안 됨): {skipped}건")

ora.close()
