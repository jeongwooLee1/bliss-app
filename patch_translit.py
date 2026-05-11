path = '/home/ubuntu/naver-sync/bliss_naver.py'
with open(path,'r',encoding='utf-8') as f: src = f.read()

old = 'def _trazy_get_pricing():'
new = '''_name_ko_cache = {}
def _transliterate_to_korean(name, gemini_key=None):
    """외국 영문 이름 -> 한글 음역. Gemini Flash + 인메모리 캐시."""
    if not name: return ''
    s = name.strip()
    if not s: return ''
    if any(0xAC00 <= ord(c) <= 0xD7A3 for c in s): return ''
    key = s.lower()
    if key in _name_ko_cache: return _name_ko_cache[key]
    if not gemini_key:
        try:
            cfg = _load_ai_settings() or {}
            gemini_key = cfg.get('gemini_key', '') or ''
        except Exception:
            gemini_key = ''
    if not gemini_key: return ''
    try:
        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + gemini_key
        prompt_text = "다음 영문 이름을 한국에서 일반적으로 사용하는 한글 음역으로만 답변하세요. 설명/따옴표/이모지 없이 한글 음역만. 단어 사이는 한 칸 띄어쓰기.\n\n이름: " + s + "\n\n한글 음역:"
        r = requests.post(url, json={
            "contents": [{"parts": [{"text": prompt_text}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 200, "thinkingConfig": {"thinkingBudget": 0}}
        }, timeout=10)
        if not r.ok: return ''
        j = r.json()
        raw = ((j.get('candidates') or [{}])[0].get('content', {}) or {}).get('parts', [{}])[0].get('text', '').strip()
        cleaned = raw.split('\n')[0].strip()
        for ch in '"\'“”‘’「」『』':
            cleaned = cleaned.replace(ch, '')
        cleaned = cleaned.strip()
        if not any(0xAC00 <= ord(c) <= 0xD7A3 for c in cleaned): return ''
        _name_ko_cache[key] = cleaned
        log.info('[translit] ' + s + ' -> ' + cleaned)
        return cleaned
    except Exception as e:
        log.warning('[translit] ' + s + ': ' + str(e))
        return ''


def _trazy_get_pricing():'''

if old not in src:
    print('ERR anchor 1')
    raise SystemExit(1)
src = src.replace(old, new, 1)

old2 = '''            requests.post(f"{SUPABASE_URL}/rest/v1/customers",
                headers={**HEADERS, "Prefer": "return=minimal"},
                json={
                    "id": new_cust_id, "business_id": BUSINESS_ID, "bid": bid,
                    "name": name, "phone": phone, "gender": p.get("gender", ""),
                    "memo": f"Trazy 유입 / 국적: {p.get('nationality','')}",
                }, timeout=10)
            cust_id = new_cust_id
            log.info(f"[trazy] 신규 고객 생성: {name}")'''

new2 = '''            _name_kor_auto = _transliterate_to_korean(name)
            _cust_payload = {
                "id": new_cust_id, "business_id": BUSINESS_ID, "bid": bid,
                "name": name, "phone": phone, "gender": p.get("gender", ""),
                "memo": f"Trazy 유입 / 국적: {p.get('nationality','')}",
            }
            if _name_kor_auto:
                _cust_payload["name_kor"] = _name_kor_auto
            requests.post(f"{SUPABASE_URL}/rest/v1/customers",
                headers={**HEADERS, "Prefer": "return=minimal"},
                json=_cust_payload, timeout=10)
            cust_id = new_cust_id
            log.info(f"[trazy] 신규 고객 생성: {name}" + (f" ({_name_kor_auto})" if _name_kor_auto else ""))'''

if old2 not in src:
    print('ERR anchor 2')
    raise SystemExit(2)
src = src.replace(old2, new2, 1)

with open(path,'w',encoding='utf-8') as f: f.write(src)
print('OK')
