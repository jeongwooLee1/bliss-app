"""
# restart: 2026-03-09 03:08 (session renewed)
bliss_naver.py — 네이버 예약 → Bliss 자동 동기화 (v3)

upsert 전략:
  - 존재하는 rid → Naver API 최신 데이터로 덮어씌움
  - Bliss에서 수동 설정한 필드(room_id, staff_id, cust_id)만 보존
    
중복 방지:
  - processed_mails.json: 재시작 후 재처리 방지
  - queued_set: 큐 중복 방지
  - 파싱 실패 시 processed에 추가 안 함 → 재시도 가능
"""

import imaplib, email, re, requests, json, logging, os, time, threading, string, random, smtplib, subprocess
try:
    from ai_booking import ai_booking_agent
except ImportError:
    ai_booking_agent = None
try:
    from flask import Flask as _Flask, request as _flask_req, make_response as _flask_app_make_response
    _FLASK_OK = True
except ImportError:
    _FLASK_OK = False
from datetime import datetime, timezone, timedelta
from queue import Queue, Empty
from email.header import decode_header
from email.mime.text import MIMEText
from playwright.sync_api import sync_playwright

# ─── 설정 ─────────────────────────────────────────────────────────────────────
SCRAPER_V          = "1.0.3"   # 서버 스크래퍼 버전 (server_logs에 기록됨)
GMAIL_USER         = "housewaxing@gmail.com"
GMAIL_APP_PASSWORD = "swqb mqhr qznp ljjd"
SUPABASE_URL       = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
SUPABASE_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
                      ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnRscnN1cXhxcWVvdXdiZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDU4MjQsImV4cCI6MjA4NzQ4MTgyNH0"
                      ".iydEkjtPjZ0jXpUUPJben4IWWneDqLomv-HDlcFayE4")
BUSINESS_ID        = "biz_khvurgshb"
SINCE_DATE         = "01-Jan-2025"
BEFORE_DATE        = None
TEST_BIZ_FILTER    = None

# ─── Telegram 알림 ────────────────────────────────────────────────────────────
import os as _os
GITHUB_TOKEN       = _os.environ.get("BLISS_GITHUB_TOKEN", "")
TELEGRAM_TOKEN     = _os.environ.get("BLISS_TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID   = _os.environ.get("BLISS_TELEGRAM_CHAT_ID", "5771685751")
GEMINI_KEY         = _os.environ.get("BLISS_GEMINI_KEY", "")
GEMINI_URL         = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
_gemini_429_until  = 0  # 429 쿨다운 만료 시각

# ─── 네이버톡톡 채널 → 지점 매핑 ──────────────────────────────────────────────
NAVER_TALK_ACCOUNTS = {
    "101171979": {"name": "강남본점",  "auth": "TZdZQdfDT3uOTHdgYdpf"},
    "102071377": {"name": "왕십리점", "auth": "87H7GIgaSiOv5mOMjOq5"},
    "101988152": {"name": "천호점",   "auth": "CPbcU6kSTgaJMNv/7fuW"},
    "101521969": {"name": "마곡점",   "auth": "VuRINHWwThSMXcHMBffT"},
    "101517367": {"name": "위례점",   "auth": "RjBzV0BQTEG2wR/1uSbL"},
    "101476019": {"name": "용산점",   "auth": "ljqsQyeMTgeHGM6Th6xg"},
    "102507795": {"name": "홍대점",   "auth": "KMeMdxQfQJ+TGkot8cwc"},
    "101522539": {"name": "잠실점",   "auth": "OqBLqN1ZSoilzeh9rtdm"},
    # 다른 지점은 추가 예정
}

from config import NAVER_ID, NAVER_PW, SESSION_FILE

# ─── 로깅 ─────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("bliss_naver")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# ─── 작업 큐 ──────────────────────────────────────────────────────────────────
task_queue: Queue = Queue()
queued_set: set   = set()
queued_lock       = threading.Lock()

# ─── AI 분석 큐 (스크래핑과 분리) ─────────────────────────────────────────────
ai_queue: Queue = Queue()

# ─── 세션 캐시 ────────────────────────────────────────────────────────────────
_session_cache: dict = {"cookies": None, "mtime": 0.0}

fail_counts: dict = {}
FAIL_COUNTS_FILE  = "fail_counts.json"
PROCESSED_FILE    = "processed_mails.json"

def load_fail_counts():
    global fail_counts
    try:
        if os.path.exists(FAIL_COUNTS_FILE):
            fail_counts = json.load(open(FAIL_COUNTS_FILE))
    except:
        fail_counts = {}

def save_fail_counts():
    try:
        json.dump(fail_counts, open(FAIL_COUNTS_FILE, "w"))
    except:
        pass

# ─── 영구 processed set ───────────────────────────────────────────────────────
_processed_persistent: set = set()

def load_processed():
    global _processed_persistent
    try:
        if os.path.exists(PROCESSED_FILE):
            _processed_persistent = set(str(x) for x in json.load(open(PROCESSED_FILE)))
            log.info(f"처리 기록 로드: {len(_processed_persistent)}건")
    except:
        _processed_persistent = set()

def save_processed(uid_str: str):
    _processed_persistent.add(uid_str)
    try:
        json.dump(list(_processed_persistent), open(PROCESSED_FILE, "w"))
    except:
        pass

def is_processed(uid) -> bool:
    return str(uid) in _processed_persistent

# ─── 캐시 ─────────────────────────────────────────────────────────────────────
_branches: dict = {}
_services: list = []

def load_cache():
    global _branches, _services
    r = requests.get(f"{SUPABASE_URL}/rest/v1/branches?select=*", headers=HEADERS, timeout=10)
    _branches = {b["naver_biz_id"]: b for b in r.json() if b.get("naver_biz_id")}
    r2 = requests.get(f"{SUPABASE_URL}/rest/v1/services?select=*&business_id=eq.{BUSINESS_ID}", headers=HEADERS, timeout=10)
    _services = r2.json() if r2.ok else []
    log.info(f"캐시 로드: 지점 {len(_branches)}개 / 서비스 {len(_services)}개")

# ─── 고객 매칭 ──────────────────────────────────────────────────────────────
def find_cust_by_phone(phone: str, business_id: str):
    """전화번호로 고객 조회 - 매칭되면 cust dict 반환, 없으면 None"""
    if not phone or len(phone) < 8:
        return None
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/customers?select=id,name,phone,gender,is_hidden&business_id=eq.{business_id}&phone=eq.{phone}&limit=1",
            headers=HEADERS, timeout=10
        )
        rows = r.json() if r.ok else []
        return rows[0] if rows else None
    except Exception as e:
        log.warning(f"고객 조회 실패: {e}")
        return None

# ─── Supabase helpers ─────────────────────────────────────────────────────────
def _gen_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=10))

# Bliss에서 수동으로 설정하는 필드 → Naver API로 덮어쓰지 않음
BLISS_PRESERVE_FIELDS = {
    "room_id",        # 타임라인에서 배정한 룸
    "staff_id",       # 담당 직원
    "cust_id",        # 고객 연동 ID
    "selected_tags",  # Bliss 서비스태그
    "memo",           # 직원 메모 (스크래퍼가 덮어쓰지 않음)
    "is_new_cust",    # 최초 등록 시에만 설정, 이후 덮어쓰지 않음
    "selected_services",  # AI 분석 결과, scrape이 덮어쓰지 않음
    "cust_gender",        # AI 분석 성별, scrape이 덮어쓰지 않음
    "prev_reservation_id", # 변경 원본 예약 ID, 덮어쓰지 않음
}

def update_last_scraped():
    """스크래핑 성공 시 server_logs.last_processed 갱신"""
    try:
        import socket
        local_ip = "unknown"
        try: local_ip = socket.gethostbyname(socket.getfqdn())
        except: pass
        server_label = "oracle(158.179.174.30)" if local_ip.startswith("10.0.0.") else "naver-sync(27.1.36.102)"
        server_id = f"bliss-naver-{server_label}"
        now_iso = datetime.utcnow().isoformat() + "Z"
        requests.post(
            f"{SUPABASE_URL}/rest/v1/server_logs",
            headers={**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "id": server_id,
                "server": server_label,
                "last_processed": now_iso,
                "scraper_status": "alive",
                "updated_at": now_iso,
            },
            timeout=5
        )
    except Exception as e:
        log.debug(f"last_processed 갱신 실패: {e}")


def db_upsert(rid: str, data: dict):
    # reservation_id(rid)를 단일 키로 사용
    # 이름/연락처 등 다른 필드는 일치 기준으로 사용하지 않음
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/reservations"
        f"?reservation_id=eq.{rid}"
        "&select=id,room_id,staff_id,cust_id,selected_tags",
        headers=HEADERS, timeout=10
    )
    existing = r.json()

    # ── Race condition 방어: naver_change_sync.py와 동시 실행 시 중복 INSERT 방지 ──
    if not existing:
        import time as _time
        _time.sleep(0.3)
        r2 = requests.get(
            f"{SUPABASE_URL}/rest/v1/reservations"
            f"?reservation_id=eq.{rid}"
            "&select=id,room_id,staff_id,cust_id,selected_tags",
            headers=HEADERS, timeout=10
        )
        existing = r2.json()
        if existing:
            log.info(f"  ⚡ #{rid} race-condition 감지: 재조회 후 기존 레코드 발견")

    if existing:
        # ── 업데이트: Naver API 최신 데이터로 전부 덮어씌움 ──
        row = existing[0]
        cur_status = row.get("status", "")
        new_status = data.get("status", "")

        # [보호1] DB=naver_cancelled → confirmed 재생성: 취소일시 있을 때만 차단
        if cur_status == "naver_cancelled" and new_status == "confirmed":
            cancelled_dt = (row.get("naver_cancelled_dt") or "").strip()
            if cancelled_dt:
                log.info(f"  ⏭  #{rid} 이미 naver_cancelled (취소일시:{cancelled_dt}) → confirmed 재생성 차단")
                return
            else:
                log.info(f"  ⚠️  #{rid} naver_cancelled이지만 취소일시 없음 → confirmed 복원 허용")

        # [보호2] DB=confirmed(확정됨) → naver_cancelled 덮어쓰기: cancelled_dt 없으면 차단
        # 네이버 API가 cancelled_datetime 없이 취소코드를 반환하는 오류 케이스 방어
        if cur_status == "confirmed" and new_status == "naver_cancelled":
            new_cancelled_dt = (data.get("naver_cancelled_dt") or "").strip()
            if not new_cancelled_dt:
                log.warning(f"  ⛔ #{rid} confirmed→naver_cancelled 차단: cancelled_dt 없음 (API 오류 의심)")
                # status와 cancelled_dt 필드만 제거하고 나머지(이름/시간 등)는 업데이트
                data = {k: v for k, v in data.items() if k not in ("status", "naver_cancelled_dt")}

        # [보호3] 타임스탬프 비교 - DB가 더 최신이면 status 덮어쓰기 차단
        # 메일을 오래된 것부터 처리해도 혹시 순서가 뒤바뀐 경우 방어
        def _parse_dt(s):
            if not s: return None
            try:
                from datetime import datetime
                s = s.strip()
                for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S"):
                    try: return datetime.strptime(s[:19], fmt[:len(fmt)])
                    except: pass
                return datetime.fromisoformat(s)
            except: return None

        db_confirmed_dt  = _parse_dt(row.get("naver_confirmed_dt",""))
        db_cancelled_dt  = _parse_dt(row.get("naver_cancelled_dt",""))
        new_confirmed_dt = _parse_dt(data.get("naver_confirmed_dt",""))
        new_cancelled_dt2= _parse_dt(data.get("naver_cancelled_dt",""))

        # DB 최신 이벤트 시각
        db_latest  = max(filter(None,[db_confirmed_dt, db_cancelled_dt]), default=None)
        new_latest = max(filter(None,[new_confirmed_dt, new_cancelled_dt2]), default=None)

        if db_latest and new_latest and new_latest < db_latest:
            log.info(f"  ⏭  #{rid} 스크래핑 데이터({new_latest.isoformat()[:16]})가 DB({db_latest.isoformat()[:16]})보다 오래됨 → status 보존")
            data = {k: v for k, v in data.items() if k not in ("status", "naver_cancelled_dt", "naver_confirmed_dt")}
        # PRESERVE_FIELDS는 Bliss에서 수동 설정한 값 보존
        # 단, cust_id가 비어있는 경우엔 스크래퍼 매칭값으로 채움
        existing_cust_id = (row.get("cust_id") or "").strip()
        update = {k: v for k, v in data.items() if k not in BLISS_PRESERVE_FIELDS}
        if not existing_cust_id and data.get("cust_id"):
            update["cust_id"] = data["cust_id"]
            update["is_new_cust"] = False
        # visit_count > 0 이면 신규 아님 - PRESERVE 무시하고 수정
        if data.get("visit_count", 0) > 0 and row.get("is_new_cust"):
            update["is_new_cust"] = False
            new_tag = next((t["id"] for t in (_load_ai_settings().get("tags") or []) if t.get("name") == "신규"), None)
            if new_tag:
                update["selected_tags"] = [t for t in (row.get("selected_tags") or []) if t != new_tag]
        if update:
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/reservations?id=eq.{row['id']}",
                headers=HEADERS, json=update, timeout=10
            )
            log.info(f"  ✅ #{rid} 업데이트")
        else:
            log.info(f"  ⏭  #{rid} 변경사항 없음")

    else:
        # ── 신규 등록 ──
        new_row = {
            "id":               _gen_id(),
            "business_id":      BUSINESS_ID,
            "type":             "reservation",
            "is_schedule":      False,
            "is_new_cust":      True,
            "selected_tags":    [],
            "repeat":           "none",
            "repeat_until":     "",
            "repeat_group_id":  "",
            "room_id":          "",
            "cust_id":          "",
            "staff_id":         "",
            "service_id":       "",
            "source":           "naver",
            "reservation_id":   rid,
            **data,
        }
        log.warning(f"  [DEBUG_INSERT] #{rid} new_row memo={new_row.get('memo','<NONE>')!r}")
        import traceback as _tb
        log.warning(f"  [MEMO_TRACE] memo={new_row.get('memo','<NONE>')!r}  keys={list(new_row.keys())}")
        _tb.print_stack()
        requests.post(f"{SUPABASE_URL}/rest/v1/reservations", headers=HEADERS, json=new_row, timeout=10)
        log.info(f"  ✅ #{rid} 신규 등록")

    update_last_scraped()


