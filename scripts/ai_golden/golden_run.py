"""
받은메시지함 AI 응대 골든셋 회귀 하니스 (golden regression harness)
─────────────────────────────────────────────────────────────────────
목적: 받은메시지함 AI(ai_booking_agent)의 '의사결정'을 고정 케이스로 회귀 검증.
      과거 사고(취소 미처리·작별후 시간재안내·언어 이탈·under-booking 등)를
      룰 본문에 하드코딩으로 막는 악순환 대신, 여기 골든셋으로 박아 매 변경마다 채점.

원칙: 새 사고가 나면 ai_booking.py 룰을 늘리지 말고 golden_set.json에 케이스 1개를 추가하라.
      그리고 이 하니스를 돌려 회귀(다른 케이스 깨짐)가 0인지 확인 후 배포.

부작용 0:
  - 모든 write/외부효과 mock: create/cancel/state/availability/change-request/telegram/billing
  - DB 변경·텔레그램 발송·예약 생성 전무. read만 실데이터(매장 가격·시술·지점 캐시).
  - production AI 경로 그대로(ai_booking_agent, force=True, suggest_only=True) — 손님이 받는 답과 동일.

채점:
  - action_behavior (결정적): book=예약생성 / cancel=취소 / noop=대화·정보질문·보류
  - LLM 심판(Gemini 무료): 각 케이스의 must_pass 기준 충족 여부 + 언어·환각 체크
  - PASS = (기대 동작군 일치) AND (심판 pass)
  - must_pass는 모든 케이스의 게이트 — 하나라도 FAIL이면 exit 1 (CI 게이트)

사용: python3 golden_run.py [golden_set.json경로]   (기본: 같은 폴더 golden_set.json)
"""
import sys, os, json, time, subprocess, re

# ── systemd 유닛에서 API 키 로드 (셸엔 없음) ──
_raw = subprocess.run(["systemctl","show","bliss-naver","-p","Environment"],
                      capture_output=True, text=True).stdout
if "Environment=" in _raw:
    for tok in _raw.split("Environment=",1)[1].strip().split(" "):
        if "=" in tok:
            k, v = tok.split("=",1); os.environ.setdefault(k, v)

sys.path.insert(0, "/home/ubuntu/naver-sync")
os.environ.setdefault("PYTHONIOENCODING","utf-8")
import requests, ai_booking
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).strftime("%Y-%m-%d")
SUPABASE_URL = ai_booking.SUPABASE_URL
JUDGE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"

# ───────────────────────── 부작용 차단 (모든 write/외부효과 mock) ─────────────────────────
CAP = {"book": False, "cancel": False, "defer": False}
def _mock_create(*a, **k):
    CAP["book"] = True
    return "g_mock_rid"          # truthy → "예약 확정" reply 경로
def _mock_cancel(*a, **k):
    CAP["cancel"] = True
    return True
def _mock_change_req(*a, **k):
    CAP["defer"] = True
    return None
ai_booking.create_booking_from_ai   = _mock_create
ai_booking.cancel_booking           = _mock_cancel
ai_booking._insert_ai_change_request= _mock_change_req
ai_booking._state_save              = lambda *a, **k: True
ai_booking.check_availability       = lambda *a, **k: (True, None)   # 슬롯 가용 고정 → AI 결정만 격리
ai_booking._change_slot_clear       = lambda *a, **k: True
ai_booking._tg_notify               = lambda *a, **k: None           # 실제 텔레그램 발송 차단
ai_booking._bill_ai_call            = lambda *a, **k: None           # 빌링 로그 노이즈 차단
ai_booking._flag_inbox_followup     = lambda *a, **k: None

# 봇이 받은 system 프롬프트 캡처 → 심판 ground-truth(환각 판정 근거)
_CAP_SYS = {"sys": ""}
_orig_ai_ask = ai_booking._ai_ask_msgs
def _cap_ai_ask(messages, system=None, **kw):
    if system: _CAP_SYS["sys"] = system
    return _orig_ai_ask(messages, system=system, **kw)
ai_booking._ai_ask_msgs = _cap_ai_ask

