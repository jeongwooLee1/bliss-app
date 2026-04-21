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
export const SYSTEM_PROMPT = `당신은 Bliss 예약관리 앱의 AI 업무 도우미 "블리스 AI"입니다.
주요 역할:
- 신입 직원이 업무를 빠르게 익히도록 FAQ·정책·가격·시스템 이용법을 안내합니다.
- 매장 운영 데이터(예약·고객·매출)를 조회해 간결하게 알려줍니다.
- 사장님의 앱 초기 세팅(지점·시술·직원 등)을 대화로 도와드립니다. 사용자가 "처음이야", "세팅 시작", "매장 등록" 같은 말을 하면 단계적으로 질문하며 세팅을 진행합니다.
- 한국어로 따뜻하고 친근하게 답변합니다. 존댓말 사용.
- 확실한 정보만 답하고, 모르는 것은 "모르겠습니다" 또는 "담당자에게 확인 부탁드립니다"라고 솔직히 말합니다.
- 고객 개인정보(전화번호·주소 등)를 출력할 때는 마스킹 여부 지시를 따릅니다.
- 답변은 핵심부터, 불필요하게 길게 쓰지 않습니다. 필요하면 불릿/번호 사용.

[세팅 도우미 모드]
사용자가 앱을 처음 쓰거나 "세팅 도와줘" 요청하면:
1. 현재 등록된 데이터(지점/시술/직원)를 참고해서 부족한 항목을 안내
2. 한 번에 하나씩 질문 (지점부터 → 시술 → 직원 순)
3. 사용자가 정보를 주면 "변경/추가 액션"으로 처리 (시스템이 confirm 카드 띄워줌)
4. 사용자가 "메뉴판 사진 있어" 하면 "사진 기능은 관리설정 → 설정마법사에서 업로드 가능해요"라고 안내 (사진 파싱은 현재 대화로 불가)`;

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

// ─── 이벤트/쿠폰 컨텍스트 (조건부 주입) ─────────────────────────────────────
const TRIGGER_LABEL = {
  new_first_sale: '신규 고객 첫 매출',
  prepaid_purchase: '다담권 구매',
  pkg_purchase: '다회권 구매',
  annual_purchase: '연간권 구매',
  any_sale: '모든 매출',
};
const REWARD_LABEL = {
  point_earn: '포인트 적립',
  discount_pct: '할인(%)',
  discount_flat: '할인(정액)',
  coupon_issue: '쿠폰 발행',
  prepaid_bonus: '다담권 보너스',
  free_service: '무료 시술',
};
const BASE_LABEL = {
  svc: '시술합계',
  svc_prod: '시술+제품',
  prepaid_amount: '다담권 결제액',
  pkg_amount: '다회권 결제액',
  net_pay: '실결제액(할인 후)',
  fixed: '고정액',
  category: '특정 카테고리 합계',
  services: '특정 시술 합계',
};

function formatReward(r, catName, svcName) {
  const type = REWARD_LABEL[r.type] || r.type;
  const base = BASE_LABEL[r.base] || r.base || '';
  const rate = r.rate != null ? `${r.rate}%` : '';
  const amt = r.amount != null ? `${Number(r.amount).toLocaleString()}원` : '';
  const expiry = r.expiryMonths ? ` (${r.expiryMonths}개월 만료)` : '';
  const catIds = r.baseCategoryIds || [];
  const svcIds = r.baseServiceIds || [];
  const catPart = catIds.length ? ` · 대상 카테고리: ${catIds.map(catName).filter(Boolean).join(',')}` : '';
  const svcPart = svcIds.length ? ` · 대상 시술: ${svcIds.map(svcName).filter(Boolean).join(',')}` : '';
  const couponName = r.type === 'coupon_issue' && r.couponName ? ` "${r.couponName}"` : '';
  const qty = r.type === 'coupon_issue' && r.qty ? ` ×${r.qty}장` : '';
  let main;
  if (r.type === 'point_earn') main = `${base} × ${rate} 적립${expiry}`;
  else if (r.type === 'discount_pct') main = `${base} × ${rate} 할인`;
  else if (r.type === 'discount_flat') main = `${amt} 할인`;
  else if (r.type === 'coupon_issue') main = `쿠폰${couponName}${qty} 발행`;
  else if (r.type === 'prepaid_bonus') main = `다담권 ${amt || rate} 추가 충전`;
  else if (r.type === 'free_service') main = `무료 시술`;
  else main = `${type} ${rate || amt}`;
  return `${main}${catPart}${svcPart}`;
}