def db_cancel(rid: str):
    """취소 메일 처리: 이미 있으면 상태 변경, 없으면 스크래핑 후 취소 상태로 등록"""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/reservations?reservation_id=eq.{rid}&select=id,status",
        headers=HEADERS, timeout=10
    )
    rows = r.json()
    if rows:
        cur_status = rows[0].get("status", "")
        if cur_status == "naver_cancelled":
            log.info(f"  ⏭  #{rid} 이미 취소 상태")
            return
        from datetime import datetime, timezone, timedelta
        kst_now = datetime.now(timezone(timedelta(hours=9))).isoformat()
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/reservations?id=eq.{rows[0]['id']}",
            headers=HEADERS,
            json={"status": "naver_cancelled", "naver_cancelled_dt": kst_now},
            timeout=10
        )
        log.info(f"  ✅ #{rid} 취소 처리 (cancelled_dt={kst_now[:16]})")
    else:
        # DB에 없음 → 스크래핑해서 취소 상태로 저장 (취소 메일이 접수 메일보다 먼저 도착한 경우)
        log.warning(f"  #{rid} DB 없음 → 스크래핑 후 취소 등록")
        # scraper_thread에서 action=cancel로 처리하므로 여기선 최소 레코드만
        db_upsert(rid, {
            "status": "naver_cancelled",
            "bid": "", "date": "", "time": "", "dur": 0,
            "cust_name": "", "cust_phone": "", "cust_gender": "",
            "selected_services": [], "memo": "",
            "is_scraping_done": False,
        })


# ─── 이메일 ───────────────────────────────────────────────────────────────────
def _dmh(s: str) -> str:
    if not s: return ""
    parts = decode_header(s)
    out = []
    for b, enc in parts:
        if isinstance(b, bytes):
            out.append(b.decode(enc or "utf-8", errors="replace"))
        else:
            out.append(str(b))
    return "".join(out)

def _get_body(msg) -> str:
    plain = html = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            pl = part.get_payload(decode=True)
            if not pl: continue
            text = pl.decode(part.get_content_charset() or "utf-8", errors="replace")
            if ct == "text/plain" and not plain: plain = text
            elif ct == "text/html" and not html: html = text
    else:
        pl = msg.get_payload(decode=True)
        if pl:
            text = pl.decode(msg.get_content_charset() or "utf-8", errors="replace")
            if msg.get_content_type() == "text/plain": plain = text
            else: html = text
    return plain if plain else html

def _extract_rid(subj: str, body: str) -> str:
    """예약번호 추출 — 다양한 패턴. 변경 메일의 경우 신규예약내역 번호 우선"""
    # 변경 메일: 신규예약내역 섹션의 예약번호 우선 추출
    if "변경" in subj:
        m = re.search(r"신규예약내역.*?예약번호\s*[\|]?\s*(\d{7,12})", body, re.DOTALL)
        if m: return m.group(1)
        # 본문 앞부분(신규예약)의 첫 번째 예약번호
        m = re.search(r"예약번호\s*[\|]?\s*(\d{7,12})", body)
        if m: return m.group(1)

    patterns = [
        r"예약\s*번\s*호\s*[:\s]*(\d{7,12})",
        r"예약번호[:\s]*#?(\d{7,12})",
        r"bookingId[:\s=]*(\d{7,12})",
        r"booking_id[:\s=]*(\d{7,12})",
        r"/bookings/(\d{7,12})",
        r"#(\d{9,12})\b",
        r"\b(\d{10,12})\b",
    ]
    for pat in patterns[:4]:
        m = re.search(pat, subj)
        if m: return m.group(1)
    for pat in patterns:
        m = re.search(pat, body)
        if m: return m.group(1)
    return None

def _extract_old_rid(body: str) -> str:
    """변경 메일에서 구예약번호(예약히스토리내역) 추출"""
    # 예약히스토리내역 섹션의 예약번호
    m = re.search(r"예약히스토리내역.*?예약번호\s*[\|]?\s*(\d{7,12})", body, re.DOTALL)
    if m: return m.group(1)
    # 두 번째로 나오는 예약번호
    all_rids = re.findall(r"예약번호\s*[\|]?\s*(\d{7,12})", body)
    if len(all_rids) >= 2:
        return all_rids[1]
    return None

def _extract_biz_id(subj: str, body: str) -> str:
    """지점명으로 biz_id 추출 — 제목+본문 앞부분"""
    combined = subj + " " + body[:500]
    for nbid, br in _branches.items():
        short     = br.get("short", "")
        name      = br.get("name", "")
        short_base = short.replace("점", "")
        name_base  = re.sub(r"^하우스왁싱\s*", "", name)
        for kw in [short, name, short_base, name_base]:
            if kw and kw in combined:
                return nbid
    if len(_branches) == 1:
        return list(_branches.keys())[0]
    return None

def parse_email(subj: str, body: str):
    """메일 → (rid, biz_id, action, old_rid)"""
    rid    = _extract_rid(subj, body)
    biz_id = _extract_biz_id(subj, body)

    if   "변경" in subj: action = "change"   # 변경 메일에 "취소" 포함될 수 있으므로 먼저 체크
    elif "취소" in subj: action = "cancel"
    elif "확정" in subj: action = "confirm"
    elif any(w in subj for w in ("접수", "신규", "신청")): action = "new"
    else: action = "unknown"

    # 변경 메일: 구예약번호 추출
    old_rid = _extract_old_rid(body) if action == "change" else None

    return rid, biz_id, action, old_rid

# ─── Playwright helpers ───────────────────────────────────────────────────────

_relogin_lock = threading.Lock()
_last_relogin_attempt = 0
SESSION_EXPIRE_DETECTED = threading.Event()
_session_alert_sent = threading.Event()  # 중복 알림 방지

def send_session_alert(reason="자동 재로그인 실패"):
    """세션 만료/재로그인 실패 시 cripiss@naver.com으로 알림 발송 (1회)"""
    if _session_alert_sent.is_set():
        return
    _session_alert_sent.set()
    try:
        from datetime import datetime, timezone, timedelta
        kst = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")
        body = f"""[Bliss 네이버 동기화] 세션 알림

사유: {reason}
시각: {kst} KST

서버에 SSH 접속 후 VNC로 재로그인이 필요합니다:
  ssh -i oracle.key ubuntu@158.179.174.30
  vncserver :1 -geometry 1280x800 -depth 24
  DISPLAY=:1 python3 /home/ubuntu/naver-sync/login.py

재로그인 완료 후 systemctl restart bliss-naver 실행하세요.
"""
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = f"[Bliss] 네이버 세션 만료 알림 {kst}"
        msg["From"] = GMAIL_USER
        msg["To"] = "cripiss@naver.com"
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            s.sendmail(GMAIL_USER, ["cripiss@naver.com"], msg.as_string())
        log.info("📧 세션 만료 알림 발송 완료 → cripiss@naver.com")
    except Exception as e:
        log.error(f"  알림 발송 실패: {e}")

def auto_relogin():
    """세션 만료 시 알림만 발송 - 자동 재로그인 비활성화 (로컬에서 login_local.py 실행 필요)"""
    log.warning("🔴 네이버 세션 만료 - 자동 재로그인 비활성화")
    log.warning("   로컬 PC에서 login_local.py 를 실행하여 세션을 갱신해주세요.")
    send_session_alert("세션 만료 - 로컬 PC에서 login_local.py 실행 필요")
    return False

def _human_type(page, selector, text):
    el = page.query_selector(selector)
    if not el: return
    el.click(); time.sleep(0.2)
    for ch in text:
        page.type(selector, ch, delay=random.uniform(60, 160))

def _is_logged_in(page):
    url = page.url
    return "login" not in url and "nid.naver" not in url


# ─── 범용 네이버 폼 파싱 헬퍼 ─────────────────────────────────────────────────
def _parse_forms(snap, item):
    """
    네이버 예약 폼 응답 범용 파싱.
    업체/버전마다 다른 구조를 모두 커버:
    - snapshotJson.customFormInputJson  (일반적)
    - snapshotJson.questionFormInputJson (일부 업체)
    - item.customFormInputJson           (snapshotJson 없을 때)
    - JSON string / list 둘 다 처리
    - 키 조합: title/value, question/answer, label/input 등
    """
    def _extract(raw):
        if raw is None:
            return []
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                return []
        if not isinstance(raw, list):
            return []
        result = []
        TITLE_KEYS = ("title", "question", "label", "name", "questionTitle", "itemTitle")
        VALUE_KEYS = ("value", "answer", "input", "response", "userInput", "answerValue")
        for f in raw:
            if not isinstance(f, dict):
                continue
            title = next((f[k] for k in TITLE_KEYS if f.get(k)), None)
            value = next((f[k] for k in VALUE_KEYS if f.get(k)), None)
            if title and value:
                result.append({"title": str(title).strip(), "value": str(value).strip()})
        return result

    seen = set()
    combined = []
    for raw in [
        snap.get("customFormInputJson"),
        snap.get("questionFormInputJson"),
        snap.get("requestFormInputJson"),
        item.get("customFormInputJson"),
        item.get("questionFormInputJson"),
    ]:
        for entry in _extract(raw):
            key = (entry["title"], entry["value"])
            if key not in seen:
                seen.add(key)
                combined.append(entry)
    return combined



def _build_request_msg(raw: dict) -> str:
    """
    네이버 예약의 모든 항목을 JSON 배열로 저장.
    형식: [{"label": "시술메뉴", "value": "음모왁싱"}, ...]
    - 지점/예약마다 항목이 달라도 있는 그대로 저장
    - 주차 안내문 같은 운영 공지는 제외
    """
    import json as _json

    SKIP_PATTERNS = (
        "차량번호 기재",
        "주차장이 대부분 만차",
        "주차시간 예상하셔서",
    )

    items = []

    # 0. 상품명 (bizItemName)
    biz_item = (raw.get("biz_item_name") or "").strip()
    if biz_item:
        items.append({"label": "상품", "value": biz_item})

    # 1. 시술메뉴
    services = raw.get("services") or []
    if services:
        items.append({"label": "시술메뉴", "value": ", ".join(services)})

    # 2. 유입경로
    area = (raw.get("area_name") or "").strip()
    if area:
        items.append({"label": "유입경로", "value": area})

    # 3. 고객 직접 요청사항 (requestMessage) - 줄별로 파싱
    req = (raw.get("request_msg") or "").strip()
    if req:
        for line in req.split("\n"):
            line = line.strip()
            if not line:
                continue
            if any(p in line for p in SKIP_PATTERNS):
                colon_idx = line.rfind(": ")
                if colon_idx != -1:
                    answer = line[colon_idx + 2:].strip()
                    if answer:
                        items.append({"label": "주차여부", "value": answer})
            else:
                colon_idx = line.rfind(": ")
                if colon_idx != -1:
                    label = line[:colon_idx].strip()
                    value = line[colon_idx + 2:].strip()
                    if label and value:
                        items.append({"label": label, "value": value})
                else:
                    items.append({"label": "요청", "value": line})

    # 4. 폼 응답 (업체가 설정한 모든 질문)
    seen = set()
    for form in (raw.get("forms") or []):
        title = (form.get("title") or "").strip()
        value = (form.get("value") or "").strip()
        if not title or not value:
            continue
        key = (title, value)
        if key in seen:
            continue
        seen.add(key)
        # 이미 위에서 처리된 항목(시술메뉴, 유입경로 등) 중복 제거
        already = any(it["label"] == title and it["value"] == value for it in items)
        if already:
            continue
        if any(p in title for p in SKIP_PATTERNS):
            items.append({"label": "주차여부", "value": value})
        else:
            items.append({"label": title, "value": value})

    return _json.dumps(items, ensure_ascii=False)


# ─── Naver API 스크래핑 ────────────────────────────────────────────────────────
def scrape_reservation(biz_id: str, rid: str):
    from datetime import timezone, timedelta, datetime

    try:
        mtime = os.path.getmtime(SESSION_FILE)
        if _session_cache["cookies"] is None or _session_cache["mtime"] != mtime:
            session_data = json.load(open(SESSION_FILE))
            _session_cache["cookies"] = {c["name"]: c["value"] for c in session_data.get("cookies", [])}
            _session_cache["mtime"] = mtime
        cookies = _session_cache["cookies"]
    except Exception as e:
        log.error(f"  세션 로드 실패: {e}")
        return None

    url = f"https://partner.booking.naver.com/api/businesses/{biz_id}/bookings/{rid}"
    hdrs = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Referer": f"https://partner.booking.naver.com/bizes/{biz_id}/booking-list-view",
        "Accept": "application/json",
    }

    try:
        r = requests.get(url, cookies=cookies, headers=hdrs, timeout=15)
    except Exception as e:
        log.error(f"  API 요청 실패: {e}")
        return None

    if r.status_code in (401, 403):
        log.warning("  API 세션 만료 → 자동 재로그인 시도")
        if auto_relogin():
            # 재로그인 성공 → 세션 캐시 무효화 후 재시도
            _session_cache["cookies"] = None
            try:
                session_data2 = json.load(open(SESSION_FILE))
                cookies2 = {c["name"]: c["value"] for c in session_data2.get("cookies", [])}
                _session_cache["cookies"] = cookies2
                _session_cache["mtime"] = os.path.getmtime(SESSION_FILE)
                r2 = requests.get(url, cookies=cookies2, headers=hdrs, timeout=15)
                if r2.status_code == 200:
                    log.info("  ✅ 재로그인 후 재시도 성공")
                    # 이하 파싱 동일하게 처리
                    r = r2
                else:
                    log.warning(f"  재시도도 실패: {r2.status_code}")
                    return None
            except Exception as e:
                log.error(f"  재시도 오류: {e}")
                return None
        else:
            return None
    if r.status_code == 404:
        log.warning(f"  #{rid} 예약 없음 (404)")
        return None
    if r.status_code != 200:
        log.error(f"  API 오류: {r.status_code}")
        return None

    item = r.json()

    STATUS_MAP = {
        # AB: 예약 상태
        "AB00": "confirmed",
        "AB01": "pending",
        "AB02": "naver_cancelled",
        "AB03": "naver_cancelled",
        # RC: 결제 상태 (예약 취소 아님 → 전부 confirmed)
        "RC01": "pending",
        "RC02": "confirmed",   # 결제대기
        "RC03": "confirmed",   # 결제완료
        "RC04": "confirmed",   # 결제취소 (예약 유지)
        "RC06": "confirmed",   # 노쇼
        "RC08": "confirmed",   # 확정
    }
    bsc = item.get("bookingStatusCode", "")
    status = STATUS_MAP.get(bsc, "confirmed")
    log.info(f"  bookingStatusCode={bsc!r} → status={status}  cancelledDt={item.get('cancelledDateTime','')!r}")

    # 날짜/시간 UTC→KST
    start_date = item.get("startDate", "")
    start_time = ""
    snap = item.get("snapshotJson") or {}
    sdt = snap.get("startDateTime", "")
    if sdt:
        try:
            dt_utc = datetime.strptime(sdt[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
            dt_kst = dt_utc.astimezone(timezone(timedelta(hours=9)))
            start_date = dt_kst.strftime("%Y-%m-%d")
            start_time = dt_kst.strftime("%H:%M")
        except:
            pass

    # 서비스명
    services = []
    for opt in (item.get("bookingOptionJson") or []):
        nm = opt.get("name", "").strip()
        if nm: services.append(nm)
    if not services and item.get("bizItemName"):
        services.append(item["bizItemName"])

    return {
        "name":               item.get("name", ""),
        "phone":              item.get("phone", ""),
        "visitor_name":       item.get("visitorName", ""),
        "visitor_phone":      item.get("visitorPhone", ""),
        "has_visitor":        item.get("hasVisitor", False),
        "email":              item.get("email", ""),
        "date":               start_date,
        "time":               start_time,
        "status":             status,
        "services":           services,
        "deposit":            item.get("price", 0) or 0,
        "coupon_price":       item.get("couponPrice", 0) or 0,
        "refund_price":       item.get("refundPrice", 0) or 0,
        "is_npay":            item.get("isNPayUsed", False),
        "npay_method":        item.get("nPayChargedName", ""),
        # 선불결제: 결제수단(nPayChargedName)이 있으면 진짜 예약금
        "is_prepaid":         bool(item.get("nPayChargedName", "")),
        # total_price는 결제수단 있을 때만 저장
        "total_price":        (
            item.get("totalPrice", 0) or 0
            if item.get("nPayChargedName", "") else 0
        ),
        "request_msg":        item.get("requestMessage", ""),
        "owner_comment":      item.get("ownerCommentBody", ""),
        "is_completed":       item.get("isCompleted", False),
        "visit_count":        item.get("completedCount", 0),
        "no_show_count":      item.get("noShowCount", 0),
        "is_blacklist":       item.get("isBlacklist", False),
        "biz_item_name":      item.get("bizItemName", ""),
        "area_name":          item.get("areaName", ""),
        "forms":              _parse_forms(snap, item),
        "reg_datetime":       item.get("regDateTime", ""),
        "confirmed_datetime": item.get("confirmedDateTime", ""),
        "cancelled_datetime": item.get("cancelledDateTime", ""),
    }


# ─── 스크래퍼 스레드 ──────────────────────────────────────────────────────────

def _cancel_old_reservation(old_rid: str, new_rid: str = ""):
    """변경 시 구예약을 naver_changed로 처리 (멱등성 보장)"""
    try:
        old_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/reservations?reservation_id=eq.{old_rid}&select=id,status",
            headers=HEADERS, timeout=10
        )
        old_rows = old_r.json()
        if old_rows:
            old_status = old_rows[0].get("status", "")
            if old_status not in ("naver_changed", "cancelled"):
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/reservations?reservation_id=eq.{old_rid}",
                    headers={**HEADERS, "Prefer": "return=minimal"},
                    json={"status": "naver_changed"},
                    timeout=10
                )
                log.info(f"  🔄 변경: 구예약 #{old_rid} → naver_changed (새예약 #{new_rid})")
            else:
                log.info(f"  ⏭  구예약 #{old_rid} 이미 {old_status}")
        else:
            log.info(f"  ℹ️  구예약 #{old_rid} DB에 없음 (무시)")
    except Exception as e:
        log.error(f"  구예약 처리 오류: {e}")

