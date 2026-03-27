"""Oracle → Supabase 일일 동기화 (매출 + 고객)
매일 새벽 3시 자동 실행. 라이브 전환 시 제거."""
import oracledb, urllib.request, json, sys, re, random, string, time
sys.stdout.reconfigure(encoding='utf-8')
oracledb.init_oracle_client(lib_dir=r"C:\oracle\instantclient_23_7")

SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnRscnN1cXhxcWVvdXdiZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDU4MjQsImV4cCI6MjA4NzQ4MTgyNH0.iydEkjtPjZ0jXpUUPJben4IWWneDqLomv-HDlcFayE4"
H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}
HW = {**H, "Content-Type": "application/json", "Prefer": "return=minimal"}
BIZ = "biz_khvurgshb"

def uid(prefix=''):
    return prefix + ''.join(random.choices(string.ascii_lowercase + string.digits, k=11))

def sb_get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=H)) as r:
                return json.loads(r.read().decode('utf-8'))
        except:
            time.sleep(3)
    return []

def sb_post_batch(table, rows, batch=200):
    total = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i+batch]
        data = json.dumps(chunk, ensure_ascii=False, default=str).encode('utf-8')
        req = urllib.request.Request(f"{SB_URL}/rest/v1/{table}", data=data,
            headers={**HW, "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates,return=minimal"}, method="POST")
        try:
            with urllib.request.urlopen(req) as r:
                total += len(chunk)
        except:
            pass
    return total

print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 동기화 시작", flush=True)

# === 1. 매출 동기화 ===
existing_orders = set()
offset = 0
while True:
    rows = sb_get(f"{SB_URL}/rest/v1/sales?select=order_num&business_id=eq.{BIZ}&order=id&limit=1000&offset={offset}")
    for r in rows:
        if r.get('order_num'):
            existing_orders.add(str(r['order_num']))
    if len(rows) < 1000:
        break
    offset += 1000

phone_map = {}
offset = 0
while True:
    rows = sb_get(f"{SB_URL}/rest/v1/customers?select=id,phone&business_id=eq.{BIZ}&order=id&limit=1000&offset={offset}")
    for c in rows:
        p = re.sub(r'\D', '', c.get('phone', ''))
        if p:
            phone_map[p] = c['id']
    if len(rows) < 1000:
        break
    offset += 1000

branches = sb_get(f"{SB_URL}/rest/v1/branches?select=id,name&business_id=eq.{BIZ}")
branch_map = {b['name']: b['id'] for b in branches}

conn = oracledb.connect(user="housewaxing", password="oracle",
                        dsn="googlea.withbiz.co.kr:5063/ORA11GHW")
cur = conn.cursor()
cur.execute("""SELECT o.NO, o.MEMNO, m.NAME, o.ORDERDATE, o.NOTE,
    b.NAME, m.TEL, m.SEXDIV, mgr.NAME,
    o.WAXCASH, o.WAXBANK, o.WAXCARD, o.WAXPOINT,
    o.PRODCASH, o.PRODBANK, o.PRODCARD, o.PRODPOINT,
    o.GIFTCARD, o.GIFTCASH, o.GIFTBANK, o.GIFTPOINT
FROM ORDERS o LEFT JOIN MEMBER m ON o.MEMNO=m.NO
LEFT JOIN BRANCH b ON o.BRANCHNO=b.NO LEFT JOIN MEMBER mgr ON o.MGRNO=mgr.NO
WHERE o.ORDERDATE >= TRUNC(SYSDATE) - 3 ORDER BY o.NO DESC""")

new_sales = []
for r in cur.fetchall():
    ono = str(r[0])
    if ono in existing_orders:
        continue
    phone = re.sub(r'\D', '', str(r[6] or ''))
    if phone and not phone.startswith('0'):
        phone = '0' + phone
    d = r[3].strftime('%Y-%m-%d') if r[3] else ''
    bname = str(r[5] or '')
    bid = ''
    for bn, bv in branch_map.items():
        if bn in bname or bname in bn:
            bid = bv
            break
    g = 'F' if '여' in str(r[7] or '') else ('M' if '남' in str(r[7] or '') else '')
    new_sales.append({
        "id": f"sale_{uid()}", "business_id": BIZ, "bid": bid,
        "cust_id": phone_map.get(phone, ''), "cust_name": str(r[2] or ''),
        "cust_phone": phone, "cust_gender": g, "cust_num": str(r[1] or ''),
        "staff_name": str(r[8] or ''), "date": d,
        "svc_cash": int(r[9] or 0), "svc_transfer": int(r[10] or 0),
        "svc_card": int(r[11] or 0), "svc_point": int(r[12] or 0),
        "prod_cash": int(r[13] or 0), "prod_transfer": int(r[14] or 0),
        "prod_card": int(r[15] or 0), "prod_point": int(r[16] or 0),
        "gift": int(r[17] or 0) + int(r[18] or 0) + int(r[19] or 0) + int(r[20] or 0),
        "order_num": ono, "memo": str(r[4] or ''),
    })

n1 = sb_post_batch("sales", new_sales) if new_sales else 0
print(f"매출: {n1}건 추가", flush=True)

# === 2. 고객 동기화 ===
existing_phones = set()
offset = 0
while True:
    rows = sb_get(f"{SB_URL}/rest/v1/customers?select=phone&business_id=eq.{BIZ}&order=id&limit=1000&offset={offset}")
    for r in rows:
        p = re.sub(r'\D', '', r.get('phone', ''))
        if p:
            existing_phones.add(p)
    if len(rows) < 1000:
        break
    offset += 1000

default_bid = branches[0]['id'] if branches else ''
bmap2 = {}
for b in branches:
    for w in b['name'].replace('하우스왁싱 ', '').replace('점', '').split():
        bmap2[w] = b['id']

cur.execute("""SELECT m.NO, m.NAME, m.TEL, m.SEXDIV, m.MEMO, b.NAME
FROM MEMBER m LEFT JOIN BRANCH b ON TO_CHAR(m.BRANCHDIV)=TO_CHAR(b.NO) WHERE m.TEL IS NOT NULL""")

ok = 0
for r in cur.fetchall():
    phone = re.sub(r'\D', '', str(r[2] or ''))
    if not phone:
        continue
    if not phone.startswith('0'):
        phone = '0' + phone
    if phone in existing_phones:
        continue
    name = str(r[1] or '').strip()
    if not name:
        continue
    g = 'F' if '여' in str(r[3] or '') else ('M' if '남' in str(r[3] or '') else '')
    bname = str(r[5] or '')
    bid = default_bid
    for bn, bv in bmap2.items():
        if bn in bname:
            bid = bv
            break
    row = {"id": f"cust_{uid()}", "business_id": BIZ, "bid": bid, "name": name,
           "phone": phone, "gender": g, "memo": str(r[4] or ''), "cust_num": str(r[0] or '')}
    data = json.dumps([row], ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(f"{SB_URL}/rest/v1/customers", data=data,
        headers={**HW, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req):
            ok += 1
    except:
        pass
    existing_phones.add(phone)

conn.close()
print(f"고객: {ok}명 추가", flush=True)
print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 동기화 완료", flush=True)