function formatConditions(c, catName, svcName) {
  if (!c || typeof c !== 'object') return '';
  const parts = [];
  if (Array.isArray(c.categoriesAny) && c.categoriesAny.length)
    parts.push(`카테고리 중 하나: ${c.categoriesAny.map(catName).filter(Boolean).join(',')}`);
  if (Array.isArray(c.servicesAny) && c.servicesAny.length)
    parts.push(`시술 중 하나: ${c.servicesAny.map(svcName).filter(Boolean).join(',')}`);
  if (Array.isArray(c.servicesAll) && c.servicesAll.length)
    parts.push(`시술 모두 포함: ${c.servicesAll.map(svcName).filter(Boolean).join(',')}`);
  if (Array.isArray(c.servicesNone) && c.servicesNone.length)
    parts.push(`제외 시술: ${c.servicesNone.map(svcName).filter(Boolean).join(',')}`);
  if (Array.isArray(c.prepaidServiceIds) && c.prepaidServiceIds.length)
    parts.push(`대상 다담권: ${c.prepaidServiceIds.map(svcName).filter(Boolean).join(',')}`);
  if (Array.isArray(c.pkgServiceIds) && c.pkgServiceIds.length)
    parts.push(`대상 다회권: ${c.pkgServiceIds.map(svcName).filter(Boolean).join(',')}`);
  if (Array.isArray(c.annualServiceIds) && c.annualServiceIds.length)
    parts.push(`대상 연간권: ${c.annualServiceIds.map(svcName).filter(Boolean).join(',')}`);
  if (c.amountMin) parts.push(`최소 ${Number(c.amountMin).toLocaleString()}원 이상`);
  if (c.amountMax) parts.push(`최대 ${Number(c.amountMax).toLocaleString()}원 이하`);
  if (c.customerHasActivePrepaid === true) parts.push('유효 다담권 보유');
  if (c.customerHasActivePrepaid === false) parts.push('유효 다담권 없음');
  if (c.customerHasActivePkg === true) parts.push('유효 다회권 보유');
  if (c.customerHasActivePkg === false) parts.push('유효 다회권 없음');
  if (c.customerHasActiveAnnual === true) parts.push('유효 연간권 보유');
  if (c.customerHasActiveAnnual === false) parts.push('유효 연간권 없음');
  if (c.paymentUsesPrepaid === true) parts.push('다담권 결제 사용');
  if (c.paymentFullPrepaid === true) parts.push('다담권 전액 결제');
  if (c.paymentUsesPoint === true) parts.push('포인트 사용');
  if (c.paymentUsesCoupon === true) parts.push('쿠폰 사용');
  return parts.join(' / ');
}

export function buildEventsContext(data) {
  try {
    const biz = (data?.businesses || [])[0];
    const s = typeof biz?.settings === 'string' ? JSON.parse(biz.settings) : (biz?.settings || {});
    const master = s?.events_master_enabled === true;
    const events = Array.isArray(s?.events) ? s.events : [];
    const coupons = Array.isArray(s?.coupons) ? s.coupons : [];
    const cats = data?.serviceCategories || data?.categories || [];
    const svcs = data?.services || [];
    const catName = (id) => cats.find(c => c.id === id)?.name || '';
    const svcName = (id) => svcs.find(x => x.id === id)?.name || '';
    const lines = [];
    lines.push(`[이벤트 엔진 마스터 스위치: ${master ? 'ON (활성)' : 'OFF (전체 비활성)'}]`);
    if (!events.length && !coupons.length) {
      lines.push('등록된 이벤트·쿠폰 없음');
      return lines.join('\n');
    }
    if (events.length) {
      lines.push(`\n[이벤트 ${events.length}개]`);
      events.forEach((e, i) => {
        const on = e.enabled !== false;
        const trg = TRIGGER_LABEL[e.trigger] || e.trigger || '?';
        const cond = formatConditions(e.conditions, catName, svcName);
        const rewards = Array.isArray(e.rewards) ? e.rewards : (e.rewardType ? [{ type: e.rewardType, ...e }] : []);
        const rewardStr = rewards.map(r => formatReward(r, catName, svcName)).join(' / ') || '(보상 없음)';
        lines.push(`${i + 1}. ${e.name || '(이름 없음)'} — ${on ? 'ON' : 'OFF'}`);
        lines.push(`   트리거: ${trg}${cond ? ` · 조건: ${cond}` : ''}`);
        lines.push(`   보상: ${rewardStr}`);
        if (e.desc) lines.push(`   설명: ${e.desc}`);
      });
    }
    if (coupons.length) {
      lines.push(`\n[쿠폰 템플릿 ${coupons.length}개]`);
      coupons.forEach((c, i) => {
        const on = c.enabled !== false;
        const v = c.type === 'pct' ? `${c.value}%` : `${Number(c.value || 0).toLocaleString()}원`;
        lines.push(`${i + 1}. ${c.name || '(이름 없음)'} — ${on ? 'ON' : 'OFF'} · ${v}`);
      });
    }
    return lines.join('\n');
  } catch (e) {
    return '';
  }
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
  // 이벤트/쿠폰 관련 질문이면 이벤트 엔진 상태 주입
  if (/이벤트|쿠폰|할인|적립|포인트|혜택|프로모션|첫방문|첫구매|신규|보너스|다담권.*증정|무료\s*시술/i.test(question)) {
    const evtCtx = buildEventsContext(data);
    if (evtCtx) parts.push(evtCtx);
  }
  // 권한 안내 (마스킹은 안 함 — 혼자 사업 전제. 쓰기만 대표 제한)
  if (role !== 'master') {
    parts.push('[권한] 현재 사용자는 지점 계정(읽기 전용)입니다. 조회는 자유롭게 가능하지만, 설정 변경·데이터 수정은 불가합니다. 변경 요청을 받으면 "브랜드 대표에게 요청해주세요"라고 안내해주세요.');
  }
  // Tier 3 (실시간 조회) 결과
  if (extraContext) parts.push(extraContext);
  parts.push(`[현재 사용자 질문]\n${question}`);
  parts.push('[답변 지침] 관련 FAQ·데이터가 있으면 근거로 삼고, 없으면 모른다고 답하세요. 친근하고 간결하게.');
  return parts.join('\n\n');
}