def _process_one(rid, biz_id, action, old_rid):
    """예약 1건 처리. task_done()은 finally에서 정확히 1회 호출."""
    log.info(f"▶ #{rid}  biz={biz_id}  action={action}")

    with queued_lock:
        queued_set.discard(rid)

    try:

        # 변경 액션: 구예약 naver_changed 처리 (_proc_uid에서 이미 처리했지만 안전장치)
        if action == "change" and old_rid:
            _cancel_old_reservation(old_rid, rid)

        # 취소 액션: DB에 이미 있으면 바로 취소 처리 후 스크래핑 스킵
        # 접수(new) 액션이면 pending으로 강제 (API가 confirmed 반환해도)
        if action == "new":
            status = "pending"
        elif action == "cancel":
            try:
                existing_r = requests.get(
                    f"{SUPABASE_URL}/rest/v1/reservations?reservation_id=eq.{rid}&select=id,status",
                    headers=HEADERS, timeout=10
                )
                existing = existing_r.json()
                if existing:
                    db_cancel(rid)
                    return  # finally → task_done() 후 루프 continue
                # 없으면 아래 스크래핑으로 진행해서 저장 후 취소 상태로
            except Exception as e:
                log.error(f"  취소 확인 오류: {e}")
                return  # finally → task_done() 후 루프 continue

        # ── 스크래핑 ──
        raw = scrape_reservation(biz_id, rid)

        if not raw:
            fail_counts[rid] = fail_counts.get(rid, 0) + 1
            save_fail_counts()
            if fail_counts[rid] >= 3:
                log.warning(f"  #{rid} 3회 실패 → 영구 스킵")
            else:
                log.warning(f"  #{rid} 스크래핑 실패 ({fail_counts[rid]}/3)")
            return  # finally → task_done()

        # 성별 추론
        svc_str = " ".join(raw.get("services", []))
        gender = "M" if "남)" in svc_str else ("F" if "여)" in svc_str else "")

        # 지점 ID
        bid = ""
        for nbid, br in _branches.items():
            if str(nbid) == str(biz_id):
                bid = br.get("id", "")
                break
        if not bid:
            try:
                rb = requests.get(
                    f"{SUPABASE_URL}/rest/v1/branches?naver_biz_id=eq.{biz_id}&select=id",
                    headers=HEADERS, timeout=5
                )
                rows = rb.json()
                if rows:
                    bid = rows[0]["id"]
                    _branches[biz_id] = rows[0]
            except:
                pass

        # 상태 결정
        # 접수(new) 액션이면 pending으로 강제 (API가 confirmed 반환해도)
        if action == "new":
            status = "pending"
        elif action == "cancel":
            status = "naver_cancelled"
        else:
            status = raw.get("status", "confirmed")

        # 고객 전화번호로 기존 고객 조회
        phone = raw.get("phone", "")
        visit_count = raw.get("visit_count", 0)
        matched_cust = find_cust_by_phone(phone, BUSINESS_ID) if phone else None
        if matched_cust:
            matched_cust_id = matched_cust["id"]
            # 숨김 고객이면 자동 활성화 (예약 접수로 인한 복귀)
            try:
                if matched_cust.get("is_hidden"):
                    requests.patch(
                        f"{SUPABASE_URL}/rest/v1/customers?id=eq.{matched_cust_id}",
                        headers={**HEADERS, "Prefer": "return=minimal"},
                        json={"is_hidden": False},
                        timeout=10
                    )
                    log.info(f"  숨김 해제: {matched_cust.get(name,)} (예약 접수)")
            except Exception as e:
                log.warning(f"  숨김 해제 실패: {e}")
            is_new = False
            log.info(f"  고객 매칭: {matched_cust['name']} ({phone}) → cust_id={matched_cust_id}")
        else:
            matched_cust_id = None
            # 상품명에 "재방문" 포함되면 신규 아님 (네이버 API bookingCount가 0이어도)
            svc_names = " ".join(raw.get("services", []))
            biz_item_name = raw.get("biz_item_name", "")
            is_revisit = "재방문" in svc_names or "재방문" in biz_item_name
            is_new = visit_count == 0 and not is_revisit

        db_data = {
            "bid":                bid,
            "cust_id":            matched_cust_id or "",
            "cust_name":          raw.get("name", ""),
            "cust_phone":         raw.get("phone", ""),
            "visitor_name":       raw.get("visitor_name", ""),
            "visitor_phone":      raw.get("visitor_phone", ""),
            "cust_email":         raw.get("email", ""),
            "cust_gender":        gender,
            "date":               raw.get("date", ""),
            "time":               raw.get("time", ""),
            "dur":                45,
            "status":             status,
            "is_new_cust":        is_new,
            "request_msg":        _build_request_msg(raw),
            "owner_comment":      raw.get("owner_comment", ""),
            "is_prepaid":         raw.get("is_prepaid", False),
            "npay_method":        raw.get("npay_method", ""),
            "total_price":        raw.get("total_price", 0),
            "visit_count":        raw.get("visit_count", 0),
            "no_show_count":      raw.get("no_show_count", 0),
            "naver_reg_dt":       raw.get("reg_datetime", ""),
            "naver_confirmed_dt": raw.get("confirmed_datetime", ""),
            # cancelled_datetime이 없으면 현재 시각으로 채움 (빈값이면 "잘못된취소" 감지 로직에 걸림)
            "naver_cancelled_dt": raw.get("cancelled_datetime", "") if action == "cancel" else "",
            "prev_reservation_id": old_rid if action == "change" and old_rid else "",
            "is_scraping_done":   True,
        }

        db_upsert(rid, db_data)

        # AI 분석은 별도 큐로 위임 (스크래핑 블로킹 없음)
        ai_queue.put({
            "rid": rid,
            "request_msg": db_data.get("request_msg", ""),
            "owner_comment": db_data.get("owner_comment", ""),
            "cust_name": db_data.get("cust_name", ""),
            "visit_count": db_data.get("visit_count", 0),
            "is_prepaid": db_data.get("is_prepaid", False),
            "is_new_cust": db_data.get("is_new_cust", False),
        })

    except Exception as e:
        log.error(f"  #{rid} 처리 오류: {e}", exc_info=True)
    finally:
        task_queue.task_done()  # get() 이후 무조건 1회 호출


def scraper_thread():
    log.info("스크래퍼 스레드 시작")
    while True:
        try:
            rid, biz_id, action, old_rid = task_queue.get(timeout=5)
        except Empty:
            continue
        _process_one(rid, biz_id, action, old_rid)


def ai_thread():
    """AI 분석 전용 스레드 — 스크래핑과 독립적으로 실행"""
    log.info("AI 분석 스레드 시작")
    while True:
        try:
            job = ai_queue.get(timeout=5)
        except Empty:
            continue
        try:
            ai_analyze_reservation(**job)
            import time as _t; _t.sleep(4)  # Gemini rate limit 방지
        except Exception as e:
            log.error(f"  AI 분석 오류 #{job.get('rid')}: {e}")
        finally:
            ai_queue.task_done()


# ─── AI 자동 분석 ─────────────────────────────────────────────────────────────
_ai_settings_cache = {"key": None, "tags": None, "services": None, "loaded_at": 0}

def _load_ai_settings():
    """Supabase businesses.settings에서 OpenAI key 및 태그/서비스 목록 로드 (5분 캐시)"""
    import time
    now = time.time()
    if _ai_settings_cache["key"] and now - _ai_settings_cache["loaded_at"] < 300:
        return _ai_settings_cache

    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/businesses?id=eq.{BUSINESS_ID}&select=settings",
            headers=HEADERS, timeout=10
        )
        rows = r.json()
        cfg = {}
        try: cfg = json.loads((rows[0].get("settings") or "{}")) if rows else {}
        except: pass
        api_key_val = cfg.get("openai_key", "") or cfg.get("gemini_key", "") or cfg.get("system_gemini_key", "")  # openai_key 우선
        ai_rules   = cfg.get("ai_rules") or []  # 앱에서 등록한 커스텀 규칙
    except Exception as e:
        log.warning(f"AI settings 로드 실패: {e}")
        return _ai_settings_cache

    if not api_key_val:
        return _ai_settings_cache

    # 태그/서비스 목록 로드
    try:
        tags_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/service_tags?business_id=eq.{BUSINESS_ID}&use_yn=eq.true&schedule_yn=eq.false&select=id,name",
            headers=HEADERS, timeout=10
        )
        svcs_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/services?business_id=eq.{BUSINESS_ID}&select=id,name,dur",
            headers=HEADERS, timeout=10
        )
        tags = tags_r.json()
        svcs = svcs_r.json()
    except Exception as e:
        log.warning(f"태그/서비스 로드 실패: {e}")
        tags, svcs = [], []

    _ai_settings_cache.update({
        "key":        api_key_val,
        "gemini_key": cfg.get("gemini_key", "") or cfg.get("system_gemini_key", ""),
        "tags":       tags,
        "services":   svcs,
        "ai_rules":   ai_rules,
        "wa_token":   cfg.get("wa_token", ""),
        "ig_token":   cfg.get("ig_token", ""),
        "ig_tokens":  cfg.get("ig_tokens", {}),
        "wa_phone_number_id": cfg.get("wa_phone_number_id", ""),
        "loaded_at":  now,
    })
    return _ai_settings_cache


