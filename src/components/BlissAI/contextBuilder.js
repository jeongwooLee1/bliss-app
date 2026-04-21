/**
 * contextBuilder.js — 블리스 AI 컨텍스트 주입 빌더
 *
 * 역할: 사용자 질문에 가장 관련 있는 데이터만 prompt에 주입해 토큰 절약 + 정확도 향상
 *
 * 레이어:
 *   Tier 1 (항상): 시스템 프롬프트 + 지점 요약 + 카테고리 요약
 *   Tier 2 (질문 관련): FAQ 상위 N개 (키워드 매칭)
 *   Tier 3 (Phase 2, intent 기반): 실시간 DB 조회 결과 (고객/매출/예약)
 */

// ─── 시스템 프롬프트 ─────────────────────────────────────────────────────────
export const SYSTEM_PROMPT = `당신은 블리스(BlissMe) 하우스왁싱의 AI 업무 도우미입니다.
주요 역할:
- 신입 직원이 업무를 빠르게 익히도록 FAQ·정책·가격·시스템 이용법을 안내합니다.
- 매장 운영 데이터(예약·고객·매출)를 조회해 간결하게 알려줍니다.
- 한국어로 따뜻하고 친근하게 답변합니다. 존댓말 사용.
- 확실한 정보만 답하고, 모르는 것은 "모르겠습니다" 또는 "담당자에게 확인 부탁드립니다"라고 솔직히 말합니다.
- 고객 개인정보(전화번호·주소 등)를 출력할 때는 마스킹 여부 지시를 따릅니다.
- 답변은 핵심부터, 불필요하게 길게 쓰지 않습니다. 필요하면 불릿/번호 사용.`;

