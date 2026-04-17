"""
Oracle → Supabase 전체 백업 (읽기 전용 아카이브)
- 10개 테이블을 oracle_* 접두사 테이블로 전량 upsert
- --generate-sql: Supabase CREATE TABLE SQL 출력 (먼저 실행)
- --table TABLE: 특정 테이블만 전송
- --resume TABLE:LAST_NO: 대형 테이블 재개
"""
import oracledb, os, json, sys, urllib.request, time
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

# === Oracle ===
os.environ['NLS_LANG'] = 'KOREAN_KOREA.KO16MSWIN949'
oracledb.init_oracle_client(lib_dir=r'C:\oracle\instantclient_23_7')

ORA_DSN  = 'googlea.withbiz.co.kr:5063/ORA11GHW'
ORA_USER = 'housewaxing'
ORA_PASS = 'oracle'

# === Supabase ===
SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
SB_KEY = "sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj"

# === 테이블 설정 (이름, 배치크기, PK컬럼) ===
TABLE_CONFIG = [
    ("SERVICE",      500, None),   # NO 중복 213건 → TRUNCATE+INSERT
    ("GIFTCERT",     500, "NO"),
    ("BOOKING",      500, "NO"),
    ("POINT",        500, None),   # NO 중복 1건 → TRUNCATE+INSERT
    ("BANKACCOUNT",  500, "NO"),
    ("MEMBER",       300, "NO"),
    ("ORDERS",       300, "NO"),
    ("ORDERDETAIL",  300, None),   # NO 컬럼 없음 → TRUNCATE+INSERT
    ("MESSAGE",      200, "NO"),
    ("SMSRESULT",    200, "NO"),
]

# Oracle→PostgreSQL 타입 매핑
def ora_to_pg(data_type, precision, scale):
    dt = data_type.upper()
    if dt == "NUMBER":
        if scale and scale > 0:
            return "numeric"
        return "bigint"
    return "text"

# === Oracle 헬퍼 ===
def get_table_columns(cur, table_name):
    """ALL_TAB_COLUMNS에서 컬럼 정보 조회"""
    cur.execute("""
        SELECT COLUMN_NAME, DATA_TYPE, DATA_PRECISION, DATA_SCALE
        FROM ALL_TAB_COLUMNS
        WHERE TABLE_NAME = :tn AND OWNER = UPPER(:owner)
        ORDER BY COLUMN_ID
    """, tn=table_name.upper(), owner=ORA_USER)
    return [(r[0], r[1], r[2], r[3]) for r in cur.fetchall()]

def get_row_count(cur, table_name):
    cur.execute(f"SELECT COUNT(*) FROM {table_name}")
    return cur.fetchone()[0]

# === 값 변환 ===
def convert_value(val):
    if val is None:
        return None
    # LOB 객체
    if hasattr(val, 'read'):
        try:
            content = val.read()
            if isinstance(content, bytes):
                try:
                    return content.decode('utf-8')
                except:
                    try:
                        return content.decode('euc-kr')
                    except:
                        return content.hex()
            return str(content) if content else None
        except:
            return None
    # datetime
    if isinstance(val, datetime):
        return val.strftime('%Y-%m-%d %H:%M:%S')
    # bytes
    if isinstance(val, bytes):
        try:
            return val.decode('utf-8')
        except:
            try:
                return val.decode('euc-kr')
            except:
                return val.hex()
    # int/float
    if isinstance(val, (int, float)):
        return val
    return str(val)

# === Supabase 헬퍼 ===
def sb_upsert(table, rows, retry=3):
    url = f"{SB_URL}/rest/v1/{table}"
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=merge-duplicates"
    }
    body = json.dumps(rows, ensure_ascii=False, default=str).encode('utf-8')
    for attempt in range(retry):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, None
        except urllib.error.HTTPError as e:
            err = e.read().decode()[:300]
            if attempt < retry - 1:
                time.sleep(1 * (attempt + 1))
                continue
            return e.code, err
        except Exception as e:
            if attempt < retry - 1:
                time.sleep(1 * (attempt + 1))
                continue
            return 0, str(e)[:300]

