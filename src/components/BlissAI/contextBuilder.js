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
// ⚠️ 이 도구는 매장 직원/관리자 전용 내부 도구입니다 — 고객 응대용이 아닙니다.
// 답변 톤은 "동료에게 보고하듯" 간결·실무적이어야 합니다.
export const SYSTEM_PROMPT = `당신은 Bliss 예약관리 앱의 직원 전용 AI 업무 도구 "블리스 AI"입니다.

[중요 - 사용 맥락]
- 이 도구는 **매장 내부 직원/관리자**가 사용합니다. 고객 상담용이 절대 아닙니다.
- 따라서 "감사합니다", "예약 도와드릴게요!", "잠시만 기다려주세요" 같은 고객 응대형 인사 절대 사용하지 말 것.
- 동료에게 사실만 보고하는 실무적·간결한 톤으로 응답.

주요 역할:
- 직원이 시스템 사용법, 가격·시술 정책, FAQ를 빠르게 찾을 수 있게 도움.
- 매장 운영 데이터(예약·고객·매출) 조회해 간결하게 보고.
- 직원이 자연어로 예약·설정 변경을 요청하면 시스템이 자동으로 confirm 카드를 띄워 처리.
- 한국어 존댓말, 핵심부터, 불필요하게 길게 쓰지 않음.

[지원 가능한 작업 — 직원이 자연어로 요청 시 시스템이 처리]
- ✅ **예약 생성**: "내일 3시 강남 김철수 010... 브라질리언 예약" → 자동 등록 (직원 미배정, 상태 예약중)
- ✅ 지점/시술/직원/고객 등 설정 변경 (마스터 권한 한정)
- ✅ 데이터 조회 (예약·매출·고객)

[응답 규칙]
1. 직원이 "예약해줘", "예약 잡아줘" 같은 명령을 하면 → 인사말이나 수다 없이 시스템이 confirm 카드 띄울 수 있도록 두면 됨
2. 정보 조회 결과는 표/불릿으로 간결하게
3. 모르는 것은 "확인 안 됨" 또는 "관리자에게 문의 필요"라고 솔직히
4. 고객 개인정보(전화·주소)는 그대로 출력 가능 (직원 도구이므로)

[세팅 도우미 모드]
사용자가 "처음이야", "세팅 시작" 등 요청하면 단계적 안내 (지점→시술→직원).`;

