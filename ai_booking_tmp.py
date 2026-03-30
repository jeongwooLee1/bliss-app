"""AI 예약 접수 에이전트 - bliss_naver.py에서 import하여 사용"""
import requests, json, logging, re, os, time, random, string
from datetime import datetime, timezone, timedelta

log = logging.getLogger("bliss")
KST = timezone(timedelta(hours=9))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://dpftlrsuqxqqeouwbfjd.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnRscnN1cXhxcWVvdXdiZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDU4MjQsImV4cCI6MjA4NzQ4MTgyNH0.iydEkjtPjZ0jXpUUPJben4IWWneDqLomv-HDlcFayE4")
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}
BUSINESS_ID = "biz_khvurgshb"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

ACC_BRANCH = {
    "101171979": ("br_4bcauqvrb", "강남본점"),
    "102071377": ("br_wkqsxj6k1", "왕십리점"),
    "102507795": ("br_l6yzs2pkq", "홍대점"),
    "101521969": ("br_k57zpkbx1", "마곡점"),
    "101522539": ("br_lfv2wgdf1", "잠실점"),
    "101517367": ("br_g768xdu4w", "위례점"),
    "101476019": ("br_ybo3rmulv", "용산점"),
    "101988152": ("br_xu60omgdf", "천호점"),
    # Instagram IG IDs
    "17841400218759830": ("br_4bcauqvrb", "강남본점"),
    "17841455170480955": ("br_4bcauqvrb", "서울점"),
    "17841451286389128": ("br_wkqsxj6k1", "왕십리점"),
    "17841424540907024": ("br_l6yzs2pkq", "홍대점"),
    "17841424994371009": ("br_k57zpkbx1", "마곡점"),
    "17841449388904548": ("br_lfv2wgdf1", "잠실점"),
    "17841445864668171": ("br_ybo3rmulv", "용산점"),
}

_cache = {"services": None, "gemini_key": None, "ts": 0}

def _load_cache():
    now = time.time()
    if _cache["services"] and now - _cache["ts"] < 300:
        return
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/services?business_id=eq.{BUSINESS_ID}&select=id,name,dur,price_f,price_m&order=sort", headers=HEADERS, timeout=10)
        _cache["services"] = r.json() if r.ok else []
    except:
        _cache["services"] = _cache["services"] or []
    try:
        r2 = requests.get(f"{SUPABASE_URL}/rest/v1/businesses?id=eq.{BUSINESS_ID}&select=settings", headers=HEADERS, timeout=10)
        rows = r2.json() if r2.ok else []
        cfg = json.loads((rows[0].get("settings") or "{}")) if rows else {}
        _cache["gemini_key"] = cfg.get("gemini_key", "") or cfg.get("system_gemini_key", "") or os.environ.get("BLISS_GEMINI_KEY", "")
    except:
        pass
    _cache["ts"] = now

def _gemini(prompt, timeout=30):
    _load_cache()
    key = _cache.get("gemini_key", "")
    if not key:
        return ""
    try:
        resp = requests.post(
            GEMINI_URL + f"?key={key}",
            json={"contents": [{"parts": [{"text": prompt}]}],
                  "generationConfig": {"temperature": 0.3, "maxOutputTokens": 4096}},
            timeout=timeout
        )
        if resp.status_code == 200:
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        log.warning(f"[ai_booking] Gemini {resp.status_code}")
    except Exception as e:
        log.warning(f"[ai_booking] Gemini err: {e}")
    return ""


# 인스타 페이지ID → 계정명 매핑
IG_ACCOUNT_NAME = {
    "17841400218759830": "housewaxing_official",
}

# 채널별 예약경로 매핑
CHANNEL_SOURCE_MAP = {
    "instagram": "인스타",
    "naver": "네이버",
    "whatsapp": "WhatsApp",
    "kakaotalk": "카톡",
    "phone": "전화",
}
# 신규 고객 태그 ID
NEW_CUST_TAG_ID = "lggzktc9f"
def _gen_id():
    return "ai_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=12))

