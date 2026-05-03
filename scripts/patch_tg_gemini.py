"""TG 봇 일반 대화를 Claude → Gemini로 변경 (비용 절감).
SYSTEM_PROMPT + history(누적 대화)를 Gemini 형식으로 변환."""
p = '/home/ubuntu/naver-sync/bliss_naver.py'
src = open(p).read()

old = '''                # ── 일반 대화: Claude API ──
                else:
                    anthropic_key = get_anthropic_key()
                    if not anthropic_key:
                        tg_send_plain("❌ Anthropic API 키가 설정되지 않았습니다\\n(Supabase → businesses → settings → anthropic_key)")
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
                        tg_send_plain(f"❌ Claude API 오류: {str(e)[:200]}")'''

new = '''                # ── 일반 대화: Gemini Flash (Claude → Gemini로 비용 절감) ──
                else:
                    history.append({"role": "user", "content": text})
                    if len(history) > MAX_HISTORY * 2:
                        history[:] = history[-MAX_HISTORY * 2:]
                    try:
                        # SYSTEM_PROMPT + 누적 history → 단일 prompt 텍스트로 합쳐 gemini_ask 호출
                        _hist_lines = []
                        for _h in history:
                            _role = "사용자" if _h.get("role") == "user" else "AI"
                            _hist_lines.append(f"{_role}: {_h.get('content','')}")
                        _full_prompt = SYSTEM_PROMPT + "\\n\\n[대화]\\n" + "\\n".join(_hist_lines) + "\\n\\nAI 답변:"
                        reply = gemini_ask(_full_prompt, timeout=30) or ""
                        if not reply:
                            tg_send_plain("❌ Gemini 응답 실패")
                            continue
                        history.append({"role": "assistant", "content": reply})
                        if len(reply) > 4000:
                            for chunk in [reply[i:i+4000] for i in range(0, len(reply), 4000)]:
                                tg_send_plain(chunk)
                        else:
                            tg_send_plain(reply)
                    except Exception as e:
                        log.error(f"[TG] Gemini 오류: {e}")
                        tg_send_plain(f"❌ Gemini 오류: {str(e)[:200]}")'''

if old not in src:
    print('PATTERN_NOT_FOUND'); raise SystemExit(1)
src = src.replace(old, new)
open(p, 'w').write(src)
print('PATCHED OK')
