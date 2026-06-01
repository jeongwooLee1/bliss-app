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

export default function NaverReviews({ data, branches, userBranches, currentUser }) {
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
    // 배지 = has_reply=false 카운트 (AppShell 10분 폴링 기준). 탭 열어도 배지 안 꺼짐.
  }, [bids, filter]);

  useEffect(() => { load(); }, [load]);

  const openNaver = (r) => {
    const pm = placeMap[r.bid];
    const biz = pm?.biz || r.place_id;
    window.open(`https://new.smartplace.naver.com/bizes/booking/${biz}/reviews?menu=visitor`, '_blank');
  };

  const branchName = (bid) => (branches || []).find(b => b.id === bid)?.name || '';

  const genDraft = async (r) => {
    const key = getGeminiKey();
    if (!key) { alert('AI 키가 설정되어 있지 않습니다. 관리설정 > AI 설정을 확인해 주세요.'); return; }
    setDrafts(d => ({ ...d, [r.id]: { ...(d[r.id] || {}), loading: true, err: null } }));
    const bizName = branchName(r.bid) || '우리 매장';
    const prompt = `너는 미용 왁싱샵 "${bizName}"의 사장님이다. 아래 네이버 고객 리뷰에 달 따뜻한 사장님 답글을 작성해줘.
조건:
- 한국어, 2~4문장, 진심 어린 친근한 존댓말
- 리뷰 내용이나 닉네임을 자연스럽게 언급하며 감사 인사
- 마지막에 재방문을 부드럽게 유도
- 과한 영업 표현·이모지 남발 금지 (이모지는 0~1개)

[작성자] ${r.author_name || ''}
[받은 시술] ${r.biz_item_name || '-'}
[별점] ${r.rating != null ? r.rating : '-'}
[리뷰 내용] ${r.content || '(사진만, 텍스트 없음)'}

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
        <button onClick={load} title="새로고침" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: T.textSub, display: 'flex', alignItems: 'center' }}><I name="loader" size={16} /></button>
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
                <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textSub }}>{fmtRevTime(r.review_created_at)}</span>
              </div>

              {r.biz_item_name && (
                <div style={{ fontSize: 11, color: T.textSub, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <I name="scissors" size={11} />{r.biz_item_name}
                </div>
              )}
              {r.content
                ? <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{r.content}</div>
                : <div style={{ fontSize: 12, color: T.textSub, fontStyle: 'italic' }}>(사진 리뷰 · 텍스트 없음)</div>}

              {r.has_reply && r.reply_text && (
                <div style={{ background: T.primaryLt, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: T.text, lineHeight: 1.5 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.primaryDk, marginBottom: 3 }}>사장님 답글</div>
                  {r.reply_text}
                </div>
              )}

              {!r.has_reply && (
                <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => openNaver(r)} style={{ flex: 1, minWidth: 132, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: '#03C75A', color: '#fff' }}>
                      <I name="naver" size={13} color="#fff" />네이버에서 답글쓰기
                    </button>
                    <button onClick={() => genDraft(r)} disabled={dr.loading} style={{ flex: 1, minWidth: 110, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: T.primaryLt, color: T.primaryDk, opacity: dr.loading ? 0.6 : 1 }}>
                      <I name="sparkles" size={13} />{dr.loading ? '작성 중…' : 'AI 답글 초안'}
                    </button>
                  </div>
                  {dr.err && <div style={{ fontSize: 11, color: T.danger }}>AI 오류: {dr.err}</div>}
                  {dr.text && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <textarea value={dr.text} onChange={e => setDrafts(d => ({ ...d, [r.id]: { ...d[r.id], text: e.target.value } }))} rows={4}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, resize: 'vertical', color: T.text }} />
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => copyDraft(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, background: dr.copied ? T.success : T.primary, color: '#fff' }}>
                          <I name={dr.copied ? 'check' : 'clipboard'} size={12} color="#fff" />{dr.copied ? '복사됨' : '복사'}
                        </button>
                        <button onClick={() => genDraft(r)} disabled={dr.loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: T.bg, color: T.textSub }}>
                          <I name="sparkles" size={12} />다시
                        </button>
                        <span style={{ fontSize: 11, color: T.textSub, marginLeft: 2 }}>복사 후 [네이버에서 답글쓰기]로 붙여넣기</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