def sb_insert(table, rows, retry=3):
    """PK 없는 테이블용 — 단순 INSERT (upsert 아님)"""
    url = f"{SB_URL}/rest/v1/{table}"
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    body = json.dumps(rows, ensure_ascii=False, default=str).encode('utf-8')
    for attempt in range(retry):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, None
        except urllib.error.HTTPError as e:
            err = e.read().decode()[:300]
            if attempt < retry - 1:
                time.sleep(1 * (attempt + 1))
                continue
            return e.code, err
        except Exception as e:
            if attempt < retry - 1:
                time.sleep(1 * (attempt + 1))
                continue
            return 0, str(e)[:300]

def sb_truncate(table):
    """테이블 전체 삭제 (TRUNCATE 대용 — REST API에서는 DELETE)"""
    url = f"{SB_URL}/rest/v1/{table}?_synced_at=not.is.null"
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Prefer": "return=minimal"
    }
    try:
        req = urllib.request.Request(url, headers=headers, method="DELETE")
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        print(f"  TRUNCATE ERROR: {e.code} {e.read().decode()[:200]}")
        return e.code

# === SQL 생성 모드 ===
def generate_sql(cur):
    print("-- Oracle → Supabase 전체 백업 테이블 생성 SQL")
    print("-- Supabase SQL Editor에서 실행하세요\n")

    for table_name, _, pk_col in TABLE_CONFIG:
        cols = get_table_columns(cur, table_name)
        if not cols:
            print(f"-- WARNING: {table_name} 컬럼 없음 (테이블 존재하지 않음?)\n")
            continue

        target = f"oracle_{table_name.lower()}"
        row_count = get_row_count(cur, table_name)
        print(f"-- {table_name} ({row_count:,} rows, {len(cols)} columns)")
        print(f"CREATE TABLE IF NOT EXISTS {target} (")

        col_defs = []
        has_pk = False
        for col_name, data_type, precision, scale in cols:
            pg_type = ora_to_pg(data_type, precision, scale)
            cn = col_name.lower()
            if pk_col and cn == pk_col.lower():
                col_defs.append(f'  "{cn}" {pg_type} PRIMARY KEY')
                has_pk = True
            else:
                col_defs.append(f'  "{cn}" {pg_type}')

        if not has_pk:
            col_defs.insert(0, f'  "_rownum" bigserial PRIMARY KEY')

        col_defs.append('  "_synced_at" timestamptz DEFAULT now()')
        print(",\n".join(col_defs))
        print(");\n")

        # RLS
        print(f"ALTER TABLE {target} ENABLE ROW LEVEL SECURITY;")
        print(f"CREATE POLICY \"allow_all_{target}\" ON {target} FOR ALL USING (true);")
        print(f"-- ON CONFLICT: {pk_col}")
        print()

    print("-- 실행 완료 후 python oracle_full_backup.py 로 데이터 전송")

# === 데이터 전송 ===
def sync_table(cur, table_name, batch_size, pk_col, resume_after=None):
    cols = get_table_columns(cur, table_name)
    if not cols:
        print(f"  ❌ {table_name}: 컬럼 정보 없음")
        return 0, 0

    col_names = [c[0] for c in cols]
    col_list = ", ".join(col_names)
    target = f"oracle_{table_name.lower()}"
    total = get_row_count(cur, table_name)

    # PK 없는 테이블 (ORDERDETAIL) → truncate + insert
    use_insert = pk_col is None

    if use_insert:
        print(f"  🗑️ TRUNCATE (PK 없음 → 전체 재삽입)")
        sb_truncate(target)
        time.sleep(1)

    # resume
    where = ""
    if not use_insert and resume_after is not None and pk_col.upper() in [c.upper() for c in col_names]:
        where = f" WHERE {pk_col} > {resume_after}"
        print(f"  ⏩ Resume: {pk_col} > {resume_after}")

    order = f" ORDER BY {pk_col}" if pk_col and pk_col.upper() in [c.upper() for c in col_names] else ""
    sql = f"SELECT {col_list} FROM {table_name}{where}{order}"

    cur2 = cur.connection.cursor()
    cur2.arraysize = max(batch_size, 500)
    cur2.execute(sql)

    synced = 0
    failed = 0
    batch = []
    start = time.time()
    last_no = None

    for row in cur2:
        row_dict = {}
        for i, val in enumerate(row):
            cn = col_names[i].lower()
            row_dict[cn] = convert_value(val)
            if pk_col and cn == pk_col.lower():
                last_no = row_dict[cn]
        batch.append(row_dict)

        if len(batch) >= batch_size:
            if use_insert:
                status, err = sb_insert(target, batch)
            else:
                status, err = sb_upsert(target, batch)
            if status in (200, 201):
                synced += len(batch)
            else:
                failed += len(batch)
                print(f"  ⚠️ 배치 실패 ({status}): {err}")
            batch = []

            # 진행률
            if synced % 10000 < batch_size or synced == batch_size:
                elapsed = time.time() - start
                pct = synced / total * 100 if total else 0
                rate = synced / elapsed if elapsed > 0 else 0
                remain = (total - synced) / rate if rate > 0 else 0
                pk_info = f" | last_{pk_col}={last_no}" if pk_col else ""
                print(f"  📊 {synced:,}/{total:,} ({pct:.1f}%) | {elapsed:.0f}s경과 | ~{remain:.0f}s남음{pk_info}")

            time.sleep(0.05)

    # 잔여 배치
    if batch:
        if use_insert:
            status, err = sb_insert(target, batch)
        else:
            status, err = sb_upsert(target, batch)
        if status in (200, 201):
            synced += len(batch)
        else:
            failed += len(batch)
            print(f"  ⚠️ 잔여 배치 실패 ({status}): {err}")

    cur2.close()
    elapsed = time.time() - start
    return synced, failed, elapsed