def _load_history(account_id, user_id, limit=10):
    """Load conversation history (last 3 days, up to 50 messages)."""
    try:
        cutoff = (datetime.now(KST) - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S")
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/naver_messages?account_id=eq.{account_id}&user_id=eq.{user_id}"
            f"&direction=neq.system&created_at=gte.{cutoff}&order=created_at.desc&limit=50&select=direction,message_text,created_at",
            headers=HEADERS, timeout=10
        )
        msgs = r.json() if r.ok else []
        msgs.reverse()
        return msgs
    except:
        return []

def check_availability(branch_id, date, time_str, dur=60):
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/reservations?bid=eq.{branch_id}&date=eq.{date}"
            f"&status=neq.naver_cancelled&status=neq.cancelled&select=time,dur",
            headers=HEADERS, timeout=10
        )
        existing = r.json() if r.ok else []
        r2 = requests.get(f"{SUPABASE_URL}/rest/v1/rooms?branch_id=eq.{branch_id}&select=id", headers=HEADERS, timeout=10)
        rooms = r2.json() if r2.ok else []
        max_slots = max(len(rooms), 3)

        h, m = int(time_str.split(":")[0]), int(time_str.split(":")[1])
        new_start = h * 60 + m
        new_end = new_start + dur

        overlap = sum(1 for e in existing
            if new_start < int(e["time"].split(":")[0])*60+int(e["time"].split(":")[1])+(e.get("dur") or 60)
            and int(e["time"].split(":")[0])*60+int(e["time"].split(":")[1]) < new_end)

        if overlap < max_slots:
            return True, ""
        for offset in [30, -30, 60, -60, 90, -90]:
            alt = new_start + offset
            if alt < 0 or alt >= 24*60: continue
            alt_end = alt + dur
            alt_overlap = sum(1 for e in existing
                if alt < int(e["time"].split(":")[0])*60+int(e["time"].split(":")[1])+(e.get("dur") or 60)
                and int(e["time"].split(":")[0])*60+int(e["time"].split(":")[1]) < alt_end)
            if alt_overlap < max_slots:
                return False, f"{alt//60:02d}:{alt%60:02d}"
        return False, ""
    except Exception as e:
        log.warning(f"[ai_booking] avail err: {e}")
        return True, ""


def _get_display_id(channel, account_id, user_id):
    """채널별 표시용 ID 반환: instagram → @username, naver → user_id[:12]"""
    if channel == "instagram":
        ig_acct = IG_ACCOUNT_NAME.get(account_id, "")
        cust_name = ""
        try:
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/naver_messages?channel=eq.instagram&user_id=eq.{user_id}&user_name=not.is.null&select=user_name&limit=1",
                headers={k:v for k,v in HEADERS.items() if k != "Content-Type"}, timeout=5)
            rows = r.json() if r.ok else []
            if rows and rows[0].get("user_name"):
                cust_name = "@" + rows[0]["user_name"]
        except: pass
        if not cust_name:
            cust_name = user_id[:12]
        return f"{ig_acct}>{cust_name}" if ig_acct else cust_name
    return user_id[:12]

def find_existing_booking(phone, name, branch_id):
    """고객 전화번호/이름으로 기존 예약 검색. 가장 최근 예약 반환."""
    today = datetime.now(KST).strftime("%Y-%m-%d")
    try:
        # 전화번호로 검색 (우선)
        if phone:
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/reservations?cust_phone=eq.{phone}"
                f"&business_id=eq.{BUSINESS_ID}&date=gte.{today}"
                f"&status=in.(confirmed,pending,request)"
                f"&order=date.desc&limit=1",
                headers={k:v for k,v in HEADERS.items() if k != "Content-Type"}, timeout=10)
            rows = r.json() if r.ok else []
            if rows:
                return rows[0]
        # 이름으로 검색
        if name:
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/reservations?cust_name=eq.{name}"
                f"&business_id=eq.{BUSINESS_ID}&date=gte.{today}"
                f"&status=in.(confirmed,pending,request)"
                f"&order=date.desc&limit=1",
                headers={k:v for k,v in HEADERS.items() if k != "Content-Type"}, timeout=10)
            rows = r.json() if r.ok else []
            if rows:
                return rows[0]
    except Exception as e:
        log.warning(f"[ai_booking] find existing err: {e}")
    return None

