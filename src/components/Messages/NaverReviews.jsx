import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import I from '../common/I'

const getGeminiKey = () => window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";
const SRC_LABEL = { Reservation: '예약 리뷰', Receipt: '영수증 리뷰', Booking: '예약 리뷰' };

// ISO → 오늘이면 "오전/오후 H:mm", 올해면 "M/D", 그 외 "YYYY.M.D"
const fmtRevTime = iso => {
  if (!iso) return '';
  try {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) {
      const hh = d.getHours(), mi = String(d.getMinutes()).padStart(2, '0');
      return `${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}:${mi}`;
    }
    const mm = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() === now.getFullYear() ? `${mm}/${dd}` : `${d.getFullYear()}.${mm}.${dd}`;
  } catch { return ''; }
};

export default function NaverReviews({ data, branches, userBranches, currentUser, setPage, setPendingOpenCust, setPendingOpenRes }) {
  const [reviews, setReviews] = useState([]);
  const [filter, setFilter] = useState('noreply');   // noreply | replied | all
  const [loading, setLoading] = useState(true);
  const [placeMap, setPlaceMap] = useState({});       // bid -> { seq, biz }
  const [drafts, setDrafts] = useState({});           // reviewId -> { text, loading, err, copied }

  const bids = useMemo(() => {
    const ub = (userBranches && userBranches.length) ? userBranches : null;
    return ub || (branches || []).map(b => b.id);
  }, [userBranches, branches]);

  // 지점 → naver_biz_id 매핑 (바로가기 URL: /bizes/booking/{biz_id}/reviews?menu=visitor)
  useEffect(() => {
    const m = {};
    (branches || []).forEach(b => {
      const biz = b.naver_biz_id || b.naverBizId;
      if (biz) m[b.id] = { biz };
    });
    setPlaceMap(m);
  }, [branches]);

  const syncAndLoad = useCallback(async () => {
    // 서버에 즉시 수집 요청 → 네이버 최신 has_reply 반영 후 DB 재조회
    setLoading(true);
    try { await fetch('https://blissme.ai/review-sync-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { }
    let f = `&business_id=eq.${_activeBizId}&order=review_created_at.desc&limit=300`;
    const bidIn = (bids || []).join(',');
    if (bidIn) f += `&bid=in.(${bidIn})`;
    if (filter === 'noreply') f += `&has_reply=eq.false`;
    else if (filter === 'replied') f += `&has_reply=eq.true`;
    let rows = [];
    try { rows = (await sb.get('naver_reviews', f)) || []; } catch { }
    setReviews(rows);
    setLoading(false);
  }, [bids, filter]);

  const load = useCallback(async () => {
    setLoading(true);
    let f = `&business_id=eq.${_activeBizId}&order=review_created_at.desc&limit=300`;
    const bidIn = (bids || []).join(',');
    if (bidIn) f += `&bid=in.(${bidIn})`;
    if (filter === 'noreply') f += `&has_reply=eq.false`;
    else if (filter === 'replied') f += `&has_reply=eq.true`;
    let rows = [];
    try { rows = (await sb.get('naver_reviews', f)) || []; } catch { }
    setReviews(rows);
    setLoading(false);
  }, [bids, filter]);

  useEffect(() => { load(); }, [load]);

  const openNaver = (r) => {
    const pm = placeMap[r.bid];
    const biz = pm?.biz || r.place_id;
    window.open(`https://new-m.smartplace.naver.com/bizes/booking/${biz}/reviews?hasReply=false&menu=visitor`, '_blank');
  };

  const branchName = (bid) => (branches || []).find(b => b.id === bid)?.name || '';

  const genDraft = async (r) => {
    const key = getGeminiKey();
    if (!key) { alert('AI 키가 설정되어 있지 않습니다. 관리설정 > AI 설정을 확인해 주세요.'); return; }
    setDrafts(d => ({ ...d, [r.id]: { ...(d[r.id] || {}), loading: true, err: null } }));
    const bizName = branchName(r.bid) || '우리 매장';
    // 고객 최근 방문 메모 조회 (visitor_name 1명 정확 매칭 시) → 가벼운 안부거리 반영용
    let custNote = '';
    if (r.visitor_name) {
      try {
        const cr = await fetch(`${SB_URL}/rest/v1/customers?business_id=eq.${_activeBizId}&name=eq.${encodeURIComponent(r.visitor_name)}&select=id&limit=2`, { headers: sbHeaders });
        const crows = await cr.json();
        if (Array.isArray(crows) && crows.length === 1) {
          const srr = await fetch(`${SB_URL}/rest/v1/sales?cust_id=eq.${crows[0].id}&order=date.desc&limit=2&select=memo`, { headers: sbHeaders });
          const srows = await srr.json();
          custNote = (srows || []).map(s => s.memo).filter(Boolean).join('\n---\n').slice(0, 500);
        }
      } catch { }
    }
    const prompt = `너는 미용 왁싱샵 "${bizName}"에서 일하는 밝고 친근한 20대 여성 직원이다. 아래 네이버 고객 리뷰에 달 답글을 작성해줘.
조건:
- 20대 여직원이 쓰는 것처럼 밝고 친근하며 살짝 캐주얼한 말투로 ("~해요", "~하셨다니 너무 좋아요", "ㅎㅎ", "넘 감사해요" 같은 느낌)
- 딱딱하고 사무적인 문어체는 절대 금지 (예: "~말씀에 보람을 느낍니다", "~약속해 주셔서 감사드리며", "~큰 보람을 느낍니다" 같은 표현 X)
- 한국어 2~4문장, 고객을 "고객님"으로 호칭 (작성자 닉네임·실명 사용 금지)
- 리뷰 내용을 자연스럽게 콕 집어 언급하며 진심으로 감사
- 마지막에 재방문을 부드럽고 캐주얼하게 유도
- 이모지·이모티콘 절대 사용 금지 (텍스트로만, 'ㅎㅎ' 정도는 허용)

[받은 시술] ${r.biz_item_name || '-'}
[별점] ${r.rating != null ? r.rating : '-'}
[리뷰 내용] ${r.content || '(사진만, 텍스트 없음)'}${custNote ? `

[고객 최근 방문 메모 — 매장 내부 기록, 참고용]
${custNote}
★ 위 메모에 '여행·이사·경조사·일상 행사' 처럼 가볍게 안부 건넬 만한 내용이 명확히 있으면, 답글 끝에 자연스럽게 한 문장만 덧붙여. 단 이미 했는지/앞으로 할 예정인지 시점이 불확실하면 과거형으로 "다녀오셨어요?"라고 묻지 말고, 응원·기원하는 미래형으로 써 (예: "제주도 여행 즐겁게 잘 다녀오세요!", "즐거운 여행 되시길 바라요!"). 시술 부위·패키지·금액·횟수·신체·건강 같은 민감하거나 내부적인 정보는 절대 답글에 쓰지 마. 가벼운 안부거리가 없으면 억지로 넣지 말고 생략해.` : ''}

답글 텍스트만 출력:`;
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + key,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
      const dd = await res.json();
      const txt = (dd?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      setDrafts(d => ({ ...d, [r.id]: { text: txt, loading: false } }));
      try { const { deductBilling } = await import('../../lib/billing'); deductBilling({ bizId: _activeBizId, branchId: r.bid, kind: 'ai_call', refTable: 'review_reply' }); } catch { }
    } catch (e) {
      setDrafts(d => ({ ...d, [r.id]: { text: '', loading: false, err: String(e?.message || e) } }));
    }
  };

  const submitReply = async (r) => {
    const text = (drafts[r.id]?.text || '').trim();
    if (!text) return;
    const pm = placeMap[r.bid];
    const bizId = pm?.biz || r.place_id;
    setDrafts(d => ({ ...d, [r.id]: { ...d[r.id], submitting: true, submitErr: null } }));
    try {
      const res = await fetch('https://blissme.ai/review-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: r.review_id, bizId, text }),
      });
      const dd = await res.json();
      if (!dd.ok) throw new Error(dd.error || '등록 실패');
      // 로컬 state 즉시 갱신 (목록에서 제거)
      setReviews(prev => prev.filter(x => x.id !== r.id));
      setDrafts(d => { const n = { ...d }; delete n[r.id]; return n; });
    } catch (e) {
      setDrafts(d => ({ ...d, [r.id]: { ...d[r.id], submitting: false, submitErr: String(e?.message || e) } }));
    }
  };

  const copyDraft = async (r) => {
    const txt = drafts[r.id]?.text || '';
    if (!txt) return;
    try {
      await navigator.clipboard.writeText(txt);
      setDrafts(d => ({ ...d, [r.id]: { ...d[r.id], copied: true } }));
      setTimeout(() => setDrafts(d => ({ ...d, [r.id]: { ...(d[r.id] || {}), copied: false } })), 1500);
    } catch { }
  };

  const FILTERS = [['noreply', '답글 대기'], ['replied', '답변 완료'], ['all', '전체']];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: T.bg }}>
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.bgCard, alignItems: 'center' }}>
        {FILTERS.map(([k, lbl]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '6px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: filter === k ? 800 : 600,
            background: filter === k ? T.primary : T.primaryLt, color: filter === k ? '#fff' : T.primaryDk
          }}>{lbl}</button>
        ))}
        <button onClick={syncAndLoad} title="네이버에서 최신 답글 상태 가져오기" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: T.textSub, display: 'flex', alignItems: 'center' }}><I name="loader" size={16} /></button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <div style={{ textAlign: 'center', color: T.textSub, padding: 24, fontSize: 13 }}>불러오는 중…</div>}
        {!loading && reviews.length === 0 && (
          <div style={{ textAlign: 'center', color: T.textSub, padding: 32, fontSize: 13 }}>
            {filter === 'noreply' ? '답글 대기 중인 리뷰가 없습니다.' : '리뷰가 없습니다.'}
          </div>
        )}
        {reviews.map(r => {
          const dr = drafts[r.id] || {};
          return (
            <div key={r.id} style={{ background: T.bgCard, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{r.author_name || '익명'}</span>
                {r.rating != null && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#F5A623', fontSize: 12, fontWeight: 700 }}>
                    <I name="star" size={12} color="#F5A623" />{r.rating}
                  </span>
                )}
                <span style={{ fontSize: 11, color: T.primaryDk, background: T.primaryLt, borderRadius: 6, padding: '1px 7px' }}>{SRC_LABEL[r.source] || r.source || '리뷰'}</span>
                {branches && branches.length > 1 && <span style={{ fontSize: 11, color: T.textSub }}>{branchName(r.bid)}</span>}
                {r.visitor_name && setPage && (
                  <button onClick={async () => {
                    // visitor_name → 고객의 최근 예약 블록을 타임라인에서 포커싱 (예약 없으면 고객 상세 폴백)
                    try {
                      const { SB_URL, sbHeaders } = await import('../../lib/sb');
                      const nm = encodeURIComponent(r.visitor_name);
                      // 최근 예약을 이름+지점(bid)으로 조회 — reservations는 cust_id가 비어있는 경우가 많아 cust_name 기준.
                      // 같은 지점(리뷰 bid)으로 좁혀 동명이인 혼선 최소화. 내부일정 + 타임라인에 안 뜨는 상태(naver_changed/naver_cancelled) 제외.
                      const _excl = '&status=not.in.(naver_changed,naver_cancelled)';
                      let rres = await fetch(`${SB_URL}/rest/v1/reservations?cust_name=eq.${nm}&bid=eq.${r.bid}&is_schedule=eq.false${_excl}&order=date.desc,time.desc&limit=1&select=id,reservation_id,date,time,bid,status`, { headers: sbHeaders });
                      let rrows = await rres.json();
                      // 지점 예약 없으면 지점 무관 최근 예약
                      if (!rrows?.length) {
                        rres = await fetch(`${SB_URL}/rest/v1/reservations?cust_name=eq.${nm}&is_schedule=eq.false${_excl}&order=date.desc,time.desc&limit=1&select=id,reservation_id,date,time,bid,status`, { headers: sbHeaders });
                        rrows = await rres.json();
                      }
                      if (rrows?.[0] && setPendingOpenRes) {
                        const rv = rrows[0];
                        setPendingOpenRes({ id: rv.id, reservation_id: rv.reservation_id, date: rv.date, time: rv.time, bid: rv.bid, status: rv.status, _highlightOnly: true });
                        setPage('timeline');
                      } else { setPage('customers'); }  // 예약 전혀 없으면 고객관리 페이지로
                    } catch (e) { console.warn('[review] visitor focus err', e); }
                  }} title={`${r.visitor_name} 최근 예약 보기`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: T.primaryDk, background: T.primaryLt, border: 'none', borderRadius: 6, padding: '2px 7px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                    <I name="user" size={10} />{r.visitor_name} ↗
                  </button>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textSub, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {fmtRevTime(r.review_created_at)}
                  <a href={`https://new-m.smartplace.naver.com/bizes/booking/${placeMap[r.bid]?.biz || r.place_id}/reviews?hasReply=false&menu=visitor`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#03C75A', textDecoration: 'none', fontSize: 11, fontWeight: 700, padding: '2px 6px', background: '#03C75A10', borderRadius: 5, border: '1px solid #03C75A30' }}>
                    <I name="naver" size={10} color="#03C75A" /><I name="chevR" size={9} color="#03C75A" />
                  </a>
                </span>
              </div>

              {r.biz_item_name && (
                <div style={{ fontSize: 11, color: T.textSub, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <I name="scissors" size={11} />{r.biz_item_name}
                </div>
              )}
              {r.content
                ? <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.5 }}>{r.content}</div>
                : <div style={{ fontSize: 12, color: T.textSub, fontStyle: 'italic' }}>(사진 리뷰 · 텍스트 없음)</div>}

              {r.has_reply && r.reply_text && (
                <div style={{ background: T.primaryLt, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: T.text, lineHeight: 1.5 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.primaryDk, marginBottom: 3 }}>사장님 답글</div>
                  {r.reply_text}
                </div>
              )}

              {!r.has_reply && (
                <>
                  {/* 답글 textarea — 항상 표시 */}
                  <textarea
                    value={dr.text || ''}
                    onChange={e => setDrafts(d => ({ ...d, [r.id]: { ...(d[r.id] || {}), text: e.target.value } }))}
                    placeholder="답글을 입력하거나 AI 초안을 사용하세요"
                    rows={3}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, resize: 'vertical', color: T.text }}
                  />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => submitReply(r)} disabled={dr.submitting || !(dr.text || '').trim()} style={{ flex: 1, minWidth: 100, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: '#03C75A', color: '#fff', opacity: (dr.submitting || !(dr.text || '').trim()) ? 0.55 : 1 }}>
                      <I name="naver" size={13} color="#fff" />{dr.submitting ? '등록 중…' : '네이버에 등록'}
                    </button>
                    <button onClick={() => genDraft(r)} disabled={dr.loading} style={{ flex: 1, minWidth: 90, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: T.primaryLt, color: T.primaryDk, opacity: dr.loading ? 0.6 : 1 }}>
                      <I name="sparkles" size={13} />{dr.loading ? '작성 중…' : 'AI 초안'}
                    </button>
                  </div>
                  {dr.err && <div style={{ fontSize: 11, color: T.danger }}>AI 오류: {dr.err}</div>}
                  {dr.submitErr && <div style={{ fontSize: 11, color: T.danger }}>{dr.submitErr}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