# 🆕 'book 결정' 캡처 (2026-06-13 운영 변경 대응):
#   이제 suggest_only=True 모드는 예약을 실제로 생성하지 않고(답변 초안만) "booking 생성 skip"을 로깅한다.
#   따라서 create_booking_from_ai mock만으로는 book 결정을 못 잡는다. 그 skip 로그가 곧 'action=book + 슬롯가용
#   → 예약 진행 결정' 시점이므로(그 직전 _proceed=True), 로그를 가로채 book 결정으로 기록한다.
#   create_booking_from_ai mock도 그대로 둬서(향후 suggest_only가 다시 생성하거나 suggest_only=False여도) 이중 안전.
_orig_log_info = ai_booking.log.info
def _cap_log_info(msg, *a, **k):
    try:
        m = msg if isinstance(msg, str) else str(msg)
        if "suggest_only" in m and "skip" in m:
            CAP["book"] = True
    except Exception:
        pass
    return _orig_log_info(msg, *a, **k)
ai_booking.log.info = _cap_log_info

# ───────────────────────── 지점명→bid 해석 (기존예약 컨텍스트용) ─────────────────────────
def _branch_bid(name):
    if not name: return ""
    try:
        br = (ai_booking._load_cache().get("branches") or {})
        for bid, b in (br.items() if isinstance(br, dict) else []):
            nm = (b.get("short") or b.get("name") or "")
            if name in nm or nm.replace("점","") == name or name in nm.replace("점",""):
                return bid
    except Exception:
        pass
    return ""

# ───────────────────────── 매장 FACTS(심판 보조) ─────────────────────────
def store_facts():
    try:
        c = ai_booking._load_cache()
        lines = ["[매장 시술·가격 (여성가/남성가, 0=해당없음)]"]
        for s in (c.get("services") or []):
            nm = s.get("name") or ""
            if not nm: continue
            lines.append(f"- {nm}: 여{s.get('price_f') or 0}/남{s.get('price_m') or 0}")
        br = requests.get(f"{SUPABASE_URL}/rest/v1/branches?business_id=eq.{ai_booking.BUSINESS_ID}&select=name,short,address,phone",
                          headers=ai_booking.HEADERS, timeout=15).json()
        lines.append("[지점·주소·전화]")
        for b in (br if isinstance(br,list) else []):
            lines.append(f"- {b.get('short') or b.get('name')}: {b.get('address') or '(주소 미등록)'} / {b.get('phone') or ''}")
        lines.append(f"[오늘] {TODAY} (KST)")
        return "\n".join(lines)
    except Exception as e:
        return f"[FACTS 로드 실패: {e}]\n[오늘] {TODAY}"

