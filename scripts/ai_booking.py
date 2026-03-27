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

def _gemini(prompt, timeout=15):
    _load_cache()
    key = _cache.get("gemini_key", "")
    if not key:
        return ""
    try:
        resp = requests.post(
            GEMINI_URL + f"?key={key}",
            json={"contents": [{"parts": [{"text": prompt}]}],
                  "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1024}},
            timeout=timeout
        )
        if resp.status_code == 200:
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        log.warning(f"[ai_booking] Gemini {resp.status_code}")
    except Exception as e:
        log.warning(f"[ai_booking] Gemini err: {e}")
    return ""

def _gen_id():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=10))

def _load_history(account_id, user_id, limit=10):
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/naver_messages?account_id=eq.{account_id}&user_id=eq.{user_id}"
            f"&direction=neq.system&order=created_at.desc&limit={limit}&select=direction,message_text,created_at",
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

def create_booking_from_ai(booking, account_id, user_id):
    branch_id, branch_name = ACC_BRANCH.get(account_id, ("", ""))
    if not branch_id: return None

    phone = re.sub(r"[^0-9]", "", booking.get("custPhone", ""))
    if phone and not phone.startswith("0"): phone = "0" + phone
    name = booking.get("custName", "")

    cust_id = ""
    if phone:
        try:
            r = requests.get(f"{SUPABASE_URL}/rest/v1/customers?phone=eq.{phone}&business_id=eq.{BUSINESS_ID}&select=id&limit=1", headers=HEADERS, timeout=10)
            rows = r.json() if r.ok else []
            if rows: cust_id = rows[0]["id"]
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
    row = {
        "id": rid, "business_id": BUSINESS_ID, "bid": branch_id,
        "type": "reservation", "status": "request", "source": "ai_booking",
        "cust_id": cust_id, "cust_name": name, "cust_phone": phone,
        "cust_gender": booking.get("gender", ""),
        "date": booking.get("date", ""), "time": booking.get("time", ""),
        "dur": int(booking.get("dur", 0)) or 45,
        "selected_services": matched_svc, "selected_tags": [],
        "is_schedule": False, "is_new_cust": not bool(cust_id),
        "is_scraping_done": True,
        "repeat": "none", "repeat_until": "", "repeat_group_id": "",
        "room_id": "", "staff_id": "", "service_id": "",
        "memo": f"[AI예약] {user_id[:12]}", "owner_comment": "",
    }
    try:
        r = requests.post(f"{SUPABASE_URL}/rest/v1/reservations", headers={**HEADERS, "Prefer": "return=minimal"}, json=row, timeout=10)
        if r.ok:
            log.info(f"[ai_booking] created: {name} {booking.get('date','')} {booking.get('time','')} {branch_name}")
            _tg_notify(f"AI 예약 신청\n{name} {phone}\n{booking.get('date','')} {booking.get('time','')}\n{branch_name} {svc_name}")
            return rid
        log.error(f"[ai_booking] insert fail: {r.status_code}")
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
    # [테스트 모드] 허용된 user_id만 AI 응답. 라이브 전환 시 이 블록 제거.
    TEST_ALLOWED_USERS = {"yFmYTBWlng99H__AQomwMA"}
    if user_id not in TEST_ALLOWED_USERS:
        return ""

    branch_id, branch_name = ACC_BRANCH.get(account_id, ("", "하우스왁싱"))
    history = _load_history(account_id, user_id, limit=10)
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

    # 이 고객의 기존 예약 확인
    existing_bookings = ""
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/reservations?select=date,time,status,cust_name,bid"
            f"&business_id=eq.{BUSINESS_ID}&status=in.(confirmed,pending,request)"
            f"&date=gte.{datetime.now(KST).strftime('%Y-%m-%d')}"
            f"&order=date.asc&limit=5",
            headers={k:v for k,v in HEADERS.items() if k != "Content-Type"}, timeout=10
        )
        if r.ok:
            # user_id 기반으로 고객 이름 찾기 (대화에서)
            for msg in history:
                if msg.get("direction") == "in":
                    pass  # 대화에서 이름 추출은 AI가 알아서
            # 이 account_id(지점)의 기존 예약
            brs = r.json() if r.ok else []
            if brs:
                existing_bookings = "\n[이 지점의 향후 예약 현황]\n"
                for b in brs[:10]:
                    existing_bookings += f"- {b['date']} {b['time']} {b.get('cust_name','')} ({b['status']})\n"
    except:
        pass

    prompt = f"""당신은 하우스왁싱 {branch_name} 예약 접수 AI입니다.

[업체 정보]
하우스왁싱: 2006년 창업, 서울 8개 직영 왁싱살롱, 전지점 동일가격, 연중무휴
지점: {branches}
영업시간: 보통 10:00~22:00 (지점별 상이)
가격 상세: housewaxing.com/brazilianwaxing_price_info

[시술 가격표]
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

[규칙]
1. 2-3문장 이내로 답변
2. 고객이 이름을 알려주면 반드시 "OO님" 호칭 사용. 이름 모르면 "고객님"
3. 예약 의도 감지 시 필수정보 수집: 성함, 연락처, 날짜, 시간, 시술
4. 지점은 {branch_name} 기본. 이미 아는 정보는 재질문 안 함
5. 정보 완성되면 예약 요약 후 등록
6. "신청 상태이며 담당자 확인 후 확정 안내" 말하기
7. 거짓 정보 생성 금지. 모르면 "확인 후 안내드릴게요~"
8. 한국어 답변
9. 이미 예약이 있는 고객이 문의하면 기존 예약 확인 안내. 새 예약을 또 만들지 않음
10. 예약 변경/취소 요청은 "담당자에게 전달드릴게요~" 안내 (직접 처리 안 함)

[응답 - JSON만 출력]
{{"reply":"고객메시지","action":"chat|ask_info|book","booking":null 또는 {{"custName":"","custPhone":"","date":"YYYY-MM-DD","time":"HH:MM","service":"시술명","dur":분,"gender":"M|F|"}}}}

action: chat=일반대화, ask_info=정보부족질문, book=예약등록
JSON만 출력. 백틱/설명 없이."""

    raw = _gemini(prompt)
    if not raw: return ""

    try:
        clean = re.sub(r'^```json?\s*', '', raw.strip())
        clean = re.sub(r'```\s*$', '', clean.strip())
        result = json.loads(clean)
    except:
        log.warning(f"[ai_booking] parse fail: {raw[:80]}")
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
                rid = create_booking_from_ai(booking, account_id, user_id)
                if not rid:
                    reply = "죄송합니다, 예약 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."

    return reply