# === 메인 ===
def main():
    args = sys.argv[1:]

    # Oracle 연결
    ora = oracledb.connect(user=ORA_USER, password=ORA_PASS, dsn=ORA_DSN)
    cur = ora.cursor()

    # --generate-sql 모드
    if "--generate-sql" in args:
        generate_sql(cur)
        cur.close()
        ora.close()
        return

    # --table 필터
    only_table = None
    for i, a in enumerate(args):
        if a == "--table" and i + 1 < len(args):
            only_table = args[i + 1].upper()

    # --resume TABLE:LAST_NO
    resume_map = {}
    for a in args:
        if a.startswith("--resume") or ":" in a:
            parts = a.replace("--resume=", "").replace("--resume ", "").strip()
            if ":" in parts:
                t, n = parts.split(":", 1)
                resume_map[t.upper()] = int(n)
        elif a == "--resume" and args.index(a) + 1 < len(args):
            nxt = args[args.index(a) + 1]
            if ":" in nxt:
                t, n = nxt.split(":", 1)
                resume_map[t.upper()] = int(n)

    print(f"=== Oracle 전체 백업 시작 ({datetime.now().strftime('%Y-%m-%d %H:%M')}) ===\n")

    results = []
    total_start = time.time()

    tables = TABLE_CONFIG
    if only_table:
        tables = [(t, b, p) for t, b, p in TABLE_CONFIG if t == only_table]
        if not tables:
            print(f"❌ 테이블 '{only_table}' 없음. 가능: {[t for t,_,_ in TABLE_CONFIG]}")
            return

    for table_name, batch_size, pk_col in tables:
        total = get_row_count(cur, table_name)
        print(f"▶ {table_name} ({total:,} rows, batch={batch_size})")

        resume_after = resume_map.get(table_name)
        synced, failed, elapsed = sync_table(cur, table_name, batch_size, pk_col, resume_after)
        results.append((table_name, total, synced, failed, elapsed))
        print(f"  ✅ {synced:,} synced / {failed:,} failed ({elapsed:.1f}s)\n")

    cur.close()
    ora.close()

    # 요약
    total_elapsed = time.time() - total_start
    print("=" * 60)
    print(f"{'테이블':<16} {'전체':>10} {'전송':>10} {'실패':>8} {'시간':>8}")
    print("-" * 60)
    total_rows = 0
    total_synced = 0
    total_failed = 0
    for name, total, synced, failed, elapsed in results:
        m, s = divmod(int(elapsed), 60)
        print(f"{name:<16} {total:>10,} {synced:>10,} {failed:>8,} {m:>3}:{s:02d}")
        total_rows += total
        total_synced += synced
        total_failed += failed
    print("-" * 60)
    m, s = divmod(int(total_elapsed), 60)
    print(f"{'TOTAL':<16} {total_rows:>10,} {total_synced:>10,} {total_failed:>8,} {m:>3}:{s:02d}")
    print(f"\n=== 완료 ({datetime.now().strftime('%H:%M')}) ===")

if __name__ == "__main__":
    main()