def cancel_booking(reservation_id):
    """기존 예약 취소 (변경 시 기존 건 삭제용)"""
    try:
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/reservations?id=eq.{reservation_id}",
            headers={**HEADERS, "Prefer": "return=minimal"},
            json={"status": "cancelled", "memo": "[AI] 변경으로 인한 자동취소"},
            timeout=10)
        if r.ok:
            log.info(f"[ai_booking] cancelled old booking: {reservation_id}")
            return True
    except Exception as e:
        log.warning(f"[ai_booking] cancel err: {e}")
    return False

def create_booking_from_ai(booking, account_id, user_id, is_change=False, channel='naver'):
    branch_id, branch_name = ACC_BRANCH.get(account_id, ("", ""))
    if not branch_id: return None

    phone = re.sub(r"[^0-9]", "", booking.get("custPhone", ""))
    if phone and not phone.startswith("0"): phone = "0" + phone
    name = booking.get("custName", "")

    # 기존 예약 검색 → 있으면 취소 (변경 처리)
    existing = find_existing_booking(phone, name, branch_id)
    if existing:
        cancel_booking(existing["id"])
        log.info(f"[ai_booking] 기존 예약 취소 후 변경 등록: {existing['id']}")

    cust_id = ""
    cust_email = booking.get("custEmail", "")
    _h_noct = {k:v for k,v in HEADERS.items() if k != "Content-Type"}
    if phone:
        try:
            r = requests.get(f"{SUPABASE_URL}/rest/v1/customers?phone=eq.{phone}&business_id=eq.{BUSINESS_ID}&select=id&limit=1", headers=_h_noct, timeout=10)
            rows = r.json() if r.ok else []
            if rows: cust_id = rows[0]["id"]
        except: pass
    if not cust_id and cust_email:
        try:
            r = requests.get(f"{SUPABASE_URL}/rest/v1/customers?email=eq.{cust_email}&business_id=eq.{BUSINESS_ID}&select=id&limit=1", headers=_h_noct, timeout=10)
            rows = r.json() if r.ok else []
            if rows: cust_id = rows[0]["id"]
        except: pass
    # Create customer if not found and we have name
    if not cust_id and name:
        try:
            new_cid = f"cust_ai_{rid[:8]}"
            cust_row = {"id": new_cid, "business_id": BUSINESS_ID, "bid": branch_id, "name": name, "phone": phone, "gender": booking.get("gender", "")}
            if cust_email: cust_row["email"] = cust_email
            requests.post(f"{SUPABASE_URL}/rest/v1/customers", headers={**HEADERS, "Prefer": "return=minimal"}, json=cust_row, timeout=10)
            cust_id = new_cid
            log.info(f"[ai_booking] customer created: {name} {phone or cust_email}")
        except: pass
    elif cust_id and cust_email:
        try:
            requests.patch(f"{SUPABASE_URL}/rest/v1/customers?id=eq.{cust_id}", headers={**HEADERS, "Prefer": "return=minimal"}, json={"email": cust_email}, timeout=5)
        except: pass

    _load_cache()
    svc_name = booking.get("service", "")
    matched_svc = []
    for s in (_cache.get("services") or []):
        if svc_name and svc_name.lower() in s["name"].lower():
            matched_svc.append(s["id"]); break
    if not matched_svc:
        for kw in ["브라질리언","비키니","겨드랑이","에너지","눈썹","항문","허벅지","종아리","풀바디"]:
            if kw in (svc_name or "").lower():
                for s in (_cache.get("services") or []):
                    if kw in s["name"].lower(): matched_svc.append(s["id"]); break
                break

    rid = _gen_id()
    _display_id = _get_display_id(channel, account_id, user_id)
    row = {
        "id": rid, "business_id": BUSINESS_ID, "bid": branch_id,
        "type": "reservation", "status": "request", "source": CHANNEL_SOURCE_MAP.get(channel, "ai_booking"),
        "cust_id": cust_id, "cust_name": name, "cust_phone": phone,
        "cust_gender": booking.get("gender", ""),
        "date": booking.get("date", ""), "time": booking.get("time", ""),
        "dur": int(booking.get("dur", 0)) or 45,
        "selected_services": matched_svc, "selected_tags": [],
        "is_schedule": False, "is_new_cust": not bool(cust_id),
        "is_scraping_done": True,
        "repeat": "none", "repeat_until": "", "repeat_group_id": "",
        "room_id": "", "staff_id": "", "service_id": "", "reservation_id": rid,
        "memo": (f"[AI예약변경][{channel}] {_display_id}" if existing else f"[AI예약][{channel}] {_display_id}"), "owner_comment": "",
    }
    try:
        r = requests.post(f"{SUPABASE_URL}/rest/v1/reservations", headers={**HEADERS, "Prefer": "return=minimal"}, json=row, timeout=10)
        if r.ok:
            log.info(f"[ai_booking] created: {name} {booking.get('date','')} {booking.get('time','')} {branch_name}")
            _tg_notify(f"AI 예약 신청\n{name} {phone}\n{booking.get('date','')} {booking.get('time','')}\n{branch_name} {svc_name}")
            return rid
        log.error(f"[ai_booking] insert fail: {r.status_code} {r.text[:200]}")
    except Exception as e:
        log.error(f"[ai_booking] insert err: {e}")
    return None