# ───────────────────────── LLM 심판 ─────────────────────────
JUDGE_PROMPT = """너는 왁싱샵 예약 자동응답 '골든셋' 채점관이다. 봇의 답이 아래 [필수 기준]을 충족하는지 엄격히 본다.

[이 답변이 반드시 만족해야 할 필수 기준 (must_pass)]
{must_pass}

[이상적 답변 예시 — 참고용, 토씨까지 같을 필요는 없음]
{ideal}

[봇이 답할 때 가지고 있던 사실 (FACTS — 이 안에 근거 있으면 사실, 없는 가격·주소·정책 단정은 환각)]
{facts}

[고객 대화 (마지막이 봇이 답해야 한 손님 메시지. '매장'=이전 봇/직원 발화)]
{convo}

[봇 실제 응답 — 채점 대상]
{reply}

[봇이 실제 실행한 동작] {behavior}   (book=예약 진행 결정함 / cancel=취소 처리함 / noop=대화·정보질문·보류, 예약/취소 안 함)
[기대 동작] {expected}

⚠ 중요(답변초안 모드): 이 봇은 직원 검토용 '답변 초안(suggest_only)' 모드로 돈다. 예약(book) 결정을 내려도 실제 확정 문구 대신 "예약 도와드릴까요? 확인되면 바로 잡아드릴게요 / Would you like me to book you in for ...? I'll confirm it right away" 같은 '확인 요청' 초안을 reply로 낼 수 있다. [봇이 실제 실행한 동작]=book 이면 예약 결정은 이미 내려진 것이다 — reply가 확인을 요청하는 문장이라는 이유만으로 'under-booking·정보 재질문·예약 안 함'으로 판정하지 말 것. book 동작인 케이스에서 reply가 이런 확인-요청 초안이면 정상이며, 그때는 언어 일관성·환각(없는 가격/지점/시간 날조) 같은 하드 금지선만 보고 판정하라.

⚠ 채점 기준은 오직 [필수 기준(must_pass)]이다. [이상적 답변 예시]는 톤·스타일 참고용일 뿐, 봇이 그 형식·문구를 그대로 따르지 않았다는 이유로 실패시키지 말 것. 동작이 맞고 must_pass의 조건을 모두 지켰으면 답이 예시보다 짧거나 달라도 pass다.
⚠⚠ 응답의 **길이·문장 수·이모지 개수·SMS 글자수/바이트 제한**으로는 **절대 실패시키지 말 것**. 그건 발송 단계에서 자동 처리되는 별개 사안이며 이 골든 채점 대상이 아니다. (봇이 받은 시스템 프롬프트에 'SMS 초단문 90바이트' 같은 규칙이 있어도 무시하라.) must_pass에 길이가 명시돼 있지 않으면 길어도 pass.

⚠⚠⚠ 채점 원칙 — **기본값은 PASS**. must_pass에 적힌 '하드 위반'을 **명백·구체적으로** 저질렀을 때만 FAIL 하라. 다음 같은 객관적 위반만 FAIL:
  · 하지 말아야 할 예약(book)/취소(cancel)를 실제로 함, 또는 해야 할 예약/취소를 안 함
  · 요구된 언어가 아닌 언어로 답함(언어 이탈)
  · FACTS에 근거 없는 가격·전화·주소·정책·날짜를 지어냄(환각)
  · 취소/작별 후 특정 예약 시각을 다시 확정·재안내함("X시에 뵐게요")
  · 매장이 답할 수 있는 FAQ 질문에 답하지 않고 '담당자 확인'으로만 떠넘김(해당 케이스에 한해)
**다음으로는 절대 FAIL 금지(주관 요소)**: 톤·정중함·길이·문장 수·이모지 수·정보를 한 번에 묻는지 가볍게 묻는지·예시와 형식이 다른지·"더 좋았을 텐데" 류. 애매하면 무조건 PASS.

**JSON만** 출력 (설명 금지):
{{"pass": true/false, "lang_ok": true/false, "hallucination": true/false, "reason": "판정 이유 한 문장(한국어). FAIL이면 어떤 하드 위반인지 구체적으로"}}
- lang_ok: must_pass가 요구한 언어로 답했으면 true.
- hallucination: FACTS에 근거 없는 가격·전화·주소·도보분·출구·정책을 단정했으면 true."""

def _gem(prompt, temp=0.0):
    key = ai_booking._load_cache().get("gemini_key","")
    for attempt in range(3):
        try:
            r = requests.post(f"{JUDGE_URL}?key={key}",
                json={"contents":[{"parts":[{"text":prompt}]}],
                      "generationConfig":{"temperature":temp,"maxOutputTokens":1024,"thinkingConfig":{"thinkingLevel":"low"}}}, timeout=45)
            if r.status_code == 429: time.sleep(8); continue
            if r.status_code != 200: return {"_err": f"judge {r.status_code}: {r.text[:120]}"}
            cand = (r.json().get("candidates") or [{}])[0]
            txt = "".join(p.get("text","") for p in (cand.get("content") or {}).get("parts") or []).strip()
            txt = re.sub(r'^```json?\s*','',txt); txt = re.sub(r'```\s*$','',txt)
            m = re.search(r'\{[\s\S]*\}', txt)
            return json.loads(m.group()) if m else {"_err":"parse fail","_raw":txt[:200]}
        except Exception as e:
            if attempt < 2: time.sleep(3); continue
            return {"_err": f"judge exc: {e}"}
    return {"_err":"judge 429 exhausted"}

def judge(facts, convo, reply, must_pass, ideal, behavior, expected):
    return _gem(JUDGE_PROMPT.format(facts=facts[:14000], convo=convo[:3000], reply=reply[:1500],
                                    must_pass=must_pass, ideal=ideal, behavior=behavior, expected=expected))