// ─── Tier 1: 항상 주입 ─────────────────────────────────────────────────────
export function buildStaticContext(data) {
  const parts = [];
  // 지점 목록
  const branches = (data?.branches || []).filter(b => b.useYn !== false);
  if (branches.length) {
    const lines = branches.map(b => `- ${b.short || b.name}${b.address ? ` (${b.address})` : ''}${b.phone ? ` · ☎ ${b.phone}` : ''}`);
    parts.push(`[지점 ${branches.length}개]\n${lines.join('\n')}`);
  }
  // 카테고리 요약
  const cats = (data?.serviceCategories || data?.categories || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  if (cats.length) {
    parts.push(`[시술 카테고리]\n${cats.map(c => c.name).filter(Boolean).join(' · ')}`);
  }
  // 예약 경로
  const sources = (data?.resSources || []).filter(s => s.useYn !== false);
  if (sources.length) {
    parts.push(`[예약 경로]\n${sources.map(s => s.name).join(' · ')}`);
  }
  return parts.join('\n\n');
}

// ─── 시술 가격표 요약 (특정 카테고리/검색 시에만 주입) ──────────────────────
export function buildServicesContext(data, filterKeyword = '') {
  const services = (data?.services || []).filter(s => s.name);
  if (!services.length) return '';
  const kw = filterKeyword.toLowerCase().trim();
  const matched = kw
    ? services.filter(s => s.name.toLowerCase().includes(kw))
    : services;
  if (!matched.length) return '';
  // 카테고리별 그룹
  const cats = (data?.serviceCategories || data?.categories || []);
  const catName = (id) => cats.find(c => c.id === id)?.name || '기타';
  const byCat = {};
  matched.forEach(s => {
    const cn = catName(s.cat);
    if (!byCat[cn]) byCat[cn] = [];
    const f = s.priceF || s.price_f || 0;
    const m = s.priceM || s.price_m || 0;
    const mf = s.memberPriceF || s.member_price_f || 0;
    const mm = s.memberPriceM || s.member_price_m || 0;
    let price = '';
    if (f === m && f > 0) price = `${f.toLocaleString()}원`;
    else if (f > 0 && m > 0) price = `여 ${f.toLocaleString()} / 남 ${m.toLocaleString()}`;
    else if (f > 0) price = `${f.toLocaleString()}원`;
    else if (m > 0) price = `${m.toLocaleString()}원`;
    let member = '';
    if (mf || mm) {
      if (mf === mm && mf > 0) member = ` (회원가 ${mf.toLocaleString()})`;
      else if (mf > 0 && mm > 0) member = ` (회원가: 여 ${mf.toLocaleString()} / 남 ${mm.toLocaleString()})`;
    }
    byCat[cn].push(`  · ${s.name} — ${price}${member}${s.dur ? ` · ${s.dur}분` : ''}`);
  });
  const out = [];
  Object.entries(byCat).forEach(([cn, lines]) => {
    out.push(`[${cn}]\n${lines.join('\n')}`);
  });
  return out.join('\n\n');
}

// ─── Tier 2: FAQ 검색 주입 ─────────────────────────────────────────────────
// 키워드 기반 매칭. 나중에 임베딩 기반으로 업그레이드 가능.
// 점수: 질문 내 각 단어가 FAQ q/a에 포함되면 +1. 카테고리 일치 +2.
export function searchFAQ(question, faqItems, topN = 8) {
  const active = (faqItems || []).filter(f => f?.active !== false && f?.q && f?.a);
  if (!active.length) return [];
  const q = question.toLowerCase().trim();
  if (!q) return [];
  const tokens = q.split(/[\s?!.,]+/).filter(t => t.length >= 2);
  if (!tokens.length) return [];

  const scored = active.map(f => {
    let score = 0;
    const text = (f.q + ' ' + f.a).toLowerCase();
    tokens.forEach(tok => {
      if (text.includes(tok)) score += 1;
      if (f.q.toLowerCase().includes(tok)) score += 0.5; // 질문에 있으면 가중
    });
    // 카테고리 힌트 (남자/임산부/위생 등 명시적 언급)
    const cat = (f.category || '').toLowerCase();
    if (cat && tokens.some(t => cat.includes(t) || t.includes(cat))) score += 2;
    return { faq: f, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, topN).map(s => s.faq);
}

export function buildFAQContext(question, faqItems, topN = 8) {
  const hits = searchFAQ(question, faqItems, topN);
  if (!hits.length) return '';
  const lines = hits.map((f, i) => `[FAQ ${i + 1}] Q: ${f.q}\nA: ${f.a}${f.category ? `\n(카테고리: ${f.category})` : ''}`);
  return `[관련 FAQ — 답변 작성 시 참고]\n${lines.join('\n\n')}`;
}

// ─── 최종 프롬프트 조립 ─────────────────────────────────────────────────────
export function buildFullPrompt({ question, data, faqItems, role = 'master', extraContext = '' }) {
  const parts = [SYSTEM_PROMPT];
  const staticCtx = buildStaticContext(data);
  if (staticCtx) parts.push(staticCtx);
  // 가격 관련 질문이면 서비스 가격표 주입
  if (/가격|비용|얼마|원|할인|회원가|price/i.test(question)) {
    const svcCtx = buildServicesContext(data);
    if (svcCtx) parts.push(`[시술 가격표]\n${svcCtx}`);
  }
  // FAQ 관련 검색
  const faqCtx = buildFAQContext(question, faqItems);
  if (faqCtx) parts.push(faqCtx);
  // 권한 안내
  if (role !== 'master') {
    parts.push('[권한] 현재 사용자는 일반 직원입니다. 고객 전화번호·주소 등 민감정보는 마스킹해서 답변해주세요 (예: 010-1234-****).');
  }
  // Tier 3 (실시간 조회) 결과
  if (extraContext) parts.push(extraContext);
  parts.push(`[현재 사용자 질문]\n${question}`);
  parts.push('[답변 지침] 관련 FAQ·데이터가 있으면 근거로 삼고, 없으면 모른다고 답하세요. 친근하고 간결하게.');
  return parts.join('\n\n');
}
