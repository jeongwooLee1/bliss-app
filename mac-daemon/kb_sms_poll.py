#!/usr/bin/env python3
"""
Bliss KB SMS 폴링 데몬

목적
- ~/Library/Messages/chat.db에서 KB(국민은행) 입금 SMS 추출
- bank_deposits 테이블에 INSERT (UNIQUE 제약으로 중복 자동 무시)
- launchd로 60초 주기 실행

요구
- Full Disk Access (chat.db 읽기) — /usr/bin/python3에 부여
- ~/.bliss-kb-sync/ 에 state·로그 저장
"""
import os
import re
import json
import sqlite3
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from datetime import datetime, timezone, timedelta

# ─── 설정 ────────────────────────────────────────────
HOME = Path.home()
SCRIPT_DIR = Path(__file__).parent.resolve()
ENV_FILE = SCRIPT_DIR / '.env'
STATE_DIR = HOME / '.bliss-kb-sync'
STATE_FILE = STATE_DIR / 'state.json'
LOG_FILE = STATE_DIR / 'poll.log'
CHAT_DB = HOME / 'Library' / 'Messages' / 'chat.db'

KB_SENDER = '+8216449999'  # 국민은행 발신 번호
APPLE_EPOCH = 978307200    # 2001-01-01 UTC seconds (chat.db 시간 기준점)

STATE_DIR.mkdir(parents=True, exist_ok=True)


# ─── env 로드 ─────────────────────────────────────────
def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
SB_URL = ENV.get('SB_URL', 'https://dpftlrsuqxqqeouwbfjd.supabase.co')
SB_KEY = ENV.get('SB_KEY', '')
TG_TOKEN = ENV.get('TG_TOKEN', '')
TG_CHAT = ENV.get('TG_CHAT', '')
ACCOUNTS_JSON = ENV.get('BLISS_KB_ACCOUNTS', '{}')
try:
    ACCOUNTS = json.loads(ACCOUNTS_JSON)
except json.JSONDecodeError:
    ACCOUNTS = {}


# ─── 로깅 ─────────────────────────────────────────────
def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    try:
        with LOG_FILE.open('a') as f:
            f.write(line + '\n')
    except Exception:
        pass


def tg_alert(msg):
    if not TG_TOKEN or not TG_CHAT:
        return
    try:
        url = f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage'
        data = urllib.parse.urlencode(
            {'chat_id': TG_CHAT, 'text': f'[KB-Sync] {msg}'}
        ).encode()
        urllib.request.urlopen(url, data=data, timeout=10).read()
    except Exception as e:
        log(f'TG alert 실패: {e}')


# ─── State (last_rowid) ──────────────────────────────
def load_state():
    if not STATE_FILE.exists():
        return {'last_rowid': 0, 'last_run': None}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {'last_rowid': 0, 'last_run': None}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


# ─── KB SMS 파싱 ──────────────────────────────────────
# [Web발신]
# [KB]MM/DD HH:MM
# {계좌마스킹}
# {입금자명 or 가맹점}
# 입금|출금
# {금액}
# 잔액{잔액}
KB_PATTERN = re.compile(
    r'\[KB\]\s*(\d{2})/(\d{2})\s+(\d{2}):(\d{2})\s*\n+'
    r'([\w\*]+)\s*\n+'
    r'(.+?)\s*\n+'
    r'(입금|출금)\s*\n+'
    r'([\d,]+)\s*\n+'
    r'잔액\s*([\d,]+)',
    re.DOTALL,
)


def parse_kb_text(text):
    if not text:
        return None
    m = KB_PATTERN.search(text)
    if not m:
        return None
    _, _, _, _, masked, name, kind, amount_s, balance_s = m.groups()
    return {
        'account_masked': masked,
        'transferer_name': name.strip(),
        'kind': kind,
        'amount': int(amount_s.replace(',', '')),
        'balance': int(balance_s.replace(',', '')),
    }