def judge_voted(facts, convo, reply, must_pass, ideal, behavior, expected):
    """LLM 심판은 temp=0이라도 run-to-run 노이즈가 있어 게이트가 흔들린다.
    첫 판정이 PASS면 그대로(빠른 경로). FAIL/에러면 2회 재심해 3표 다수결(2/3)로 확정 → 단발 노이즈로 인한 가짜 회귀 차단."""
    j1 = judge(facts, convo, reply, must_pass, ideal, behavior, expected)
    if bool(j1.get("pass")) and not j1.get("_err"):
        j1["_votes"] = "1/1"
        return j1
    js = [j1, judge(facts, convo, reply, must_pass, ideal, behavior, expected),
              judge(facts, convo, reply, must_pass, ideal, behavior, expected)]
    npass = sum(1 for j in js if bool(j.get("pass")) and not j.get("_err"))
    rep = next((j for j in js if (bool(j.get("pass")) == (npass >= 2)) and not j.get("_err")), js[-1])
    final = dict(rep); final["pass"] = (npass >= 2); final["_votes"] = f"{npass}/3"
    return final

# ───────────────────────── 동작군 매핑 ─────────────────────────
def behavior_class():
    """이번 호출에서 봇이 실제로 한 동작군. book/cancel/noop."""
    if CAP["book"]:   return "book"
    if CAP["cancel"]: return "cancel"
    lpr = getattr(ai_booking, "_last_processed_result", None) or {}
    a = (lpr.get("action") or "").strip()
    if a == "cancel": return "cancel"          # 미래취소(직접 DELETE) 경로 — mock 미경유지만 결정은 cancel
    if a == "book":   return "noop"            # book인데 create 미발생 = 가드 다운그레이드(지점미상 등)
    return "noop"                              # chat / ask_info / 보류 / 게이트 단락

EXPECTED_TO_CLASS = {"book":"book", "cancel":"cancel", "chat":"noop", "ask_info":"noop"}

def fmt_convo(conv):
    out = []
    for d, t in conv:
        who = "손님" if d == "in" else "매장"
        out.append(f"{who}: {t}")
    return "\n".join(out)

# ───────────────────────── 케이스 1건 실행 ─────────────────────────
def run_case(c, facts):
    conv = c["conv"]
    channel = c.get("channel","whatsapp")
    user_id = "g_" + c["id"]
    account_id = "_golden"

    # history monkeypatch — 케이스 대화를 production 형식 스레드로
    thread = [{"direction": d, "message_text": t, "channel": channel,
               "user_name": "골든", "cust_phone": "", "created_at": TODAY+"T10:00:00"} for d, t in conv]
    ai_booking._load_history = (lambda th: (lambda account_id, user_id, limit=10: list(th)))(thread)

    # 기존 예약 monkeypatch
    ex = c.get("existing_booking")
    ex_dict = None
    if ex:
        _exdate = ex.get("date") or TODAY
        if _exdate == "TODAY": _exdate = TODAY
        ex_dict = {"id": ex["id"], "date": _exdate, "time": ex.get("time","12:00"),
                   "bid": _branch_bid(ex.get("branch","")), "service_name": ex.get("service",""),
                   "status": "reserved", "cust_name": "골든", "cust_phone": "", "dur": 45}
    ai_booking.find_existing_booking = (lambda d: (lambda *a, **k: d))(ex_dict)

    # 마지막 inbound = user_msg
    user_msg = [t for d, t in conv if d == "in"][-1]

    # 상태 초기화
    CAP["book"] = CAP["cancel"] = CAP["defer"] = False
    _CAP_SYS["sys"] = ""
    ai_booking._last_processed_result = None

    t0 = time.time()
    try:
        reply = ai_booking.ai_booking_agent(user_msg=user_msg, account_id=account_id, user_id=user_id,
                                             channel=channel, force=True, suggest_only=True)
    except Exception as e:
        reply = f"[ERROR {e}]"
    dt = round(time.time()-t0, 1)

    behavior = behavior_class()
    exp_class = EXPECTED_TO_CLASS.get(c["expected_action"], "noop")
    action_match = (behavior == exp_class)

    facts_for_judge = _CAP_SYS["sys"] or facts
    if not (reply or "").strip() or reply.startswith("[ERROR"):
        j = {"pass": False, "reason": "빈 응답/에러: "+reply[:120], "lang_ok": False, "hallucination": False}
    else:
        j = judge_voted(facts_for_judge, fmt_convo(conv), reply, c["must_pass"], c["ideal"], behavior, c["expected_action"])

    judge_pass = bool(j.get("pass")) and not j.get("_err")
    passed = action_match and judge_pass
    return {"id": c["id"], "kind": c.get("kind",""), "expected": c["expected_action"], "exp_class": exp_class,
            "behavior": behavior, "action_match": action_match, "judge": j, "judge_pass": judge_pass,
            "pass": passed, "reply": (reply or "")[:300], "sec": dt,
            "known_fail": bool(c.get("known_fail")), "known_note": c.get("known_note","")}