def ai_analyze_reservation(rid: str, request_msg: str, owner_comment: str,
                           cust_name: str = "", visit_count: int = 0,
                           is_prepaid: bool = False, is_new_cust: bool = False):
    """스크래핑 완료 후 GPT로 태그/서비스 자동 분석 → selected_tags 업데이트"""

    # 시스템 태그 ID - DB 태그 목록에서 이름으로 동적 조회 (하드코딩 제거)
    settings = _load_ai_settings()
    all_tags = settings.get("tags") or []
    def _find_tag(name): return next((t["id"] for t in all_tags if t.get("name") == name), None)
    NEW_CUST_TAG_ID = _find_tag("신규") or ""
    SYSTEM_TAG_IDS  = {t for t in [NEW_CUST_TAG_ID] if t}

    api_key = settings.get("key")
    if not api_key:
        return  # OpenAI key 미설정 → 스킵

    # ── 현재 DB 상태 가져오기 (기존 태그/서비스 보존용) ──────────────────────
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/reservations"
            f"?reservation_id=eq.{rid}"
            f"&select=selected_tags,selected_services",
            headers=HEADERS, timeout=10
        )
        existing = r.json()
        existing_tags = list(existing[0].get("selected_tags") or []) if existing else []
        existing_svcs = list(existing[0].get("selected_services") or []) if existing else []
    except Exception as e:
        log.warning(f"  #{rid} 기존 태그 조회 실패: {e}")
        existing_tags, existing_svcs = [], []

    # ── 이미 분석된 예약 스킵 (시스템 태그 제외한 사용자 태그가 있으면 재분석 불필요) ──
    non_system_tags = [t for t in existing_tags if t not in SYSTEM_TAG_IDS]
    if non_system_tags:
        log.info(f"  #{rid} 이미 분석됨 (태그 {non_system_tags}) → AI 재분석 스킵")
        return

    # JSON 배열 형식이면 텍스트로 변환
    if request_msg and request_msg.strip().startswith("["):
        try:
            import json as _json
            items = _json.loads(request_msg)
            request_msg = "\n".join(f"{it['label']}: {it['value']}" for it in items if it.get('value'))
        except Exception:
            pass

    naver_text = "\n".join(filter(None, [request_msg, owner_comment])).strip()

    # ── AI 분석 (텍스트 있을 때만) ──────────────────────────────────────────
    ai_tag_ids = []
    ai_svc_ids = []
    ai_gender  = ""
    ai_requested_time = ""

    if naver_text and naver_text != "-대화없음-":
        tags = settings.get("tags") or []
        svcs = settings.get("services") or []

        tag_list = ", ".join(f'"{t["id"]}":"{t["name"]}"' for t in tags)
        svc_list = ", ".join(f'"{s["id"]}":"{s["name"]}"' for s in svcs)

        # 커스텀 규칙 블록 (앱과 동일한 형식)
        ai_rules = settings.get("ai_rules") or []
        custom_rules_block = ""
        if ai_rules:
            rules_str = "\n".join(f"{i+1}. {r}" for i, r in enumerate(ai_rules))
            custom_rules_block = f"\n[추가 판단 규칙 - 아래 규칙을 기본 기준보다 우선 적용하세요]\n{rules_str}"

        prompt = (
            f"당신은 왁싱샵/미용실 예약 정보를 분석하는 AI입니다.\n"
            f"아래 네이버 예약 고객 정보를 분석하여 적합한 태그와 시술상품을 선택하세요.\n"
            f"반드시 순수 JSON만 출력. 코드블록 절대 금지.\\n\\n"      f"[태그 목록] {tag_list}\n"
            f"[시술상품 목록] {svc_list}\n\n"
            f"[기본 판단 기준]\n"
            f"- 태그 목록에 있는 태그만 선택하세요. 임의로 판단하지 마세요.\n"
            f"- 고객 요청에 명시적으로 언급된 경우에만 태그를 선택하세요.\n"
            f"- \"신규\" 태그, \"예약금완료\" 태그는 선택하지 마세요. 시스템이 자동 처리합니다.\n\n"
            f"[시술상품 선택 규칙 - 중요]\n"
            f"- '시술메뉴', '옵션' 필드에서 실제 시술명을 찾으세요.\n"
            f"- 동의어: 음모왁싱=브라질리언, 음부왁싱=브라질리언, 브라질리언왁싱=브라질리언, 패키지/연간할인권=브라질리언\n"
            f"- '재방문', '신규', '이벤트', '할인권', '금액권', '화복적' 등 단독으로 나오면 시술이 아닙니다.\n"
            f"- 옵션에 'N원'이 붙은 항목(예: 음모왁싱 0원, 겨드랑이 30000원)을 우선 확인하세요.\n"
            f"- '상담 후', '상담후' 표현이 있으면 앞에 나온 부위를 시술로 선택하세요. (예: '페이스 상담 후' → 페이스)\n"
            f"- 시술상품 목록에서 가장 유사한 항목을 선택하세요. 없으면 빈 배열로 두세요.\n"
            f"{custom_rules_block}\n\n"
            f"[예약 기본 정보]\n"
            f"- 고객명: {cust_name or '미상'}\n"
            f"- 방문횟수: {visit_count}회\n\n"
            f"[고객 요청 / 업체 메모]\n"
            f"{naver_text}\n\n"
            f"[시간 요청 파싱]\n"
            f"- 고객이 특정 시간을 요청하면 requestedTime 필드에 HH:MM 형식으로 추출하세요.\n"
            f"- 예: '4시20분으로 해주세요' → '16:20', '오후 2시 30분' → '14:30'\n"
            f"- 시간 요청이 없으면 빈 문자열로 두세요.\n\n"
            f"반드시 순수 JSON만 반환하세요. 마크다운, 코드블록, 설명 절대 금지.\n응답 형식:\n"
            f'{{"matchedTagIds":["태그id1"],"matchedServiceIds":["시술id1"],"gender":"F 또는 M 또는 빈문자열","requestedTime":"HH:MM 또는 빈문자열"}}'
        )

        try:
            gemini_key = (settings.get("gemini_key") or "").strip()
            resp = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}",
                json={"contents":[{"parts":[{"text":prompt}]}],"generationConfig":{"temperature":0,"maxOutputTokens":2048}},
                headers={"Content-Type":"application/json"},
                timeout=30
            )
            if resp.ok:
                text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                log.warning(f"  [GEMINI_RAW] #{rid} len={len(text)} raw={repr(text[:300])}")
                text = text.replace("```json", "").replace("```", "").strip()
                import re as _re; _m=_re.search(r'\{[\s\S]*\}', text); text=_m.group() if _m else text
                result = json.loads(text)
                ai_tag_ids = result.get("matchedTagIds") or []
                ai_svc_ids = result.get("matchedServiceIds") or []
                ai_gender  = result.get("gender", "").strip().upper()
                if ai_gender not in ("F", "M"):
                    ai_gender = ""
                ai_requested_time = result.get("requestedTime", "").strip()
                # ── hallucination 방지: 실제 서비스/태그 ID만 통과 ──
                valid_svc_ids = {s["id"] for s in svcs}
                valid_tag_ids = {t["id"] for t in tags}
                invalid_svcs = [s for s in ai_svc_ids if s not in valid_svc_ids]
                invalid_tags = [t for t in ai_tag_ids if t not in valid_tag_ids]
                if invalid_svcs:
                    log.warning(f"  ⚠️ AI hallucination 제거 (서비스): {invalid_svcs}")
                    ai_svc_ids = [s for s in ai_svc_ids if s in valid_svc_ids]
                if invalid_tags:
                    log.warning(f"  ⚠️ AI hallucination 제거 (태그): {invalid_tags}")
                    ai_tag_ids = [t for t in ai_tag_ids if t in valid_tag_ids]
                log.info(f"  🤖 Gemini 응답 ok: tags={ai_tag_ids} svcs={ai_svc_ids} gender={ai_gender}")
            else:
                err_msg = f"Gemini API 오류 #{rid}: {resp.status_code} {resp.text[:200]}"
                log.warning(err_msg)
                log.warning(f"  AI 분석 오류 기록: {err_msg[:100]}")
        except Exception as e:
            err_msg = f"AI 분석 실패 #{rid}: {e}"
            log.warning(err_msg)
            log.warning(f"  AI 분석 오류: {err_msg[:100]}")

    # ── 최종 태그 계산 ────────────────────────────────────────────────────────
    # 기존 시스템 태그 보존 + AI 태그 추가 (중복 제거)
    system_tags = [t for t in existing_tags if t in SYSTEM_TAG_IDS]
    merged_tags = list(dict.fromkeys(system_tags + ai_tag_ids))  # 순서 유지, 중복 제거

    # is_new_cust면 신규 태그 자동 추가
    if is_new_cust and NEW_CUST_TAG_ID not in merged_tags:
        merged_tags.append(NEW_CUST_TAG_ID)



    # ── 최종 서비스 계산 ──────────────────────────────────────────────────────
    # AI 결과 있으면 사용, 없으면 naver_sync.py가 이미 매칭한 기존 값 보존
    final_svcs = ai_svc_ids if ai_svc_ids else existing_svcs

    # ── DB 업데이트 ──────────────────────────────────────────────────────────
    update = {}
    # 태그: 시스템태그 + AI태그 + is_prepaid 반영
    update["selected_tags"] = merged_tags
    # 서비스: AI 결과 저장
    update["selected_services"] = final_svcs
    # 성별: AI가 판단했을 때만 덮어씀
    if ai_gender:
        update["cust_gender"] = ai_gender
    if ai_requested_time:
        import re
        if re.match(r"^([01]?\d|2[0-3]):[0-5]\d$", ai_requested_time):
            update["time"] = ai_requested_time
            log.info(f"  ⏰ 시간 요청 반영: {ai_requested_time}")
    # dur: AI 매칭된 서비스 시간 합산
    if final_svcs:
        try:
            svcs_all = settings.get("services") or []
            svc_map = {s["id"]: s for s in svcs_all}
            total_dur = sum(svc_map[sid].get("dur", 0) for sid in final_svcs if sid in svc_map)
            if total_dur > 0:
                update["dur"] = max(total_dur, 30)  # 최소 30분
        except Exception:
            pass

    try:
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/reservations?reservation_id=eq.{rid}",
            headers=HEADERS, json=update, timeout=10
        )
        log.info(f"  🤖 #{rid} AI 분석 완료: tags={merged_tags} svcs={final_svcs} prepaid={is_prepaid}")
    except Exception as e:
        log.warning(f"  #{rid} AI 결과 저장 실패: {e}")


# ─── 미스크래핑 예약 폴링 ─────────────────────────────────────────────────────






# ─── 자동 업데이트 스레드 ──────────────────────────────────────────────────────

# ─── 알림톡 Queue 처리 스레드 ───────────────────────────────
def alimtalk_thread():
    """alimtalk_queue 테이블 pending 항목 처리 → 알리고 API 발송"""
    import requests as rq
    ALIGO_URL = "https://kakaoapi.aligo.in/akv10/alimtalk/send/"

    def get_branch_cfg(branch_id):
        try:
            r = rq.get(f"{SUPABASE_URL}/rest/v1/branches?id=eq.{branch_id}&select=noti_config",
                       headers=HEADERS, timeout=10)
            rows = r.json()
            if rows:
                return json.loads(rows[0].get("noti_config") or "{}")
        except:
            pass
        return {}

    def process_item(item):
        cfg = get_branch_cfg(item["branch_id"])
        noti = cfg.get(item["noti_key"], {})
        if not noti.get("on") or not noti.get("tplCode") or not noti.get("msgTpl"):
            return {"skipped": "noti off or missing config"}
        if not cfg.get("aligoKey") or not cfg.get("aligoId") or not cfg.get("senderKey") or not cfg.get("senderPhone"):
            return {"skipped": "missing aligo credentials"}

        params = item.get("params") or {}
        msg = noti["msgTpl"]
        for k, v in params.items():
            msg = msg.replace(k, str(v) if v else "-")

        buttons = noti.get("buttons", [])
        btn_json = json.dumps({"button": [
            {
                "name": btn.get("name", "채널 추가"),
                "linkType": btn.get("type", "AC"),
                "linkTypeName": btn.get("typeName", "채널 추가"),
                "linkMo": btn.get("linkMo", ""),
                "linkPc": btn.get("linkPc", ""),
                "linkIos": btn.get("linkIos", ""),
                "linkAnd": btn.get("linkAnd", ""),
            } for btn in buttons
        ]}, ensure_ascii=False) if buttons else None

        data = {
            "apikey": cfg["aligoKey"],
            "userid": cfg["aligoId"],
            "senderkey": cfg["senderKey"],
            "tpl_code": noti["tplCode"].strip(),
            "sender": cfg["senderPhone"].replace("-", ""),
            "receiver_1": item["phone"].replace("-", ""),
            "recvname_1": params.get("#{고객명}", ""),
            "subject_1": noti.get("subject", "예약 안내"),
            "message_1": msg,
        }
        if btn_json:
            data["button_1"] = btn_json
        r = rq.post(ALIGO_URL, data=data, timeout=15)
        return r.json()

    log.info("[alimtalk] 스레드 시작")
    while True:
        try:
            r = rq.get(
                f"{SUPABASE_URL}/rest/v1/alimtalk_queue?status=eq.pending&order=id.asc&limit=10",
                headers=HEADERS, timeout=10
            )
            items = r.json() if r.status_code == 200 else []
            for item in items:
                try:
                    result = process_item(item)
                    status = "done" if (isinstance(result, dict) and result.get("code") == 0) else "failed"
                    rq.patch(
                        f"{SUPABASE_URL}/rest/v1/alimtalk_queue?id=eq.{item['id']}",
                        headers={**HEADERS, "Content-Type": "application/json"},
                        json={"status": status, "result": result, "processed_at": "now()"},
                        timeout=10
                    )
                    log.info(f"[alimtalk] id={item['id']} {item['noti_key']} → {status}")
                except Exception as e:
                    log.error(f"[alimtalk] item {item.get('id')} error: {e}")
                    rq.patch(
                        f"{SUPABASE_URL}/rest/v1/alimtalk_queue?id=eq.{item['id']}",
                        headers={**HEADERS, "Content-Type": "application/json"},
                        json={"status": "error", "result": {"error": str(e)}, "processed_at": "now()"},
                        timeout=10
                    )
        except Exception as e:
            log.error(f"[alimtalk] poll error: {e}")
        time.sleep(10)



# ─── Gemini AI 유틸 ────────────────────────────────────────────
def gemini_ask(prompt, timeout=10):
    global _gemini_429_until
    import time as _t
    if _t.time() < _gemini_429_until:
        log.warning(f"[gemini] 429 쿨다운 중 - 스킵")
        return ""
    try:
        key = (_load_ai_settings().get("gemini_key") or "").strip() or \
              _os.environ.get("BLISS_GEMINI_KEY", "")
        if not key:
            return ""
        resp = requests.post(
            GEMINI_URL + f"?key={key}",
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=timeout
        )
        if resp.status_code == 200:
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        elif resp.status_code == 429:
            _gemini_429_until = _t.time() + 60
            log.warning("[gemini] 429 Rate Limit - 60초 쿨다운")
        else:
            log.warning(f"[gemini] HTTP {resp.status_code}")
    except Exception as e:
        log.warning(f"[gemini] 오류: {e}")
    return ""
def sb_get(path):
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, timeout=10)
        return r.json() if r.status_code == 200 else []
    except:
        return []

def detect_lang(text):
    """로컬 유니코드 범위로 언어 감지 (Gemini 호출 없음)"""
    if not text or len(text.strip()) < 2:
        return "ko"
    ko = sum(1 for c in text if '가' <= c <= '힣' or 'ㄱ' <= c <= 'ㆎ')
    ja = sum(1 for c in text if '぀' <= c <= 'ヿ')
    zh = sum(1 for c in text if '一' <= c <= '鿿')
    en = sum(1 for c in text if c.isascii() and c.isalpha())
    total = max(len(text), 1)
    if ko / total > 0.15: return "ko"
    if ja / total > 0.1: return "ja"
    if zh / total > 0.1: return "zh"
    if en / total > 0.3: return "en"
    return "ko"
def translate_to_korean(text):
    return gemini_ask(f"다음을 자연스러운 한국어로 번역. 번역문만 출력:\n{text}")

def ai_auto_reply(user_msg, account_id):
    """FAQ 자동응답. 단순FAQ면 답변, 복잡한건 빈 문자열 반환"""
    return ""  # [DISABLED] 테스트 중 자동응답 비활성화
    ACC = {"101171979":"강남본점","102071377":"왕십리점","102507795":"홍대점",
           "101521969":"마곡점","101522539":"잠실점","101517367":"위례점",
           "101476019":"용산점","101988152":"천호점"}
    branch = ACC.get(account_id, "하우스왁싱")
    prompt = f"""당신은 하우스왁싱 {branch} AI 상담원입니다.
하우스왁싱: 2006년 창업, 서울 8개 직영 왁싱살롱, 연중무휴, 전지점 동일가격.
예약: 네이버/카카오/WhatsApp 가능. 가격: housewaxing.com/brazilianwaxing_price_info

고객 메시지: "{user_msg}"

판단:
- 가격/위치/운영시간/예약방법/남자가능 등 단순FAQ → 친절하게 2-3문장 답변
- 예약요청 → 네이버/카카오 예약 안내
- 불만/특수케이스/상세문의 → [HUMAN] 만 출력

답변(또는 [HUMAN])만 출력:"""
    result = gemini_ask(prompt)
    if "[HUMAN]" in result or not result:
        return ""
    return result