# ─── chat.db 조회 ─────────────────────────────────────
def fetch_messages(min_rowid):
    if not CHAT_DB.exists():
        log(f'chat.db 없음: {CHAT_DB}')
        return []
    try:
        conn = sqlite3.connect(f'file:{CHAT_DB}?mode=ro', uri=True)
        cur = conn.execute(
            '''
            SELECT m.ROWID, m.text, m.date
            FROM message m
            JOIN handle h ON h.ROWID = m.handle_id
            WHERE m.ROWID > ?
              AND h.id = ?
              AND m.text IS NOT NULL
              AND m.text != ''
              AND m.is_from_me = 0
              AND m.item_type = 0
            ORDER BY m.ROWID ASC
            LIMIT 500
            ''',
            (min_rowid, KB_SENDER),
        )
        rows = cur.fetchall()
        conn.close()
        return rows
    except sqlite3.OperationalError as e:
        log(f'sqlite OperationalError (Full Disk Access?): {e}')
        tg_alert(f'chat.db 읽기 거부 — Full Disk Access 부여 필요')
        return []
    except sqlite3.Error as e:
        log(f'sqlite 에러: {e}')
        tg_alert(f'chat.db 읽기 실패: {e}')
        return []


# ─── Supabase INSERT ─────────────────────────────────
def insert_deposit(rec):
    """bank_deposits에 INSERT. UNIQUE 위반은 무시(ignore-duplicates)."""
    url = f'{SB_URL}/rest/v1/bank_deposits'
    headers = {
        'apikey': SB_KEY,
        'Authorization': f'Bearer {SB_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal',
    }
    data = json.dumps([rec]).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        urllib.request.urlopen(req, timeout=15)
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        log(f'INSERT 실패 [{e.code}]: {body[:200]}')
        return False
    except Exception as e:
        log(f'INSERT 에러: {e}')
        return False


# ─── 메인 ─────────────────────────────────────────────
def main():
    if not SB_KEY:
        log('SB_KEY 미설정 — .env 확인')
        return 1
    if not ACCOUNTS:
        log('BLISS_KB_ACCOUNTS 미설정 — .env 확인')
        return 1

    state = load_state()
    min_rowid = state.get('last_rowid', 0)
    rows = fetch_messages(min_rowid)
    if rows:
        log(f'조회: ROWID > {min_rowid} → {len(rows)}건')

    processed = 0
    inserted = 0
    skipped_unmatched = 0
    skipped_other_account = 0
    skipped_withdraw = 0
    max_rowid = min_rowid

    for rowid, text, raw_date in rows:
        max_rowid = max(max_rowid, rowid)

        parsed = parse_kb_text(text)
        if not parsed:
            skipped_unmatched += 1
            continue

        # 등록된 계좌만 (강남점 등 .env에 매핑)
        acct_cfg = ACCOUNTS.get(parsed['account_masked'])
        if not acct_cfg:
            skipped_other_account += 1
            continue

        # 입금만 (출금은 무시)
        if parsed['kind'] != '입금':
            skipped_withdraw += 1
            continue

        # chat.db 시간 (apple epoch ns → UTC datetime)
        try:
            ts = datetime.fromtimestamp(
                raw_date / 1_000_000_000 + APPLE_EPOCH, tz=timezone.utc
            )
        except (TypeError, OverflowError):
            ts = datetime.now(timezone.utc)

        rec = {
            'business_id': acct_cfg.get('business_id'),
            'bid': acct_cfg.get('branch_id'),
            'account_masked': parsed['account_masked'],
            'transferer_name': parsed['transferer_name'],
            'amount': parsed['amount'],
            'balance': parsed['balance'],
            'sms_sent_at': ts.isoformat(),
            'raw_text': text,
            'source': 'kb_sms',
        }
        if insert_deposit(rec):
            inserted += 1
            log(
                f'  + {parsed["transferer_name"]} '
                f'+{parsed["amount"]:,}원 '
                f'(잔액 {parsed["balance"]:,}) ROWID={rowid}'
            )
        processed += 1

    state['last_rowid'] = max_rowid
    state['last_run'] = datetime.now(timezone.utc).isoformat()
    save_state(state)

    if processed or inserted:
        log(
            f'결과: parsed={processed} inserted={inserted} '
            f'skipped(parse={skipped_unmatched}, other_acct={skipped_other_account}, '
            f'withdraw={skipped_withdraw}) max_rowid={max_rowid}'
        )

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