// ─── Tier 1: 항상 주입 ─────────────────────────────────────────────────────
export function buildStaticContext(data) {
  const parts = [];
  // 지점 목록 — 풍부한 정보 (운영시간, 대표번호, 보조번호=WhatsApp, 주소, 예약안내)
  const branches = (data?.branches || []).filter(b => b.useYn !== false);
  if (branches.length) {
    const lines = branches.map(b => {
      const ts = (typeof b.timelineSettings === 'string' ? (() => { try { return JSON.parse(b.timelineSettings); } catch { return {}; } })() : (b.timelineSettings || {}));
      const open = ts.openTime || '';
      const close = ts.closeTime || '';
      const hours = (open && close) ? `${open}~${close}` : '';
      const segs = [b.short || b.name];
      if (b.address) segs.push(`주소: ${b.address}`);
      if (b.phone) segs.push(`☎ ${b.phone}`);
      if (b.altPhone) segs.push(`보조/WhatsApp: ${b.altPhone}`);
      if (hours) segs.push(`운영시간 ${hours}`);
      let line = '- ' + segs.join(' · ');
      if (b.bookingNotice && String(b.bookingNotice).trim()) {
        const notice = String(b.bookingNotice).trim().replace(/\n+/g, ' / ');
        line += `\n  · 예약/방문 안내: ${notice.length > 240 ? notice.slice(0, 240) + '…' : notice}`;
      }
      return line;
    });
    parts.push(`[지점 ${branches.length}개 — 운영시간/연락처/안내]\n${lines.join('\n')}`);
  }
  // 카테고리 요약
  const cats = (data?.serviceCategories || data?.categories || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  if (cats.length) {
    parts.push(`[시술 카테고리]\n${cats.map(c => c.name).filter(Boolean).join(' · ')}`);
  }
  // 예약 경로 (네이버/인스타/와츠앱/카톡 등)
  const sources = (data?.resSources || []).filter(s => s.useYn !== false);
  if (sources.length) {
    parts.push(`[예약 경로]\n${sources.map(s => s.name).join(' · ')}`);
  }
  // 외부 SNS / 메신저 핸들 — 비즈니스 settings 또는 branch 기반
  const snsLines = [];
  branches.forEach(b => {
    const tag = b.short || b.name;
    if (b.naverAccountId) snsLines.push(`${tag} · 네이버톡톡: ${b.naverAccountId}`);
    if (b.instagramAccountId) snsLines.push(`${tag} · 인스타그램 비즈니스 ID: ${b.instagramAccountId}`);
    if (b.whatsappAccountId) snsLines.push(`${tag} · WhatsApp Phone ID: ${b.whatsappAccountId}`);
  });
  if (snsLines.length) parts.push(`[채널/메신저 연동]\n${snsLines.join('\n')}\n(고객 안내용 번호는 보조/WhatsApp 행을 참고하세요)`);
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
// 키워드 기반 매칭 (한국어 조사 제거 + 양방향 부분일치 + 동의어 + 카테고리 자동 주입).
// 점수: 토큰이 FAQ q/a에 포함되면 +1, 질문에 있으면 +0.5, 카테고리 일치 +2, 동의어 매칭 +1.

// 동의어/유사어 — 다른 표현으로 물어도 FAQ에 매칭되도록 토큰 확장
const FAQ_SYNONYMS = {
  '스킨탈락':['벗겨','탈각','각질','피부','벗겨짐'],
  '탈각':['벗겨','각질','피부'],
  '탈피':['벗겨','각질','피부'],
  '벗겨짐':['벗겨','각질','피부'],
  '각질':['스크럽','벗겨','인그로운'],
  '인그로운':['털','각질','벗겨'],
  '음모왁싱':['브라질리언','음부','음모'],
  '음부':['브라질리언','음모'],
  '비키니왁싱':['비키니','브라질리언'],
  '겨드랑이':['겨드','암핏'],
  '음경':['남성','풀바디남','음모'],
  '클레임':['트러블','민원','불만'],
  '아파요':['아픔','통증','자극','얼얼'],
  '간지러움':['가려움','간지','가렵'],
  '뾰루지':['여드름','트러블','뾰드'],
  '울긋불긋':['붉은기','홍반','발적'],
  '주기':['얼마나 자주','자주','텀','간격'],
  '얼만큼':['주기','얼마나','자주'],
};

// 카테고리 자동 주입 — 질문에 이 키워드 있으면 해당 카테고리 FAQ 전체를 컨텍스트에 추가
const CATEGORY_KEYWORDS = {
  '사후관리&트러블': ['트러블','붉은기','홍반','가려움','간지','여드름','뾰루지','피부','벗겨','탈락','탈각','탈피','각질','인그로운','사우나','목욕','찜질','수영','운동','성관계','샤워','자극','진정','보습','케어','클레임','민원','발적'],
  '남성고객': ['남성','남자','남편','음모','음부','아폴로','파라쏘','풀바디남'],
  '매장편의': ['주차','파킹','오시는길','대기','탈의','준비물','샤워실'],
  '위생안전': ['위생','감염','소독','일회용','피부질환'],
  '임산부': ['임신','임산부','출산','수유','젖','태아'],
  '주기효과': ['주기','얼마나 자주','효과','왁싱효과','텀','간격','계속'],
};

const _STRIP_RE = /(이|가|은|는|을|를|의|에|에서|에게|한테|로|으로|와|과|랑|이랑|하고|도|만|야|요|입니다|입니까|인가요|이에요|예요|있어요|있나요|있다고|있는데|되나요|되요|돼요|되었어요|해요|해야|해야하나요|해야해|해주세요|해줘|왔어|왔어요|왔는데|클레임|어떻게|어떡해|어떡해야|있음|있나)$/;
function _stripParticle(t) {
  let cur = t;
  for (let i = 0; i < 3; i++) {
    const next = cur.replace(_STRIP_RE, '');
    if (next === cur || next.length < 2) break;
    cur = next;
  }
  return cur;
}

export function searchFAQ(question, faqItems, topN = 15) {
  const active = (faqItems || []).filter(f => f?.active !== false && f?.q && f?.a);
  if (!active.length) return [];
  const q = question.toLowerCase().trim();
  if (!q) return [];
  const rawTokens = q.split(/[\s?!.,~()]+/).filter(t => t.length >= 2);
  // 원형 + 조사 제거형 + 동의어 모두 토큰으로 확장
  const expanded = new Set();
  rawTokens.forEach(t => {
    expanded.add(t);
    const s = _stripParticle(t);
    if (s !== t && s.length >= 2) expanded.add(s);
    // 동의어 매핑 — 사용자 표현이 FAQ q/a에 없는 단어면 동의어로 보강
    Object.entries(FAQ_SYNONYMS).forEach(([key, syns]) => {
      if (t.includes(key) || s.includes(key)) syns.forEach(syn => expanded.add(syn));
    });
  });
  // 질문 전체에 카테고리 키워드가 들어있으면 그 카테고리도 토큰에 추가 (점수 부여용)
  Object.entries(CATEGORY_KEYWORDS).forEach(([cat, kws]) => {
    if (kws.some(kw => q.includes(kw))) expanded.add(cat.toLowerCase());
  });
  const tokens = Array.from(expanded);
  if (!tokens.length) return [];

  const scored = active.map(f => {
    let score = 0;
    const text = (f.q + ' ' + f.a).toLowerCase();
    const qLow = f.q.toLowerCase();
    tokens.forEach(tok => {
      if (text.includes(tok)) {
        score += 1;
        if (qLow.includes(tok)) score += 0.5;
      } else if (tok.length >= 3) {
        const pref = tok.slice(0, Math.min(3, tok.length - 1));
        if (pref.length >= 2 && qLow.includes(pref)) score += 0.4;
      }
    });
    const cat = (f.category || '').toLowerCase();
    if (cat && tokens.some(t => cat.includes(t) || t.includes(cat))) score += 2;
    return { faq: f, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, topN).map(s => s.faq);
}

// 질문에 카테고리 키워드 매칭 시 그 카테고리 전체 FAQ 반환
function getAutoInjectCategories(question, faqItems) {
  const q = question.toLowerCase();
  const matched = new Set();
  Object.entries(CATEGORY_KEYWORDS).forEach(([cat, kws]) => {
    if (kws.some(kw => q.includes(kw))) matched.add(cat);
  });
  if (!matched.size) return [];
  return (faqItems || []).filter(f => f?.active !== false && f?.q && f?.a && matched.has(f.category));
}

export function buildFAQContext(question, faqItems, topN = 15) {
  // 1) 카테고리 자동 주입 — 사용자 질문이 트러블/사후관리/남성/임산부 등 카테고리 키워드에 매칭되면 그 카테고리 전체 주입
  const catFAQs = getAutoInjectCategories(question, faqItems);
  // 2) 토큰/동의어 매칭 검색
  const hits = searchFAQ(question, faqItems, topN);
  // 3) 합치기 (카테고리 우선, 중복 제거)
  const merged = [];
  const seen = new Set();
  catFAQs.forEach(f => { const k = f.q + '|' + f.a; if (!seen.has(k)) { merged.push(f); seen.add(k); } });
  hits.forEach(f => { const k = f.q + '|' + f.a; if (!seen.has(k)) { merged.push(f); seen.add(k); } });
  if (!merged.length) return '';
  const lines = merged.map((f, i) => `[FAQ ${i + 1}] Q: ${f.q}\nA: ${f.a}${f.category ? `\n(카테고리: ${f.category})` : ''}`);
  return `[하우스왁싱 FAQ — 왁싱 관련 답변은 반드시 이 FAQ에 근거. 일반 지식 사용 금지]\n${lines.join('\n\n')}`;
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
  const base = BASE_LABEL[r.base] || r.base || '';
  // 필드 호환: rate(%)과 value(원/고정포인트)를 유연하게 해석
  const rateNum = r.rate != null ? r.rate : null;
  const amtNum = r.amount != null ? r.amount : (r.value != null ? r.value : null);
  const rate = rateNum != null ? `${rateNum}%` : '';
  const amt = amtNum != null ? `${Number(amtNum).toLocaleString()}원` : '';
  const pt = amtNum != null ? `${Number(amtNum).toLocaleString()}P` : '';
  const expiry = r.expiryMonths ? ` (${r.expiryMonths}개월 만료)` : '';
  const catIds = r.baseCategoryIds || [];
  const svcIds = r.baseServiceIds || [];
  const catPart = catIds.length ? ` · 대상 카테고리: ${catIds.map(catName).filter(Boolean).join(',')}` : '';
  const svcPart = svcIds.length ? ` · 대상 시술: ${svcIds.map(svcName).filter(Boolean).join(',')}` : '';
  const couponName = r.type === 'coupon_issue' && r.couponName ? ` "${r.couponName}"` : '';
  const qty = r.type === 'coupon_issue' ? ` ×${r.qty || 1}장` : '';
  let main;
  if (r.type === 'point_earn') {
    // base:"fixed"면 value가 고정 포인트 금액, 그 외엔 base × rate% 비율 적립
    if (r.base === 'fixed') main = `${pt} 적립${expiry}`;
    else main = `${base} × ${rate} 적립${expiry}`;
  }
  else if (r.type === 'discount_pct') main = `${base} × ${rate} 할인`;
  else if (r.type === 'discount_flat') main = `${amt} 할인`;
  else if (r.type === 'coupon_issue') main = `쿠폰${couponName}${qty} 발행${expiry}`;
  else if (r.type === 'prepaid_bonus') {
    if (r.base === 'fixed') main = `다담권 ${amt} 추가 충전`;
    else main = `다담권 ${base} × ${rate} 추가 충전`;
  }
  else if (r.type === 'free_service') main = `무료 시술`;
  else main = `${REWARD_LABEL[r.type] || r.type} ${rate || amt}`;
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
    lines.push('[용어 안내] 고객이 "패키지/패키지권"이라 말할 때는 보통 두 종류 모두 포함됩니다: "다회권(pkg)" = 횟수권(왁싱/재생/토탈/힐링 패키지 등), "다담권(prepaid)" = 선불권(30만·50만·100만원권 등 금액권). 각 트리거별 혜택 구분하여 답변하세요.');
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
  parts.push(
    '[답변 지침]\n' +
    '1) 🚨 왁싱 관련 모든 질문(시술·사후관리·트러블·붉은기·인그로운·각질·피부 벗겨짐·통증·가려움·여드름·임산부·주기·효과·위생·남성고객·매장편의·클레임 응대 등)은 반드시 위 [하우스왁싱 FAQ]에 근거해서만 답변하세요. 일반 지식·웹검색·추측·자체 추론 절대 금지. FAQ가 곧 하우스왁싱의 노하우이며 정답입니다.\n' +
    '2) 매장 정책·가격·운영시간·예약/매출/고객 데이터도 위 컨텍스트에 근거해서만 답하세요.\n' +
    '3) FAQ에 답이 없으면: "하우스왁싱 FAQ에 등록된 답변이 없어 정확히 안내드리기 어렵습니다. 대표에게 확인 후 답변드리겠습니다." 라고 답하세요. 일반 지식으로 채우지 마세요.\n' +
    '4) 답변 시 가능하면 어느 FAQ를 근거로 했는지 짧게 인용 가능 (예: "FAQ상 ~합니다").\n' +
    '5) 고객 응대 문장을 요청받으면 FAQ 답변을 바탕으로 따뜻하고 격식 있는 톤으로 작성하세요.\n' +
    '6) 의학적 진단·처방은 피하고, 심한 통증/지속되는 발진/감염 의심 등은 "의료 상담 권유"로 마무리하세요.\n' +
    '7) 친근하고 간결하게. 한국어 존댓말.'
  );
  return parts.join('\n\n');
}