def request_profile(account_id, user_id):
    """닉네임 프로필 요청 발송"""
    auth = NAVER_TALK_ACCOUNTS.get(account_id, {}).get("auth", "")
    if not auth:
        return
    try:
        resp = requests.post(
            "https://gw.talk.naver.com/chatbot/v1/event",
            headers={"Authorization": auth, "Content-Type": "application/json"},
            json={"event": "profile", "options": {"field": "nickname"}, "user": user_id},
            timeout=5
        )
        log.info(f"[profile] 요청: {account_id}/{user_id[:12]} → {resp.status_code}")
    except Exception as e:
        log.warning(f"[profile] 요청 실패: {e}")

# ─── Telegram 알림 ────────────────────────────────────────────────────────────
def send_telegram(text: str):
    """Telegram 메시지 발송 (비동기)"""
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=5
        )
    except Exception as e:
        log.debug(f"[telegram] 전송 실패: {e}")



# ─── 네이버톡톡 Webhook 서버 ───────────────────────────────────────────────────
def telegram_bot_thread():
    """텔레그램 봇: 정우 전용 Claude 에이전트"""
    import sys, subprocess
    sys.path.insert(0, '/home/ubuntu/.local/lib/python3.12/site-packages')
    try:
        import anthropic as _anthropic
    except ImportError:
        log.error("[TG] anthropic 패키지 없음 - 스레드 종료")
        return

    # Supabase settings에서 텔레그램 토큰 로드 (env fallback)
    _SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
    _SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnRscnN1cXhxcWVvdXdiZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDU4MjQsImV4cCI6MjA4NzQ4MTgyNH0.iydEkjtPjZ0jXpUUPJben4IWWneDqLomv-HDlcFayE4"
    try:
        _r = requests.get(
            f"{_SB_URL}/rest/v1/businesses?id=eq.biz_khvurgshb&select=settings",
            headers={"apikey": _SB_KEY, "Authorization": f"Bearer {_SB_KEY}"}, timeout=10
        )
        _s = _r.json()[0].get("settings") or {}
        if isinstance(_s, str):
            import json as _json2; _s = _json2.loads(_s)
        TG_TOKEN  = _s.get("telegram_token") or os.environ.get("BLISS_TELEGRAM_TOKEN", "")
        TG_CHATID = _s.get("telegram_chat_id") or os.environ.get("BLISS_TELEGRAM_CHAT_ID", "")
    except Exception as _e:
        log.error(f"[TG] settings 로드 실패: {_e}")
        TG_TOKEN  = os.environ.get("BLISS_TELEGRAM_TOKEN", "")
        TG_CHATID = os.environ.get("BLISS_TELEGRAM_CHAT_ID", "")

    if not TG_TOKEN or not TG_CHATID:
        log.error("[TG] 텔레그램 토큰/채팅ID 없음")
        return

    ALLOWED_CHAT_ID = str(TG_CHATID)
    API_BASE = f"https://api.telegram.org/bot{TG_TOKEN}"

    def tg_send(text):
        try:
            requests.post(f"{API_BASE}/sendMessage", json={
                "chat_id": ALLOWED_CHAT_ID, "text": text,
                "parse_mode": "Markdown"
            }, timeout=10)
        except Exception as e:
            log.error(f"[TG] 메시지 전송 실패: {e}")

    def tg_send_plain(text):
        try:
            requests.post(f"{API_BASE}/sendMessage", json={
                "chat_id": ALLOWED_CHAT_ID, "text": text
            }, timeout=10)
        except Exception as e:
            log.error(f"[TG] 메시지 전송 실패: {e}")

    def get_anthropic_key():
        _SB_URL2 = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
        _SB_KEY2 = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnRscnN1cXhxcWVvdXdiZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDU4MjQsImV4cCI6MjA4NzQ4MTgyNH0.iydEkjtPjZ0jXpUUPJben4IWWneDqLomv-HDlcFayE4"
        try:
            r = requests.get(
                f"{_SB_URL2}/rest/v1/businesses?id=eq.biz_khvurgshb&select=settings",
                headers={"apikey": _SB_KEY2, "Authorization": f"Bearer {_SB_KEY2}"},
                timeout=10
            )
            data = r.json()
            if data and isinstance(data, list):
                settings = data[0].get("settings") or {}
                if isinstance(settings, str):
                    import json as _json
                    settings = _json.loads(settings)
                return settings.get("anthropic_key", "")
        except Exception as e:
            log.error(f"[TG] Anthropic 키 로드 실패: {e}")
        return ""

    # 대화 히스토리 (최근 20턴 유지)
    history = []
    MAX_HISTORY = 20

    SYSTEM_PROMPT = """당신은 Bliss 뷰티살롱 앱(하우스왁싱)의 전담 AI 어시스턴트입니다.
개발자 정우(이정우)의 텔레그램 지시를 받아 다음 작업을 수행합니다:

1. 일반 질문/대화: 코딩, 검색, 분석 등
2. 서버 명령: /cmd <명령어> → 셸 실행 후 결과 반환
3. 서비스 제어: /restart, /status, /logs <n>
4. 배포 지시: bliss-app 코드 수정은 GitHub API를 통해 직접 처리

서버 정보:
- Oracle Cloud Ubuntu 158.179.174.30
- bliss-naver.service: 스크래핑/메시지/Flask
- bliss-relay.service: cmd_relay
- GitHub: jeongwooLee1/bliss, jeongwooLee1/bliss-app, jeongwooLee1/naver-sync
- Supabase: dpftlrsuqxqqeouwbfjd

항상 한국어로 답변하고, 짧고 명확하게 답변하세요."""

    log.info("[TG] 텔레그램 봇 스레드 시작")
    tg_send_plain("🤖 Bliss AI 봇 온라인")

    offset = None
    while True:
        try:
            # getUpdates 폴링
            params = {"timeout": 30, "allowed_updates": ["message"]}
            if offset:
                params["offset"] = offset
            r = requests.get(f"{API_BASE}/getUpdates", params=params, timeout=35)
            updates = r.json().get("result", [])

            for update in updates:
                offset = update["update_id"] + 1
                msg = update.get("message", {})
                chat_id = str(msg.get("chat", {}).get("id", ""))
                text = msg.get("text", "").strip()

                if chat_id != ALLOWED_CHAT_ID or not text:
                    continue

                log.info(f"[TG] 수신: {text[:50]}")

                # ── /cmd: 셸 명령 실행 ──
                if text.startswith("/cmd "):
                    cmd_str = text[5:].strip()
                    tg_send_plain(f"⚙️ 실행 중: `{cmd_str}`")
                    try:
                        result = subprocess.run(
                            cmd_str, shell=True, capture_output=True,
                            text=True, timeout=30
                        )
                        out = (result.stdout + result.stderr).strip()
                        tg_send_plain(f"```\n{out[:3500] if out else '(출력 없음)'}\n```")
                    except subprocess.TimeoutExpired:
                        tg_send_plain("⏱ 명령 타임아웃 (30초)")
                    except Exception as e:
                        tg_send_plain(f"❌ 오류: {e}")
                    continue

                # ── /restart: 서비스 재시작 ──
                elif text == "/restart":
                    tg_send_plain("🔄 bliss-naver 재시작 중...")
                    subprocess.Popen(["sudo", "systemctl", "restart", "bliss-naver"])
                    continue

                # ── /status: 서버 상태 ──
                elif text == "/status":
                    try:
                        r2 = subprocess.run(
                            "systemctl is-active bliss-naver bliss-relay; uptime; df -h / | tail -1",
                            shell=True, capture_output=True, text=True, timeout=10
                        )
                        tg_send_plain(f"📊 서버 상태\n```\n{r2.stdout.strip()[:500]}\n```")
                    except Exception as e:
                        tg_send_plain(f"❌ {e}")
                    continue

                # ── /logs: 최근 로그 ──
                elif text.startswith("/logs"):
                    n = "30"
                    parts = text.split()
                    if len(parts) > 1 and parts[1].isdigit():
                        n = parts[1]
                    try:
                        r2 = subprocess.run(
                            f"journalctl -u bliss-naver -n {n} --no-pager 2>&1 | tail -50",
                            shell=True, capture_output=True, text=True, timeout=15
                        )
                        out = r2.stdout.strip()
                        tg_send_plain(f"📋 로그 (최근 {n}줄)\n```\n{out[-2500:]}\n```")
                    except Exception as e:
                        tg_send_plain(f"❌ {e}")
                    continue

                # ── /clear: 대화 히스토리 초기화 ──
                elif text == "/clear":
                    history.clear()
                    tg_send_plain("🗑 대화 히스토리 초기화됨")
                    continue

                # ── /help ──
                elif text == "/help":
                    tg_send_plain(
                        "🤖 *Bliss AI 봇 명령어*\n\n"
                        "/cmd <명령> - 셸 명령 실행\n"
                        "/restart - bliss-naver 재시작\n"
                        "/status - 서버 상태 확인\n"
                        "/logs [n] - 최근 로그 (기본 30줄)\n"
                        "/clear - 대화 기록 초기화\n"
                        "/help - 이 도움말\n\n"
                        "그 외 텍스트 → Claude AI 대화"
                    )
                    continue

                # ── 일반 대화: Claude API ──
                else:
                    anthropic_key = get_anthropic_key()
                    if not anthropic_key:
                        tg_send_plain("❌ Anthropic API 키가 설정되지 않았습니다\n(Supabase → businesses → settings → anthropic_key)")
                        continue

                    history.append({"role": "user", "content": text})
                    if len(history) > MAX_HISTORY * 2:
                        history[:] = history[-MAX_HISTORY * 2:]

                    try:
                        client = _anthropic.Anthropic(api_key=anthropic_key)
                        resp = client.messages.create(
                            model="claude-sonnet-4-5",
                            max_tokens=2048,
                            system=SYSTEM_PROMPT,
                            messages=history
                        )
                        reply = resp.content[0].text
                        history.append({"role": "assistant", "content": reply})

                        # 텔레그램 메시지 4096자 제한
                        if len(reply) > 4000:
                            for chunk in [reply[i:i+4000] for i in range(0, len(reply), 4000)]:
                                tg_send_plain(chunk)
                        else:
                            tg_send_plain(reply)

                    except Exception as e:
                        log.error(f"[TG] Claude API 오류: {e}")
                        tg_send_plain(f"❌ Claude API 오류: {str(e)[:200]}")

        except Exception as e:
            log.error(f"[TG] 봇 스레드 오류: {e}")
            time.sleep(5)