# ───────────────────────── 메인 ─────────────────────────
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden_set.json")
    cases = json.load(open(path, encoding="utf-8"))["cases"]
    facts = store_facts()
    print(f"골든셋: {len(cases)}개 | FACTS 시술 {facts.count(chr(10)+'- ')}줄 | 오늘 {TODAY}")
    print("="*78)
    results = []
    for i, c in enumerate(cases, 1):
        r = run_case(c, facts)
        results.append(r)
        if r["known_fail"]:
            mark = "🎉XPASS" if r["pass"] else "⚠️ XFAIL"   # known-open: XFAIL=예상된 실패(게이트 무관), XPASS=고쳐진 듯
        else:
            mark = "✅PASS" if r["pass"] else "❌FAIL"
        amk = "act✓" if r["action_match"] else f"act✗(기대 {r['exp_class']}/실제 {r['behavior']})"
        jr = r["judge"].get("reason") or r["judge"].get("_err") or ""
        votes = r["judge"].get("_votes","")
        print(f"[{i:02d}] {mark:<7} {r['id']:<22} {amk:<28} {r['sec']}s  심판{votes}")
        print(f"      판정: {jr[:120]}")
        if not r["pass"] and not r["known_fail"]:
            print(f"      답: {r['reply'][:120]}")
        time.sleep(0.5)

    json.dump(results, open("/tmp/golden_results.json","w"), ensure_ascii=False, indent=2)
    n = len(results)
    gated = [r for r in results if not r["known_fail"]]          # 게이트 대상(known-open 제외)
    known = [r for r in results if r["known_fail"]]
    npass = sum(1 for r in gated if r["pass"])
    fails = [r for r in gated if not r["pass"]]
    xfail = [r for r in known if not r["pass"]]
    xpass = [r for r in known if r["pass"]]
    print("\n" + "="*78)
    print(f"골든 스코어(게이트 대상): {npass}/{len(gated)} PASS" + (f"  · known-open {len(known)}건 별도" if known else ""))
    a_fail = [r for r in gated if not r["action_match"]]
    j_fail = [r for r in gated if r["action_match"] and not r["judge_pass"]]
    if a_fail: print(f"  동작 불일치({len(a_fail)}): " + ", ".join(f"{r['id']}(기대{r['exp_class']}/실제{r['behavior']})" for r in a_fail))
    if j_fail: print(f"  내용 미달({len(j_fail)}): " + ", ".join(f"{r['id']}" for r in j_fail))
    if fails:
        print("\n⚠️ 실패 케이스(게이트):")
        for r in fails:
            print(f"  ❌ {r['id']}: {r['judge'].get('reason') or r['judge'].get('_err','')}")
            print(f"     답: {r['reply'][:140]}")
    if xfail:
        print(f"\n📌 known-open(XFAIL, 게이트 무관 — 추적 중인 미해결 이슈):")
        for r in xfail:
            print(f"  ⚠️ {r['id']}: {r['known_note'] or r['judge'].get('reason','')}")
    if xpass:
        print(f"\n🎉 known-open인데 통과(XPASS — 고쳐진 듯, golden_set에서 known_fail 제거 검토):")
        for r in xpass:
            print(f"  🎉 {r['id']}")
    print(f"\n상세: /tmp/golden_results.json")
    # CI 게이트: known-open(known_fail)을 제외한 케이스가 하나라도 실패하면 nonzero
    sys.exit(0 if len(fails) == 0 else 1)

if __name__ == "__main__":
    main()