def _tg_notify(text):
    try:
        token = os.environ.get("TG_TOKEN", "")
        chat = os.environ.get("TG_CHAT", "")
        if token and chat:
            requests.post(f"https://api.telegram.org/bot{token}/sendMessage", data={"chat_id": chat, "text": text}, timeout=5)
    except: pass

def ai_booking_agent(user_msg, account_id, user_id, channel="naver"):
    """AI 예약 접수 에이전트. 반환: 고객에게 보낼 메시지"""
    # AI 자동답변 채널별 활성화 체크 (businesses.settings.ai_auto_reply_channels)
    log.info(f"[ai_booking] called: channel={channel} user={user_id[:16]}")
    try:
        _r = requests.get(f"{SUPABASE_URL}/rest/v1/businesses?id=eq.{BUSINESS_ID}&select=settings", headers=HEADERS, timeout=5)
        _raw_s = _r.json()[0].get("settings", "{}") if _r.ok else "{}"
        _settings = json.loads(_raw_s) if isinstance(_raw_s, str) else (_raw_s or {})
        _channels = _settings.get("ai_auto_reply_channels", {})
        if not _channels.get(channel, False):
            return ""
    except:
        return ""

    branch_id, branch_name = ACC_BRANCH.get(account_id, ("", "하우스왁싱"))
    history = _load_history(account_id, user_id)
    history_text = ""
    for m in history:
        role = "고객" if m["direction"] == "in" else "상담원"
        history_text += f"{role}: {m['message_text']}\n"
    history_text += f"고객: {user_msg}\n"

    _load_cache()
    price_table = ""
    for s in (_cache.get("services") or []):
        pf = f"{s.get('price_f',0):,}" if s.get('price_f') else "-"
        pm = f"{s.get('price_m',0):,}" if s.get('price_m') else "-"
        price_table += f"- {s['name']} / {s.get('dur',0)}분 / 여:{pf}원 / 남:{pm}원\n"

    branches = ", ".join(b[1] for b in ACC_BRANCH.values())
    today = datetime.now(KST).strftime("%Y-%m-%d (%a)")

    existing_bookings = ""

    prompt = f"""당신은 하우스왁싱 {branch_name} 예약 접수 AI입니다.

[업체 정보]
하우스왁싱: 2006년 창업, 서울 8개 직영 왁싱살롱, 전지점 동일가격, 연중무휴
지점: {branches}
영업시간: 보통 10:00~22:00 (지점별 상이)
[여성 가격표]
바디왁싱:
- 배/가슴: 10,000~30,000 | 유두: 10,000
- 등: 전체 50,000 / 반 30,000
- 팔: 전체 70,000 / 반 40,000
- 겨드랑이: 20,000 | 손: 전체 20,000 / 반 10,000
- 엉덩이: 10,000~30,000 | 다리: 전체 90,000 / 반 50,000
- 발: 10,000
- 풀바디(음모제외): 370,000 | 풀바디(음모포함): 400,000

페이스왁싱:
- 인중: 15,000 | 볼: 20,000~50,000
- 이마: 30,000 | 눈썹: 45,000
- 헤어라인: 30,000 | 턱: 10,000~30,000
- 앞목: 10,000~30,000 | 뒷목: 30,000
- 풀페이스 패키지: 190,000 (풀페이스+이온+아이스쿨러+톤업모델링)
- 브라질리언+풀페이스 동시: 40,000 할인

브라질리언왁싱:
- 브라질리언: 154,000 → 104,000
- 브라질리언+케어: 187,000 → 107,000
- 브라질리언+궁테라피: 220,000 → 140,000
- 비키니/항문: 55,000 / 33,000

속눈썹펌: 45,000

[남성 가격표]
바디왁싱:
- 배/가슴: 10,000~40,000 | 유두: 10,000
- 등: 전체 70,000 / 반 40,000
- 팔: 전체 90,000 / 반 60,000
- 겨드랑이: 30,000 | 손: 전체 20,000 / 반 10,000
- 엉덩이: 10,000~50,000 | 다리: 전체 110,000 / 반 70,000
- 발: 10,000
- 풀바디(음모제외): 480,000 | 풀바디(음모포함): 550,000

페이스왁싱:
- 인중: 25,000 | 볼: 30,000~70,000
- 이마: 40,000 | 눈썹: 45,000
- 헤어라인: 30,000 | 턱: 30,000~50,000
- 앞목: 10,000~30,000 | 뒷목: 30,000
- 풀페이스 패키지: 220,000
- 브라질리언+풀페이스 동시: 45,000 할인

브라질리언왁싱:
- 브라질리언: 176,000 → 126,000
- 브라질리언+케어: 209,000 → 129,000
- 브라질리언+머슬랜더: 242,000 → 162,000
- 비키니/항문: 88,000 / 55,000

속눈썹펌: 45,000

모든 가격은 원(KRW).

[가격 안내 규칙]
★ 풀바디 = 패키지 가격 사용! 개별 부위 합산 금지!
★ 풀바디(음모제외): 여 370,000 / 남 480,000
★ 풀바디(음모포함=브라질리언 포함): 여 400,000 / 남 550,000
★ 고객이 "풀바디+브라질리언" 요청 시 → 풀바디(음모포함) 가격 안내
★ 브라질리언 가격은 할인가(→ 뒤의 금액)로 안내
★ 풀페이스 = 패키지 가격 사용! 개별 부위 합산 금지!
★ 풀페이스 패키지: 여 190,000 / 남 220,000 (풀페이스왁싱+이온+아이스쿨러+톤업모델링 포함)
★ 브라질리언+풀페이스 동시: 여 40,000 할인 / 남 45,000 할인
가격 상세: housewaxing.com/brazilianwaxing_price_info

[DB 시술 가격표 (예약등록용)]
{price_table}

[오늘] {today}
[현재 지점] {branch_name}
{existing_bookings}

[대화]
{history_text}

[말투]
- 20대 발랄한 여성 상담원의 정중하고 친근한 말투
- 예: "안녕하세요~ 하우스왁싱입니다! 😊", "네~ 알겠습니다!", "감사합니다~ 💕"
- 이모지 적절히 사용 (과하지 않게)
- 존댓말 필수

[핵심규칙 - 반드시 따를 것]
★ 가격/비용을 묻는 메시지에는 성별을 묻지 말고 여성/남성 가격을 둘 다 바로 알려줘!
★ 예시 답변: "다리+팔+겨드랑이+브라질리언 가격 안내드려요~
여성: 다리 90,000 + 팔 70,000 + 겨드랑이 20,000 + 브라질리언 104,000 = 284,000원
남성: 다리 110,000 + 팔 90,000 + 겨드랑이 30,000 + 브라질리언 126,000 = 356,000원
예약 도와드릴까요? 😊"
★ 성별을 물어보는 것 자체가 금지! 가격 안내 시에는 무조건 남녀 둘 다 보여주기!
★ 가격 문의 시: 성별 모르면 여성/남성 가격 둘 다 알려주기. 성별 알면 해당 가격만
★ 대화 히스토리를 반드시 읽고, 이미 언급된 정보(이름, 연락처, 시술, 지점, 성별, 날짜, 시간)는 절대 다시 묻지 마세요!
★ 고객이 성별을 이미 말했으면(male/female/남/여) 절대 다시 묻지 말고 바로 booking에 반영!
★ 예약 변경 요청 시: 기존 예약 정보를 히스토리에서 가져와서 변경된 부분만 반영하여 바로 book action 사용
★ 이미 아는 고객이 시간만 바꾸려고 하면 바로 예약 변경 처리. 추가 질문 금지!
★ "sir/ma'am" 같은 성별 구분 호칭 사용 금지. 고객님/~님 호칭 사용
★ 예약에 필요한 정보를 한번에 다 물어보지 말고, 고객 질문에 먼저 답한 후 자연스럽게 1~2개씩 물어보기

[규칙]
1. 2-3문장 이내, reply는 100자 이내로 짧고 간결하게
2. 고객이 이름을 알려주면 반드시 "OO님" 호칭 사용. 이름 모르면 "고객님"
3. 예약 의도 감지 시 필수정보 수집: 성함, 연락처(또는 이메일), 날짜, 시간, 시술. 단, 대화에서 이미 나온 정보는 재질문 금지!
12. 한국 연락처(010)가 없는 외국인 고객은 이메일 주소를 요청하세요. 이메일만으로도 예약 접수 가능합니다. custPhone 대신 custEmail에 이메일을 넣으세요.
4. 지점은 {branch_name} 기본
5. 정보 완성되면 예약 요약 후 등록
6. 예약 등록 후 "예약 접수완료! 담당자 확인 후 확정 안내드릴게요~" 말하기. 절대 "예약 확정"이라고 하지 않기
7. 거짓 정보 생성 금지. 모르면 "확인 후 안내드릴게요~"
8. 한국어 답변
9. 이미 예약이 있는 고객이 변경 요청하면 기존 예약 정보를 활용하여 변경된 부분만 반영해 book action 사용
10. 취소만 요청 시 "담당자에게 전달드릴게요~" 안내
11. 예약 가능 여부를 절대 스스로 판단하지 마. 무조건 book action으로 예약 등록해. 서버가 자동으로 가용성 체크함
13. 특정 담당자/관리사 이름을 절대 언급하지 마. 담당자 배정은 업체에서 함. "담당자가 배정됩니다" 정도만 안내

[응답 - JSON만 출력]
{{"reply":"고객메시지","action":"chat|ask_info|book","booking":null 또는 {{"custName":"","custPhone":"","custEmail":"","date":"YYYY-MM-DD","time":"HH:MM","service":"시술명","dur":분,"gender":"M|F|"}}}}

action: chat=일반대화, ask_info=정보부족질문, book=예약등록
JSON만 출력. 백틱/설명 없이."""

    log.info(f"[ai_booking] calling gemini...")
    raw = _gemini(prompt)
    log.info(f"[ai_booking] gemini raw: {raw[:80] if raw else chr(69)+chr(77)+chr(80)+chr(84)+chr(89)}")
    if not raw: return ""

    try:
        clean = re.sub(r'^```json?\s*', '', raw.strip())
        clean = re.sub(r'```\s*$', '', clean.strip())
        result = json.loads(clean)
    except:
        # truncated JSON recovery
        try:
            if "reply" in raw:
                m = re.search(r'"reply"\s*:\s*"((?:[^"\]|\.)*)"?', raw)
                if m:
                    log.warning(f"[ai_booking] parse fail, recovered reply")
                    return m.group(1)
        except: pass
        log.warning(f"[ai_booking] parse fail: {raw[:200]}")
        return ""

    reply = result.get("reply", "")
    action = result.get("action", "chat")
    booking = result.get("booking")

    if action == "book" and booking:
        date = booking.get("date", "")
        time_val = booking.get("time", "")
        dur = int(booking.get("dur", 0)) or 45
        if date and time_val:
            ok, alt = check_availability(branch_id, date, time_val, dur)
            if not ok:
                reply = f"죄송합니다, {time_val}은 예약이 어렵습니다." + (f" {alt}은 가능한데 어떠세요?" if alt else " 다른 시간은 어떠세요?")
            else:
                rid = create_booking_from_ai(booking, account_id, user_id, channel=channel)
                if not rid:
                    reply = "죄송합니다, 예약 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."

    return reply