def naver_talk_webhook_thread():
    """Flask 서버 포트 5055 — 네이버톡톡 메시지 수신"""
    if not _FLASK_OK:
        log.error("[naver_talk] flask 미설치 — pip install flask")
        return

    app = _Flask("naver_talk")

    @app.route("/request-profile", methods=["POST","OPTIONS"])
    def request_profile():
        if _flask_req.method=="OPTIONS":
            res=_flask_app_make_response(""); res.headers.update({"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST,OPTIONS"}); return res
        try:
            body=_flask_req.get_json(force=True,silent=True) or {}
            account_id=body.get("account_id",""); user_id=body.get("user_id","")
            auth=NAVER_TALK_ACCOUNTS.get(account_id,{}).get("auth","")
            if not auth: return {"ok":False,"error":"no auth"},400
            resp=requests.post("https://gw.talk.naver.com/chatbot/v1/event",
                headers={"Authorization":auth,"Content-Type":"application/json"},
                json={"event":"profile","options":{"field":"nickname"},"user":user_id},timeout=5)
            res=_flask_app_make_response(str({"ok":resp.status_code==200}))
            res.headers["Access-Control-Allow-Origin"]="*"; return res
        except Exception as e:
            return {"ok":False,"error":str(e)},500

    @app.route("/naver-talk", methods=["POST"])
    @app.route("/naver-talk/<path:url_acc_id>", methods=["POST"])
    def naver_talk_webhook(url_acc_id=None):
        try:
            payload = _flask_req.get_json(force=True, silent=True) or {}
            event   = payload.get("event", "")
            user_id = payload.get("user", "")
            if event:
                log.info(f"[naver_talk] event={event} user={user_id[:12] if user_id else ''}")

            # account_id: URL path에서 직접 파싱
            if url_acc_id and url_acc_id in NAVER_TALK_ACCOUNTS:
                account_id = url_acc_id
                log.info(f"[naver_talk] account_id={account_id} ({NAVER_TALK_ACCOUNTS[account_id]['name']})")
            else:
                account_id = str(payload.get("options", {}).get("sender", "unknown"))
                if account_id not in NAVER_TALK_ACCOUNTS:
                    account_id = "unknown"
                    log.info(f"[naver_talk] account_id 파악 불가 url_acc_id={url_acc_id!r}")
            # user_name 추출 시도
            user_name = payload.get("options", {}).get("nick") or None

            # 메시지 텍스트 추출
            msg_text = None
            msg_type = "text"
            if "textContent" in payload:
                msg_text = payload["textContent"].get("text", "")
                msg_type = "text"
            elif "imageContent" in payload:
                msg_text = "[이미지]"
                msg_type = "image"
            elif "compositeContent" in payload:
                msg_text = "[복합메시지]"
                msg_type = "composite"

            # open 이벤트: Profile API로 닉네임 요청 (공식 방식)
            if event == "open" and user_id and account_id != "unknown":
                try:
                    auth_token = NAVER_TALK_ACCOUNTS.get(account_id, {}).get("auth", "")
                    if auth_token:
                        # 이미 이름 아는 경우 스킵
                        known = sb_get(f"naver_messages?user_id=eq.{user_id}&user_name=not.is.null&limit=1")
                        if not known:
                            requests.post(
                                "https://gw.talk.naver.com/chatbot/v1/event",
                                headers={"Authorization": auth_token, "Content-Type": "application/json"},
                                json={"event": "profile", "options": {"field": "nickname"}, "user": user_id},
                                timeout=5
                            )
                            log.info(f"[naver_talk] open→profile 요청: {user_id}")
                except Exception as e:
                    log.warning(f"[naver_talk] open profile 요청 실패: {e}")

            # profile 이벤트 수신: 고객이 닉네임 동의 완료
            if event == "profile":
                result = payload.get("options", {}).get("result", "")
                nickname = payload.get("options", {}).get("nickname", "")
                if result == "SUCCESS" and nickname:
                    try:
                        requests.patch(
                            f"{SUPABASE_URL}/rest/v1/naver_messages?user_id=eq.{user_id}",
                            headers={**HEADERS, "Prefer": "return=minimal"},
                            json={"user_name": nickname}, timeout=5
                        )
                        log.info(f"[naver_talk] 닉네임 수신: {user_id} → {nickname}")
                    except Exception as e:
                        log.warning(f"[naver_talk] 닉네임 저장 실패: {e}")

            # echo 이벤트 처리: 파트너센터/상담사가 보낸 메시지 → direction=out으로 저장
            if event == "echo":
                echoed = payload.get("echoedEvent", "")
                log.info(f"[echo] echoed={echoed} user={user_id[:12]} acc={account_id} keys={list(payload.keys())[:8]}")
                # echo 이벤트면 텍스트 추출 시도
                echo_text = None
                if "textContent" in payload:
                    echo_text = payload["textContent"].get("text", "")
                elif "imageContent" in payload:
                    echo_text = "[이미지]"
                elif "compositeContent" in payload:
                    echo_text = "[복합메시지]"
                if echo_text and user_id and account_id != "unknown":
                    try:
                        echo_row = {
                            "account_id": account_id, "channel": "naver",
                            "user_id": user_id, "event_type": "echo",
                            "message_type": "text", "message_text": echo_text,
                            "direction": "out", "is_read": True,
                        }
                        # 영어 등 외국어면 한국어 번역 추가
                        try:
                            echo_lang = detect_lang(echo_text)
                            if echo_lang and echo_lang != "ko":
                                echo_tr = translate_to_korean(echo_text)
                                if echo_tr:
                                    echo_row["translated_text"] = echo_tr
                        except: pass
                        requests.post(
                            f"{SUPABASE_URL}/rest/v1/naver_messages",
                            headers={**HEADERS, "Prefer": "return=minimal"},
                            json=echo_row, timeout=5
                        )
                        log.info(f"[echo] 파트너 메시지 저장: {echo_text[:40]}")
                    except Exception as e:
                        log.warning(f"[echo] 저장 실패: {e}")

            # send 이벤트만 저장 (echo/open/friend 등 제외)
            if event == "send" and msg_text is not None:
                # 프로필 조회 시도 (캐시 없으면)
                if user_name is None:
                    # DB에서 기존 저장된 이름 조회
                    try:
                        known = sb_get(f"naver_messages?user_id=eq.{user_id}&user_name=not.is.null&limit=1")
                        if known:
                            user_name = known[0].get("user_name")
                    except Exception as ep:
                        log.warning(f"[naver_talk] user_name 조회 실패: {ep}")

                row = {
                    "account_id":   account_id,
                    "channel":       "naver",
                    "user_name":     user_name,
                    "user_id":      user_id,
                    "event_type":   event,
                    "message_type": msg_type,
                    "message_text": msg_text,
                    "raw_payload":  payload,
                    "direction":    "in",
                    "is_read":      False,
                }
                msg_id = None
                try:
                    ins_r = requests.post(
                        f"{SUPABASE_URL}/rest/v1/naver_messages",
                        headers={**HEADERS, "Prefer": "return=representation"},
                        json=row, timeout=5
                    )
                    ins_data = ins_r.json()
                    if isinstance(ins_data, list) and ins_data:
                        msg_id = ins_data[0].get("id")
                except Exception as e:
                    log.error(f"[naver_talk] Supabase 저장 실패: {e}")

                # Telegram 알림
                ch_name = NAVER_TALK_ACCOUNTS.get(account_id, {}).get("name", account_id)
                # send_telegram 비활성화

                # ── 프로필 요청 (처음 메시지이고 닉네임 없으면) ──
                if account_id != "unknown" and not user_name:
                    try:
                        existing = requests.get(
                            f"{SUPABASE_URL}/rest/v1/naver_messages?user_id=eq.{user_id}&user_name=not.is.null&limit=1",
                            headers=HEADERS, timeout=5
                        ).json()
                        if not existing:
                            # profile_requested 태그 확인
                            tag_check = requests.get(
                                f"{SUPABASE_URL}/rest/v1/naver_messages?user_id=eq.{user_id}&message_text=eq.__profile_requested__&limit=1",
                                headers=HEADERS, timeout=5
                            ).json()
                            if not tag_check:
                                # 요청 기록 저장
                                requests.post(
                                    f"{SUPABASE_URL}/rest/v1/naver_messages",
                                    headers={**HEADERS, "Prefer": "return=minimal"},
                                    json={"account_id": account_id, "user_id": user_id,
                                          "channel": "naver", "event_type": "system",
                                          "message_type": "text", "message_text": "__profile_requested__",
                                          "direction": "system", "is_read": True},
                                    timeout=5
                                )
                                request_profile(account_id, user_id)
                    except Exception as ep:
                        log.warning(f"[profile_req] 오류: {ep}")

                # ── 번역/자동응답 비동기 처리 (webhook 5초 타임아웃 방지) ──
                def _async_ai(msg_text=msg_text, user_id=user_id, account_id=account_id, msg_id=msg_id):
                    try:
                        # 번역 (이미 번역된 메시지 스킵)
                        lang = detect_lang(msg_text)
                        if lang and lang != "ko":
                            translated = translate_to_korean(msg_text)
                            if translated and msg_id:
                                requests.patch(
                                    f"{SUPABASE_URL}/rest/v1/naver_messages?id=eq.{msg_id}",
                                    headers={**HEADERS, "Prefer": "return=minimal"},
                                    json={"translated_text": translated}, timeout=5
                                )
                                log.info(f"[translate] {lang}→ko: {translated[:40]}")
                        # 자동응답 - 이미 봇이 답했으면 스킵 (중복 방지)
                        try:
                            _last = requests.get(
                                f"{SUPABASE_URL}/rest/v1/naver_messages"
                                f"?account_id=eq.{account_id}&user_id=eq.{user_id}"
                                f"&direction=neq.system&order=created_at.desc&limit=1&select=direction",
                                headers=HEADERS, timeout=5
                            ).json()
                            _last_dir = _last[0].get("direction") if _last else "in"
                        except Exception:
                            _last_dir = "in"
                        if _last_dir == "out":
                            log.info(f"[auto_reply] 이미 답변됨({account_id}/{user_id[:12]}) → 스킵")
                            auto_reply = ""
                        else:
                            auto_reply = ai_booking_agent(msg_text, account_id, user_id, "naver") if ai_booking_agent else ""
                        if auto_reply and account_id != "unknown":
                            requests.post(
                                f"{SUPABASE_URL}/rest/v1/send_queue",
                                headers={**HEADERS, "Prefer": "return=minimal"},
                                json={"account_id": account_id, "user_id": user_id,
                                      "message_text": auto_reply, "status": "pending"},
                                timeout=5
                            )
                            log.info(f"[auto_reply] {auto_reply[:40]}")
                    except Exception as e:
                        log.warning(f"[async_ai] 오류: {e}")
                threading.Thread(target=_async_ai, daemon=True).start()

                # 처음 메시지면 닉네임 프로필 요청
                if account_id != "unknown" and not user_name:
                    try:
                        auth_token = NAVER_TALK_ACCOUNTS.get(account_id, {}).get("auth", "")
                        if auth_token:
                            # 이 user_id가 처음인지 확인
                            prev = sb_get(f"naver_messages?user_id=eq.{user_id}&user_name=not.is.null&limit=1")
                            if not prev:
                                # 닉네임 동의 요청 발송
                                requests.post(
                                    "https://gw.talk.naver.com/chatbot/v1/event",
                                    headers={"Authorization": auth_token, "Content-Type": "application/json"},
                                    json={
                                        "event": "profile",
                                        "options": {"field": "nickname"},
                                        "user": user_id
                                    },
                                    timeout=5
                                )
                                log.info(f"[naver_talk] 닉네임 요청 발송: {user_id}")
                    except Exception as e:
                        log.warning(f"[naver_talk] 닉네임 요청 실패: {e}")

            return ("", 200)
        except Exception as e:
            log.error(f"[naver_talk] webhook 오류: {e}")
            return ("", 500)

    

    @app.route("/send-message", methods=["POST", "OPTIONS"])
    def send_message():
        if _flask_req.method == "OPTIONS":
            resp = make_response("", 200)
            resp.headers["Access-Control-Allow-Origin"] = "*"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
            return resp
        try:
            body = _flask_req.get_json(force=True, silent=True) or {}
            account_id = body.get("account_id", "")
            user_id = body.get("user_id", "")
            text = body.get("text", "")
            if not account_id or not user_id or not text:
                return (json.dumps({"error": "missing params"}), 400, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"})
            auth = NAVER_TALK_ACCOUNTS.get(account_id, {}).get("auth", "")
            if not auth:
                return (json.dumps({"error": f"no auth for {account_id}"}), 400, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"})
            resp_naver = requests.post(
                "https://gw.talk.naver.com/chatbot/v1/event",
                headers={"Authorization": auth, "Content-Type": "application/json"},
                json={"event": "send", "user": user_id, "textContent": {"text": text}},
                timeout=5
            )
            log.info(f"[send-message] {account_id} → {user_id}: {resp_naver.status_code}")
            return (json.dumps({"status": resp_naver.status_code}), 200, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"})
        except Exception as e:
            log.error(f"[send-message] 오류: {e}")
            return (json.dumps({"error": str(e)}), 500, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"})

    log.info("[naver_talk] Flask 서버 시작 :5055")

    # ─── WhatsApp Webhook ──────────────────────────────────────
    WA_VERIFY = "bliss_wa_verify_2026"


    # --- Instagram DM Webhook ---
    IG_VERIFY = "bliss_ig_verify_2026"

    @app.route("/instagram", methods=["GET"])
    def instagram_verify():
        mode = _flask_req.args.get("hub.mode")
        tok = _flask_req.args.get("hub.verify_token")
        chal = _flask_req.args.get("hub.challenge")
        if mode == "subscribe" and tok == IG_VERIFY:
            log.info("[IG] webhook verified")
            return chal, 200
        return "Forbidden", 403

    @app.route("/instagram", methods=["POST"])
    def instagram_webhook():
        try:
            data = _flask_req.get_json(silent=True) or {}
            log.info(f"[IG] payload: {str(data)[:500]}")
            for entry in data.get("entry", []):
                ig_id = str(entry.get("id", ""))
                for messaging in entry.get("messaging", []):
                    sender_id = str(messaging.get("sender", {}).get("id", ""))
                    msg = messaging.get("message", {})
                    if not msg: continue
                    mtxt = msg.get("text", "")
                    if not mtxt:
                        if msg.get("attachments"): mtxt = "[미디어]"
                        else: continue
                    # 에코(우리가 보낸 메시지) 처리
                    if sender_id == ig_id:
                        if msg.get("is_echo"):
                            recipient_id = str(messaging.get("recipient", {}).get("id", ""))
                            if recipient_id and recipient_id != ig_id:
                                try:
                                    # send_queue 발송분은 이미 저장됨 → 중복 스킵
                                    _dup = requests.get(
                                        f"{SUPABASE_URL}/rest/v1/naver_messages?channel=eq.instagram&account_id=eq.{ig_id}&user_id=eq.{recipient_id}&direction=eq.out&order=created_at.desc&limit=1&select=message_text",
                                        headers=HEADERS, timeout=5).json()
                                    if _dup and _dup[0].get("message_text","").strip() == (mtxt or "").strip():
                                        log.info(f"[IG] echo skip (dup): to={recipient_id}")
                                        continue
                                    ig_echo_row = {"user_id":recipient_id,"account_id":ig_id,"channel":"instagram",
                                              "event_type":"send","message_type":"text",
                                              "direction":"out","message_text":mtxt,"is_read":True}
                                    try:
                                        _el = detect_lang(mtxt)
                                        if _el and _el != "ko":
                                            _et = translate_to_korean(mtxt)
                                            if _et: ig_echo_row["translated_text"] = _et
                                    except: pass
                                    requests.post(f"{SUPABASE_URL}/rest/v1/naver_messages",
                                        headers={**HEADERS, "Prefer":"return=minimal", "Content-Type":"application/json"},
                                        json=ig_echo_row, timeout=5)
                                    log.info(f"[IG] echo saved: to={recipient_id} text={mtxt[:40]}")
                                except Exception as e:
                                    log.warning(f"[IG] echo save err: {e}")
                        continue
                    # username 조회
                    ig_username = ""
                    try:
                        ig_tokens = _load_ai_settings().get("ig_tokens") or {}
                        ig_tok = ig_tokens.get(ig_id) or _load_ai_settings().get("ig_token") or ""
                        if ig_tok:
                            uresp = requests.get(f"https://graph.instagram.com/v21.0/{sender_id}?fields=username,name&access_token={ig_tok}", timeout=5)
                            if uresp.ok:
                                udata = uresp.json()
                                ig_username = udata.get("username") or udata.get("name") or ""
                    except: pass
                    log.info(f"[IG] DM: from={sender_id} @{ig_username} text={mtxt[:50]}")
                    requests.post(f"{SUPABASE_URL}/rest/v1/naver_messages",
                        headers={**HEADERS, "Prefer":"return=minimal", "Content-Type":"application/json"},
                        json={"user_id":sender_id,"account_id":ig_id,"channel":"instagram",
                              "event_type":"send","message_type":"text","user_name":ig_username or "",
                              "direction":"in","message_text":mtxt,"is_read":False}, timeout=5)
                    if ai_booking_agent:
                        def _ig_ai(text=mtxt,acc=ig_id,uid=sender_id,mid=None):
                            try:
                                # 번역
                                lang = detect_lang(text)
                                if lang and lang != "ko":
                                    translated = translate_to_korean(text)
                                    if translated:
                                        log.info(f"[IG translate] {lang}→ko: {translated[:40]}")
                                        # 번역 저장
                                        try:
                                            _msgs = requests.get(
                                                f"{SUPABASE_URL}/rest/v1/naver_messages?channel=eq.instagram&user_id=eq.{uid}&order=created_at.desc&limit=1&select=id",
                                                headers=HEADERS, timeout=5).json()
                                            if _msgs:
                                                _mid = _msgs[0].get('id')
                                                requests.patch(
                                                    f"{SUPABASE_URL}/rest/v1/naver_messages?id=eq.{_mid}",
                                                    headers={**HEADERS, "Prefer":"return=minimal"},
                                                    json={"translated_text": translated}, timeout=5)
                                        except: pass
                                # 중복 방지: 마지막 메시지가 out이면 스킵
                                try:
                                    _last = requests.get(
                                        f"{SUPABASE_URL}/rest/v1/naver_messages?channel=eq.instagram&account_id=eq.{acc}&user_id=eq.{uid}&direction=neq.system&order=created_at.desc&limit=1&select=direction",
                                        headers=HEADERS, timeout=5).json()
                                    if _last and _last[0].get("direction") == "out":
                                        log.info(f"[IG auto_reply] 이미 답변됨({acc}/{uid[:12]}) → 스킵")
                                        return
                                except: pass
                                reply = ai_booking_agent(text, acc, uid, "instagram")
                                if reply:
                                    requests.post(f"{SUPABASE_URL}/rest/v1/send_queue",
                                        headers={**HEADERS, "Prefer":"return=minimal", "Content-Type":"application/json"},
                                        json={"account_id":acc,"user_id":uid,"message_text":reply,"status":"pending","channel":"instagram","is_ai":True},
                                        timeout=5)
                                    log.info(f"[IG auto_reply] {reply[:40]}")
                            except Exception as e: log.warning(f"[IG AI] err: {e}")
                        import threading as _th
                        _th.Thread(target=_ig_ai, daemon=True).start()
        except Exception as e:
            log.warning(f"[IG] error: {e}")
        return "OK", 200

    @app.route("/whatsapp", methods=["GET"])
    def whatsapp_verify():
        mode = _flask_req.args.get("hub.mode")
        tok = _flask_req.args.get("hub.verify_token")
        chal = _flask_req.args.get("hub.challenge")
        if mode == "subscribe" and tok == WA_VERIFY:
            log.info("[WA] verified")
            return chal, 200
        return "Forbidden", 403

    @app.route("/whatsapp", methods=["POST"])
    def whatsapp_webhook():
        try:
            data = _flask_req.get_json(silent=True) or {}
            log.info(f"[WA] payload: {str(data)[:500]}")
            for entry in data.get("entry", []):
                for change in entry.get("changes", []):
                    value = change.get("value", {})
                    # contacts에서 이름 맵 생성
                    contacts = {c.get("wa_id"): c.get("profile", {}).get("name", "") for c in value.get("contacts", [])}
                    for msg in value.get("messages", []):
                        fnum = msg.get("from", "")
                        mtype = msg.get("type", "")
                        mtxt = msg.get("text", {}).get("body", "") if mtype == "text" else f"[{mtype}]"
                        if not mtxt: continue
                        user_name = contacts.get(fnum, "")
                        # fnum은 국제번호 형식 (821012345678) → 한국번호로 변환
                        cust_phone = fnum
                        if fnum.startswith("82") and len(fnum) >= 11:
                            cust_phone = "0" + fnum[2:]
                        log.info(f"[WA] 수신: from={fnum} name={user_name} phone={cust_phone} type={mtype} text={mtxt[:50]}")
                        ins = requests.post(f"{SUPABASE_URL}/rest/v1/naver_messages",
                            headers={**HEADERS, "Prefer":"return=representation", "Content-Type":"application/json"},
                            json={"user_id":fnum,"account_id":"whatsapp","channel":"whatsapp",
                                  "event_type":"send","message_type":"text","user_name":user_name,
                                  "cust_phone":cust_phone,
                                  "direction":"in","message_text":mtxt,"is_read":False}, timeout=5)
                        log.info(f"[WA] DB저장: {ins.status_code} {ins.text[:100]}")
                        # 번역 비동기 처리
                        if ins.status_code == 201:
                            ins_data = ins.json() if ins.text else []
                            msg_id = ins_data[0].get("id") if isinstance(ins_data, list) and ins_data else None
                            def _wa_async_ai(msg_text=mtxt, mid=msg_id):
                                try:
                                    lang = detect_lang(msg_text)
                                    if lang and lang != "ko":
                                        translated = translate_to_korean(msg_text)
                                        if translated and mid:
                                            requests.patch(
                                                f"{SUPABASE_URL}/rest/v1/naver_messages?id=eq.{mid}",
                                                headers={**HEADERS, "Prefer": "return=minimal"},
                                                json={"translated_text": translated}, timeout=5
                                            )
                                            log.info(f"[WA translate] {lang}→ko: {translated[:40]}")
                                except Exception as e:
                                    log.warning(f"[WA translate] 오류: {e}")
                                # AI 자동응답 (예약 에이전트)
                                if ai_booking_agent:
                                    try:
                                        _last = requests.get(
                                            f"{SUPABASE_URL}/rest/v1/naver_messages?channel=eq.whatsapp&user_id=eq.{fnum}&direction=neq.system&order=created_at.desc&limit=1&select=direction",
                                            headers=HEADERS, timeout=5).json()
                                        if _last and _last[0].get("direction") == "out":
                                            log.info(f"[WA auto_reply] 이미 답변됨({fnum[:12]}) → 스킵")
                                        else:
                                            wa_reply = ai_booking_agent(msg_text, "whatsapp", fnum, "whatsapp")
                                            if wa_reply:
                                                requests.post(f"{SUPABASE_URL}/rest/v1/send_queue",
                                                    headers={**HEADERS, "Prefer":"return=minimal", "Content-Type":"application/json"},
                                                    json={"account_id":"whatsapp","user_id":fnum,"message_text":wa_reply,"status":"pending","channel":"whatsapp"},
                                                    timeout=5)
                                                log.info(f"[WA auto_reply] {wa_reply[:40]}")
                                    except Exception as e:
                                        log.warning(f"[WA auto_reply] 오류: {e}")
                            import threading as _th
                            _th.Thread(target=_wa_async_ai, daemon=True).start()
        except Exception as e:
            log.warning(f"[WA] error: {e}")
        return "OK", 200

    app.run(host="0.0.0.0", port=5055, debug=False, use_reloader=False)


# auto_update_thread 제거 — crontab이 동일 역할 수행 (중복)

# ─── CMD Relay 스레드 (Oracle 서버 내장) ──────────────────────────────────────


# ═══════════════════════════════════════════════════════════════
# send_queue 폴링 스레드 (브라우저→Supabase→서버→네이버 발송)
# ═══════════════════════════════════════════════════════════════
def send_queue_thread():
    log.info("[send_queue] 스레드 시작")
    SB = SUPABASE_URL
    SB_H = {**HEADERS, "Content-Type": "application/json"}
    while True:
        try:
            r = requests.get(f"{SB}/rest/v1/send_queue?status=eq.pending&order=created_at.asc&limit=10", headers=SB_H, timeout=5)
            rows = r.json() if r.status_code == 200 else []
            for row in (rows or []):
                row_id = row.get("id")
                account_id = row.get("account_id", "")
                user_id = row.get("user_id", "")
                text = row.get("message_text", "")
                channel = row.get("channel", "naver")
                if not all([row_id, account_id, user_id, text]):
                    requests.patch(f"{SB}/rest/v1/send_queue?id=eq.{row_id}", headers={**SB_H, "Prefer":"return=minimal"}, json={"status":"error"}, timeout=5)
                    continue

                try:
                    # ── WhatsApp 발송 ──────────────────────────────────────
                    if channel == "whatsapp" or account_id == "whatsapp":
                        ai_cfg = _load_ai_settings()
                        wa_token = ai_cfg.get("wa_token", "")
                        wa_phone_id = ai_cfg.get("wa_phone_number_id", "")
                        if not wa_token or not wa_phone_id:
                            log.warning(f"[send_queue] WhatsApp 설정 없음")
                            requests.patch(f"{SB}/rest/v1/send_queue?id=eq.{row_id}", headers={**SB_H, "Prefer":"return=minimal"}, json={"status":"error"}, timeout=5)
                            continue
                        resp = requests.post(
                            f"https://graph.facebook.com/v19.0/{wa_phone_id}/messages",
                            headers={"Authorization": f"Bearer {wa_token}", "Content-Type": "application/json"},
                            json={"messaging_product":"whatsapp","to":user_id,"type":"text","text":{"body":text}},
                            timeout=10
                        )
                        if resp.status_code == 200:
                            requests.patch(f"{SB}/rest/v1/send_queue?id=eq.{row_id}", headers={**SB_H, "Prefer":"return=minimal"}, json={"status":"sent"}, timeout=5)
                            requests.post(f"{SB}/rest/v1/naver_messages", headers={**SB_H, "Prefer":"return=minimal"},
                                json={"account_id":"whatsapp","user_id":user_id,"channel":"whatsapp",
                                      "event_type":"send","message_type":"text","message_text":text,"direction":"out","is_read":True}, timeout=5)
                            log.info(f"[send_queue] WA발송 완료 → {user_id}")
                        else:
                            log.error(f"[send_queue] WA발송 실패: {resp.status_code} {resp.text[:100]}")
                            requests.patch(f"{SB}/rest/v1/send_queue?id=eq.{row_id}", headers={**SB_H, "Prefer":"return=minimal"}, json={"status":"error"}, timeout=5)


                    # ── Instagram DM 발송 ─────────────────────────────────
                    elif channel == 'instagram':
                        ig_settings = _load_ai_settings()
                        ig_tokens = ig_settings.get('ig_tokens') or {}
                        ig_token = ig_tokens.get(account_id) or ig_settings.get('ig_token') or ''
                        ig_token = ig_token.strip()
                        if not ig_token:
                            log.warning(f'[send_queue] Instagram 토큰 없음 acc={account_id}')
                            requests.patch(f'{SB}/rest/v1/send_queue?id=eq.{row_id}', headers={**SB_H, 'Prefer':'return=minimal'}, json={'status':'error'}, timeout=5)
                            continue
                        resp = requests.post(
                            f'https://graph.instagram.com/v21.0/me/messages',
                            headers={'Authorization': f'Bearer {ig_token}', 'Content-Type': 'application/json'},
                            json={'recipient':{'id':user_id},'message':{'text':text}},
                            timeout=10
                        )
                        if resp.status_code == 200:
                            requests.patch(f'{SB}/rest/v1/send_queue?id=eq.{row_id}', headers={**SB_H, 'Prefer':'return=minimal'}, json={'status':'sent'}, timeout=5)
                            _is_ai = bool(row.get('is_ai'))
                            requests.post(f'{SB}/rest/v1/naver_messages', headers={**SB_H, 'Prefer':'return=minimal'},
                                json={'account_id':account_id,'user_id':user_id,'channel':'instagram',
                                      'event_type':'send','message_type':'text','message_text':text,'direction':'out','is_read':True,'is_ai':_is_ai}, timeout=5)
                            log.info(f'[send_queue] IG발송 완료 → {user_id} (ai={_is_ai})')
                        else:
                            log.error(f'[send_queue] IG발송 실패: {resp.status_code} {resp.text[:100]}')
                            requests.patch(f'{SB}/rest/v1/send_queue?id=eq.{row_id}', headers={**SB_H, 'Prefer':'return=minimal'}, json={'status':'error'}, timeout=5)

                    # ── 네이버톡톡 발송 ────────────────────────────────────
                    else:
                        auth = NAVER_TALK_ACCOUNTS.get(account_id, {}).get("auth", "")
                        if not auth:
                            log.warning(f"[send_queue] auth 없음: {account_id}")
                            requests.patch(f"{SB}/rest/v1/send_queue?id=eq.{row_id}", headers={**SB_H, "Prefer":"return=minimal"}, json={"status":"error"}, timeout=5)
                            continue
                        resp = requests.post(
                            "https://gw.talk.naver.com/chatbot/v1/event",
                            headers={"Authorization": auth, "Content-Type": "application/json"},
                            json={"event": "send", "user": user_id, "textContent": {"text": text}},
                            timeout=10
                        )
                        if resp.status_code == 200:
                            requests.patch(f"{SB}/rest/v1/send_queue?id=eq.{row_id}", headers={**SB_H, "Prefer":"return=minimal"}, json={"status":"sent"}, timeout=5)
                            requests.post(f"{SB}/rest/v1/naver_messages", headers={**SB_H, "Prefer":"return=minimal"},
                                json={"account_id":account_id,"user_id":user_id,"channel":"naver",
                                      "event_type":"send","message_type":"text","message_text":text,"direction":"out","is_read":True}, timeout=5)
                            log.info(f"[send_queue] 발송 완료: {account_id} → {user_id}")
                        else:
                            log.error(f"[send_queue] 발송 실패: {resp.status_code}")
                            requests.patch(f"{SB}/rest/v1/send_queue?id=eq.{row_id}", headers={**SB_H, "Prefer":"return=minimal"}, json={"status":"error"}, timeout=5)

                except Exception as e:
                    log.error(f"[send_queue] 발송 오류: {e}")
                    requests.patch(f"{SB}/rest/v1/send_queue?id=eq.{row_id}", headers={**SB_H, "Prefer":"return=minimal"}, json={"status":"error"}, timeout=5)
        except Exception as e:
            log.error(f"[send_queue] 오류: {e}")
        time.sleep(2)


# ═══════════════════════════════════════════════════════════════
# 예약 리마인더 스레드 (1일전/2시간전 자동 메시지)
# ═══════════════════════════════════════════════════════════════
# reminder_thread 제거 — 미완성 로직, 필요 시 재구현


def cmd_relay_thread():
    """GitHub cmd_request.json 폴링 → 명령 실행 → cmd_result.json push"""
    import base64 as _b64
    RELAY_ALLOWED = {
        "journalctl_bliss":  lambda a: ["sudo", "journalctl", "-u", "bliss-naver.service", "-n", "80", "--no-pager"],
        "journalctl":        lambda a: ["sudo", "journalctl", "-u", a.get("service","bliss-naver.service"), "-n", str(a.get("lines",50)), "--no-pager"],
        "systemctl_restart": lambda a: ["sudo", "systemctl", "restart", a.get("service","bliss-naver.service")],
        "systemctl_status":  lambda a: ["sudo", "systemctl", "status", a.get("service","bliss-naver.service"), "--no-pager"],
        "git_log":           lambda a: ["git", "-C", "/home/ubuntu/naver-sync", "log", "--oneline", "-10"],
        "ps_python":         lambda a: ["bash", "-c", "ps aux | grep python | grep -v grep"],
        "session_check":     lambda a: ["bash", "-c", "ls -la /home/ubuntu/naver-sync/*.json 2>/dev/null"],
        "tail_log":          lambda a: ["tail", "-n", str(a.get("lines",80)), "/home/ubuntu/naver-sync/naver_sync.log"],
        "reset_fail_counts": lambda a: ["bash", "-c", "echo \'{}\' > /home/ubuntu/naver-sync/fail_counts.json && echo ok"],
        "run_shell":         lambda a: ["bash", "-c", a.get("cmd","echo ok")],

    }
    H_GH = {"Authorization": f"token {GITHUB_TOKEN}", "User-Agent": "bliss-relay"}
    REPO = "jeongwooLee1/naver-sync"
    last_id = None
    log.info("CMD Relay 스레드 시작 (Oracle 내장)")

    while True:
        try:
            r = requests.get(f"https://api.github.com/repos/{REPO}/contents/cmd_request.json", headers=H_GH, timeout=10)
            if r.status_code == 200:
                req = json.loads(_b64.b64decode(r.json()["content"]).decode())
                cmd_id = req.get("id", "")
                if cmd_id and cmd_id != last_id:
                    cmd_name = req.get("cmd", "")
                    args = req.get("args", {})
                    log.info(f"[RELAY] cmd={cmd_name} id={cmd_id}")
                    if cmd_name == "supabase_sql":
                        # Supabase Management API로 직접 SQL 실행
                        try:
                            sql_resp = requests.post(
                                "https://api.supabase.com/v1/projects/dpftlrsuqxqqeouwbfjd/database/query",
                                headers={"Authorization": "Bearer sbp_0eef72a3c7e4b25cd11b5af7b54cf812bbc2a851",
                                         "Content-Type": "application/json"},
                                json={"query": args.get("query", "SELECT 1")},
                                timeout=30
                            )
                            result = json.dumps(sql_resp.json(), ensure_ascii=False, indent=2)
                        except Exception as e:
                            result = f"ERROR: {e}"
                    elif cmd_name in RELAY_ALLOWED:
                        timeout = 120 if cmd_name == "run_shell" else 30
                        try:
                            proc = subprocess.run(RELAY_ALLOWED[cmd_name](args), capture_output=True, text=True, timeout=timeout)
                            result = (proc.stdout + proc.stderr).strip() or "(출력 없음)"
                        except Exception as e:
                            result = f"ERROR: {e}"
                    else:
                        result = f"ERROR: 허용되지 않은 명령: {cmd_name}"
                    last_id = cmd_id
                    # cmd_result.json push
                    kst = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                    result_data = {"id": cmd_id, "cmd": cmd_name, "result": result, "updated_at": kst}
                    content_b64 = _b64.b64encode(json.dumps(result_data, ensure_ascii=False).encode()).decode()
                    r2 = requests.get(f"https://api.github.com/repos/{REPO}/contents/cmd_result.json", headers=H_GH, timeout=10)
                    sha = r2.json().get("sha", "") if r2.status_code == 200 else ""
                    payload = {"message": f"result:{cmd_name}:{cmd_id}", "content": content_b64}
                    if sha: payload["sha"] = sha
                    requests.put(f"https://api.github.com/repos/{REPO}/contents/cmd_result.json", headers=H_GH, json=payload, timeout=15)
                    log.info(f"[RELAY] 완료: {cmd_name} ({len(result)}chars)")
        except Exception as e:
            log.debug(f"[RELAY] 오류: {e}")
        time.sleep(10)

# ─── Gmail IMAP 스레드 ────────────────────────────────────────────────────────


def gmail_thread():
    log.info("Gmail 스레드 시작")

    while True:
        try:
            mail = imaplib.IMAP4_SSL("imap.gmail.com")
            mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            mail.select("INBOX")
            log.info("Gmail 연결됨")

            # 초기 전체 스캔 (SINCE_DATE 이후 미처리 메일)
            criteria = f'(FROM "navercorp" SINCE {SINCE_DATE})'
            if BEFORE_DATE:
                criteria = f'(FROM "navercorp" SINCE {SINCE_DATE} BEFORE {BEFORE_DATE})'
            s, ids = mail.uid("search", None, criteria)
            if s == "OK" and ids[0]:
                uid_list = ids[0].split()
                log.info(f"초기 스캔: {len(uid_list)}개 메일 (미처리: {sum(1 for u in uid_list if not is_processed(u.decode()))}건)")

                # 날짜 오름차순 정렬 (오래된 메일부터 처리 - 상태 덮어쓰기 방지)
                dated = []
                for uid in uid_list:
                    uid_str = uid.decode() if isinstance(uid, bytes) else str(uid)
                    if is_processed(uid_str):
                        continue
                    try:
                        sd, dd = mail.uid("fetch", uid, "(INTERNALDATE)")
                        if sd == "OK":
                            import email.utils
                            raw = dd[0].decode() if isinstance(dd[0], bytes) else str(dd[0])
                            # INTERNALDATE "DD-Mon-YYYY HH:MM:SS +ZZZZ" 파싱
                            import re
                            m = re.search(r'INTERNALDATE "([^"]+)"', raw)
                            if m:
                                from email.utils import parsedate_to_datetime
                                dt = parsedate_to_datetime(m.group(1))
                                dated.append((dt, uid, uid_str))
                                continue
                    except Exception:
                        pass
                    dated.append((None, uid, uid_str))

                # None(날짜 미확인)은 맨 앞으로, 나머지는 오름차순
                dated.sort(key=lambda x: x[0] if x[0] else __import__('datetime').datetime.min.replace(tzinfo=__import__('datetime').timezone.utc))
                log.info(f"날짜 정렬 완료: {len(dated)}건 오름차순 처리 시작")

                for _, uid, uid_str in dated:
                    _proc_uid(mail, uid, uid_str)

            log.info("IMAP 폴링 대기 중...")

            while True:
                try:
                    mail.noop()
                except:
                    break

                # UNSEEN 메일 체크
                s, ids = mail.uid("search", None, '(FROM "navercorp" UNSEEN)')
                if s == "OK" and ids[0]:
                    for uid in ids[0].split():
                        uid_str = uid.decode() if isinstance(uid, bytes) else str(uid)
                        if not is_processed(uid_str):
                            _proc_uid(mail, uid, uid_str)

                time.sleep(5)

        except Exception as e:
            log.error(f"Gmail 오류: {e}")
            time.sleep(10)
        finally:
            try: mail.logout()
            except: pass


def _proc_uid(mail, uid, uid_str: str):
    s, d = mail.uid("fetch", uid, "(RFC822)")
    if s != "OK": return

    msg = email.message_from_bytes(d[0][1])
    fa  = msg.get("From", "")
    if "navercorp" not in fa and "naver" not in fa.lower():
        return

    subj = _dmh(msg["Subject"])
    body = _get_body(msg)
    log.info(f"메일 수신: {subj}")

    rid, biz_id, action, old_rid = parse_email(subj, body)

    if not rid:
        log.warning(f"  예약번호 파싱 실패 → 미처리 (재시작 시 재시도): {subj}")
        return  # processed에 추가 안 함 → 재시도 가능

    if not biz_id:
        log.warning(f"  지점 파싱 실패 → 미처리 (재시작 시 재시도): {subj}")
        return  # processed에 추가 안 함 → 재시도 가능

    # 파싱 성공 시에만 processed 저장
    save_processed(uid_str)

    if TEST_BIZ_FILTER and biz_id != TEST_BIZ_FILTER:
        return

    # 변경 메일: old_rid 취소는 rid 중복 여부와 무관하게 항상 실행
    if action == "change" and old_rid:
        _cancel_old_reservation(old_rid, rid)
        # 새 예약의 prev_reservation_id도 업데이트
        try:
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/reservations?reservation_id=eq.{rid}",
                headers={**HEADERS, "Prefer": "return=minimal"},
                json={"prev_reservation_id": old_rid},
                timeout=10
            )
        except Exception:
            pass

    with queued_lock:
        if rid in queued_set:
            log.info(f"  #{rid} 이미 큐에 있음 → 스킵")
            return
        if fail_counts.get(rid, 0) >= 3:
            log.warning(f"  #{rid} 영구 스킵 (실패 {fail_counts[rid]}회)")
            return
        queued_set.add(rid)
        task_queue.put((rid, biz_id, action, old_rid))

    if old_rid:
        log.info(f"  → 큐 추가: #{rid}  biz={biz_id}  action={action}  구예약=#{old_rid}")
    else:
        log.info(f"  → 큐 추가: #{rid}  biz={biz_id}  action={action}")


# ─── 메인 ─────────────────────────────────────────────────────────────────────
def session_keepalive_thread():
    """매일 새벽 4시 - 네이버 세션 유지 API 호출"""
    from datetime import datetime, timezone, timedelta
    KST = timezone(timedelta(hours=9))

    # 첫 실행 시 오늘 새벽 4시까지 대기, 이미 지났으면 내일
    def next_4am():
        now = datetime.now(KST)
        target = now.replace(hour=4, minute=0, second=0, microsecond=0)
        if now >= target:
            target = target.replace(day=target.day + 1)
        return (target - now).total_seconds()

    log.info("⏰ 세션 유지 스레드 시작 (매일 04:00 KST 실행)")
    while True:
        wait_sec = next_4am()
        log.info(f"⏰ 다음 세션 유지: {wait_sec/3600:.1f}시간 후")
        time.sleep(wait_sec)

        # 네이버 파트너센터 메인 페이지 호출 (세션 연장 목적)
        try:
            mtime = os.path.getmtime(SESSION_FILE)
            session_data = json.load(open(SESSION_FILE))
            cookies = {c["name"]: c["value"] for c in session_data.get("cookies", [])}
            hdrs = {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                "Referer": "https://partner.booking.naver.com/",
                "Accept": "application/json",
            }
            # 첫 번째 등록된 biz_id로 예약 목록 조회 (가벼운 호출)
            test_biz_id = list(_branches.values())[0].get("naver_biz_id") if _branches else None
            if not test_biz_id:
                # branches에서 직접 조회
                rb = requests.get(
                    f"{SUPABASE_URL}/rest/v1/branches?select=naver_biz_id&naver_biz_id=not.is.null&limit=1",
                    headers=HEADERS, timeout=5
                )
                rows = rb.json()
                test_biz_id = rows[0]["naver_biz_id"] if rows else None

            if test_biz_id:
                url = f"https://partner.booking.naver.com/api/businesses/{test_biz_id}/bookings?page=1&size=1"
                r = requests.get(url, cookies=cookies, headers=hdrs, timeout=15)
                if r.status_code == 200:
                    log.info(f"✅ 세션 유지 성공 (biz={test_biz_id}, status=200)")
                    _session_cache["cookies"] = None  # 캐시 갱신 강제
                elif r.status_code == 204:
                    log.info(f"✅ 세션 유지 성공 (biz={test_biz_id}, status=204 - 예약 없음)")
                    _session_cache["cookies"] = None
                else:
                    log.warning(f"⚠️ 세션 유지 실패 (status={r.status_code}) → 알림 발송")
                    send_session_alert(f"세션 유지 실패 (status={r.status_code}) - login_local.py 실행 필요")
            else:
                log.warning("⚠️ 세션 유지: biz_id 없음")
        except Exception as e:
            log.error(f"세션 유지 오류: {e}")


if __name__ == "__main__":
    log.info("=" * 50)
    log.info("Bliss × 네이버 예약 동기화 v3 시작")
    log.info("=" * 50)

    load_cache()
    load_fail_counts()
    load_processed()

    t1 = threading.Thread(target=scraper_thread, daemon=True, name="scraper")
    t1.start()
    time.sleep(2)

    t2 = threading.Thread(target=gmail_thread, daemon=True, name="gmail")
    t2.start()

    t3_list = []
    for i in range(3):
        t3 = threading.Thread(target=ai_thread, daemon=True, name=f"ai-{i+1}")
        t3.start()
        t3_list.append(t3)

    t4 = threading.Thread(target=session_keepalive_thread, daemon=True, name="keepalive")
    t4.start()

    t5 = threading.Thread(target=cmd_relay_thread, daemon=True, name="relay")
    t5.start()

    t7 = threading.Thread(target=alimtalk_thread, daemon=True, name="alimtalk")
    t7.start()

    t8 = threading.Thread(target=naver_talk_webhook_thread, daemon=True, name="naver_talk")
    t8.start()
    t10 = threading.Thread(target=send_queue_thread, daemon=True, name="send_queue")
    t10.start()

    t11 = threading.Thread(target=telegram_bot_thread, daemon=True, name="telegram_bot")
    t11.start()

    while True:
        time.sleep(20)

        # ── Watchdog: 죽은 스레드 자동 재시작 ──
        if not t1.is_alive():
            log.error("⚠️  스크래퍼 스레드 DEAD → 재시작")
            t1 = threading.Thread(target=scraper_thread, daemon=True, name="scraper")
            t1.start()

        if not t2.is_alive():
            log.error("⚠️  Gmail 스레드 DEAD → 재시작")
            t2 = threading.Thread(target=gmail_thread, daemon=True, name="gmail")
            t2.start()

        if not t4.is_alive():
            log.error("⚠️  세션 유지 스레드 DEAD → 재시작")
            t4 = threading.Thread(target=session_keepalive_thread, daemon=True, name="keepalive")
            t4.start()

        if not t5.is_alive():
            log.error("⚠️  CMD Relay 스레드 DEAD → 재시작")
            t5 = threading.Thread(target=cmd_relay_thread, daemon=True, name="relay")
            t5.start()

        if not t8.is_alive():
            log.error("⚠️  네이버톡톡 Webhook 스레드 DEAD → 재시작")
            t8 = threading.Thread(target=naver_talk_webhook_thread, daemon=True, name="naver_talk")
            t8.start()

        for i, t3 in enumerate(t3_list):
            if not t3.is_alive():
                log.error(f"⚠️  AI 분석 스레드 ai-{i+1} DEAD → 재시작")
                t3_list[i] = threading.Thread(target=ai_thread, daemon=True, name=f"ai-{i+1}")
                t3_list[i].start()

        scraper_st = 'alive' if t1.is_alive() else 'DEAD'
        gmail_st   = 'alive' if t2.is_alive() else 'DEAD'
        ai_alive   = sum(1 for t in t3_list if t.is_alive())
        q_size     = task_queue.qsize()

        log.info(f"상태: 큐 대기 {q_size}건 | scraper={scraper_st} | gmail={gmail_st} | ai={ai_alive}/3")

        # Supabase server_logs 업데이트 (Claude 모니터링용)
        try:
            import socket
            hostname = socket.gethostname()
            try:
                local_ip = socket.gethostbyname(socket.getfqdn())
            except Exception:
                local_ip = "unknown"
            # 서버 구분: Oracle=10.0.0.x, naver-sync=그 외
            if local_ip.startswith("10.0.0."):
                server_label = "oracle(158.179.174.30)"
            else:
                server_label = "naver-sync(27.1.36.102)"
            server_id = f"bliss-naver-{server_label}"
            requests.post(
                f"{SUPABASE_URL}/rest/v1/server_logs",
                headers={**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
                json={
                    "id": server_id,
                    "server": server_label,
                    "scraper_status": scraper_st,
                    "gmail_status": gmail_st,
                    "queue_size": q_size,
                    "extra": {"scraper_version": SCRAPER_V},
                    "updated_at": datetime.utcnow().isoformat() + "Z",
                },
                timeout=5
            )
        except Exception as _e:
            log.debug(f"server_logs 업데이트 실패: {_e}")


