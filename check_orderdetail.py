import oracledb, os, sys
os.environ['NLS_LANG'] = 'KOREAN_KOREA.KO16MSWIN949'
sys.stdout.reconfigure(encoding='utf-8')
oracledb.init_oracle_client(lib_dir=r'C:\oracle\instantclient_23_7')
con = oracledb.connect(user='housewaxing', password='oracle', dsn='googlea.withbiz.co.kr:5063/ORA11GHW')
cur = con.cursor()

# 컬럼 목록
cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME='ORDERDETAIL' ORDER BY COLUMN_ID")
print("=== COLUMNS ===")
for r in cur.fetchall():
    print(f"  {r[0]:20s} {r[1]}")

# 총 건수
cur.execute("SELECT COUNT(*) FROM ORDERDETAIL")
print(f"\n총 건수: {cur.fetchone()[0]}")

# 샘플 5건
# SERVICE 테이블 확인
cur.execute("SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME='SERVICE' ORDER BY COLUMN_ID")
print("\n=== SERVICE COLUMNS ===")
for r in cur.fetchall():
    print(f"  {r[0]}")

# 샘플: ORDERDETAIL + SERVICE JOIN
cur.execute("""
    SELECT d.ORDERNO, d.SRVNO, s.FIRSTNAME||' '||s.SECONDNAME AS SNAME, d.CASH, d.CARD, d.BANK, d.SRVCNT, d.POINT
    FROM ORDERDETAIL d LEFT JOIN SERVICE s ON d.SRVNO = s.NO
    WHERE d.ORDERNO >= (SELECT MAX(NO)-5 FROM ORDERS)
    ORDER BY d.ORDERNO DESC
""")
print("\n=== SAMPLE (ORDERNO|SRVNO|SRV_NAME|CASH|CARD|BANK|CNT|POINT) ===")
for r in cur.fetchall():
    print(" | ".join(str(x)[:30] for x in r))

# ORDERS와 ORDERDETAIL 연결 확인
cur.execute("SELECT COUNT(DISTINCT ORDERNO) FROM ORDERDETAIL")
print(f"\nORDERDETAIL의 고유 ORDERNO 수: {cur.fetchone()[0]}")

con.close()
