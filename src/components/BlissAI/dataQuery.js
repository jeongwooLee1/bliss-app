/**
 * dataQuery.js — 블리스 AI 실시간 DB 조회 헬퍼
 *
 * Phase 2 범위:
 *   - 고객 조회: 이름·전화·회원번호로 검색, 기본정보+방문이력+보유권 반환
 *   - 매출 조회: 기간/지점 집계 (일별·주별·월별, 전지점·특정지점)
 *   - 예약 조회: 오늘/내일/특정일 목록
 *
 * 권한 처리:
 *   - role='master': 제한 없음
 *   - role='staff': userBranches 내 데이터만, 고객 전화번호·주소 마스킹
 */
import { sb } from '../../lib/sb';

// ─── 유틸 ───────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);
const KST_OFFSET_MIN = 9 * 60;
function addDaysStr(ymd, days) {
  const d = new Date(ymd);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
export function maskPhone(p) {
  if (!p) return '';
  const n = String(p).replace(/\D/g, '');
  if (n.length >= 10) return `${n.slice(0, 3)}-${n.slice(3, 7)}-****`;
  return p.slice(0, 3) + '****';
}

// ─── 고객 조회 ──────────────────────────────────────────────────────────────
export async function queryCustomer(searchTerm, { role = 'master', userBranches = [], bizId }) {
  if (!searchTerm) return null;
  const term = searchTerm.trim();
  // 다토큰 검색: 공백으로 분리된 각 토큰이 name|name2|phone|phone2|cust_num 중 어딘가에 포함
  const tokens = term.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const fields = ['name', 'name2', 'phone', 'phone2', 'email', 'cust_num'];
  // 각 토큰의 or(...) 을 and(...) 로 결합
  const andClauses = tokens
    .map(tok => {
      const e = encodeURIComponent(tok);
      return `or(${fields.map(f => `${f}.ilike.*${e}*`).join(',')})`;
    })
    .join(',');
  const cond = tokens.length === 1
    ? `&or=(${fields.map(f => `${f}.ilike.*${encodeURIComponent(tokens[0])}*`).join(',')})`
    : `&and=(${andClauses})`;
  const bidFilter = bizId ? `&business_id=eq.${bizId}` : '';
  try {
    const rows = await sb.get('customers', `${bidFilter}&is_hidden=eq.false${cond}&limit=10`);
    if (!Array.isArray(rows) || rows.length === 0) return { found: 0, items: [] };
    // 권한 필터
    let filtered = rows;
    if (role !== 'master' && userBranches?.length) {
      filtered = rows.filter(c => !c.bid || userBranches.includes(c.bid));
    }
    // 보유권 조회 (상위 5명)
    const top = filtered.slice(0, 5);
    const ids = top.map(c => c.id);
    let pkgsById = {};
    if (ids.length) {
      try {
        const pkgs = await sb.get('customer_packages', `&customer_id=in.(${ids.join(',')})&select=customer_id,service_name,total_count,used_count,note`);
        (pkgs || []).forEach(p => {
          (pkgsById[p.customer_id] = pkgsById[p.customer_id] || []).push(p);
        });
      } catch {}
    }
    const items = top.map(c => ({
      id: c.id,
      name: c.name,
      name2: c.name2,
      phone: role === 'master' ? c.phone : maskPhone(c.phone),
      gender: c.gender,
      cust_num: c.cust_num,
      bid: c.bid,
      visits: c.visits || 0,
      last_visit_date: c.last_visit_date,
      memo: c.memo,
      join_date: c.join_date,
      sms_consent: c.sms_consent,
      packages: (pkgsById[c.id] || []).map(p => ({
        name: p.service_name,
        remain: (p.total_count || 0) - (p.used_count || 0),
        total: p.total_count,
        balance: ((p.note || '').match(/잔액:([0-9,]+)/) || [])[1] || null,
      })),
    }));
    return { found: filtered.length, items };
  } catch (e) {
    console.warn('[BlissAI] queryCustomer error:', e);
    return null;
  }
}

// ─── 매출 집계 ──────────────────────────────────────────────────────────────
// period: 'today' | 'yesterday' | 'week' | 'month' | 'custom({start,end})'
export async function querySales({ start, end, bid = null, role = 'master', userBranches = [], bizId }) {
  if (!start || !end) return null;
  const bidFilter = bizId ? `&business_id=eq.${bizId}` : '';
  let branchFilter = '';
  if (role !== 'master') {
    const allowed = (userBranches || []).filter(b => bid == null || b === bid);
    if (!allowed.length) return { error: '권한 없음' };
    branchFilter = `&bid=in.(${allowed.join(',')})`;
  } else if (bid) {
    branchFilter = `&bid=eq.${bid}`;
  }
  try {
    const rows = await sb.get(
      'sales',
      `${bidFilter}${branchFilter}&date=gte.${start}&date=lte.${end}&select=id,date,bid,svc_cash,svc_card,svc_transfer,svc_point,prod_cash,prod_card,prod_transfer,prod_point&limit=5000`
    );
    if (!Array.isArray(rows)) return null;
    let total = 0, svcTotal = 0, prodTotal = 0;
    const byBranch = {};
    const byDate = {};
    rows.forEach(r => {
      const svc = (r.svc_cash || 0) + (r.svc_card || 0) + (r.svc_transfer || 0) + (r.svc_point || 0);
      const prod = (r.prod_cash || 0) + (r.prod_card || 0) + (r.prod_transfer || 0) + (r.prod_point || 0);
      const sum = svc + prod;
      total += sum;
      svcTotal += svc;
      prodTotal += prod;
      if (r.bid) byBranch[r.bid] = (byBranch[r.bid] || 0) + sum;
      if (r.date) byDate[r.date] = (byDate[r.date] || 0) + sum;
    });
    return {
      period: { start, end },
      count: rows.length,
      total,
      svcTotal,
      prodTotal,
      byBranch,
      byDate,
    };
  } catch (e) {
    console.warn('[BlissAI] querySales error:', e);
    return null;
  }
}

// ─── 예약 조회 ──────────────────────────────────────────────────────────────
export async function queryReservations({ date, bid = null, role = 'master', userBranches = [], bizId }) {
  if (!date) return null;
  const bidFilter = bizId ? `&business_id=eq.${bizId}` : '';
  let branchFilter = '';
  if (role !== 'master') {
    const allowed = (userBranches || []).filter(b => bid == null || b === bid);
    if (!allowed.length) return { error: '권한 없음' };
    branchFilter = `&bid=in.(${allowed.join(',')})`;
  } else if (bid) {
    branchFilter = `&bid=eq.${bid}`;
  }
  try {
    const rows = await sb.get(
      'reservations',
      `${bidFilter}${branchFilter}&date=eq.${date}&is_schedule=eq.false&order=time.asc&select=id,reservation_id,time,dur,bid,cust_name,cust_phone,status,selected_services,source,room_id,staff_id&limit=500`
    );
    if (!Array.isArray(rows)) return null;
    return {
      date,
      count: rows.length,
      items: rows.map(r => ({
        id: r.id,
        time: r.time,
        name: r.cust_name,
        phone: role === 'master' ? r.cust_phone : maskPhone(r.cust_phone),
        status: r.status,
        bid: r.bid,
        source: r.source,
        selected_services: r.selected_services,
      })),
    };
  } catch (e) {
    console.warn('[BlissAI] queryReservations error:', e);
    return null;
  }
}

// ─── Intent 분류: LLM 기반 (정확도 우선) ──────────────────────────────────
// LLM에게 JSON 형식으로 질문 유형과 파라미터를 묻고 fallback으로 키워드 분류 사용
// callGemini: (prompt, options) => Promise<string>  — BlissAI가 주입
export async function classifyIntentLLM(question, callGemini) {
  if (!question || !callGemini) return classifyIntent(question)
  const today = todayStr()
  const tomorrow = addDaysStr(today, 1)
  const yesterday = addDaysStr(today, -1)
  const prompt = `아래 질문을 보고 JSON 형식으로 답하세요. 다른 말은 하지 마세요.

[유형 5가지]
- "reservation": 예약 조회 (오늘/내일/특정일 예약 현황)
- "sales": 매출 조회/집계 (기간별 매출 액수)
- "customer": 특정 고객 조회 (이름/전화/회원번호로 찾기)
- "faq": FAQ 관련 질문 (정책/안내/사후관리 등)
- "general": 그 외 일반 대화

[필드]
- type: 위 5가지 중 하나
- params: 유형별 파라미터
  - reservation: { "date": "YYYY-MM-DD" }  (오늘은 "${today}", 내일은 "${tomorrow}", 어제는 "${yesterday}")
  - sales: { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }  (오늘 = start/end 같음)
  - customer: { "searchTerm": "검색어" }  (이름 또는 전화 일부, 질문에서 추출)
  - faq / general: {}

[질문]
"${question}"

[응답 예시]
{"type":"reservation","params":{"date":"${today}"}}
{"type":"sales","params":{"start":"${today}","end":"${today}"}}
{"type":"customer","params":{"searchTerm":"홍길동"}}
{"type":"faq","params":{}}
{"type":"general","params":{}}

JSON만 출력:`
  try {
    const raw = await callGemini(prompt, { useHistory: false })
    // JSON 추출
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('no json')
    const obj = JSON.parse(m[0])
    if (!obj.type || !['reservation','sales','customer','faq','general'].includes(obj.type)) {
      throw new Error('invalid type')
    }
    if (!obj.params) obj.params = {}
    return obj
  } catch (e) {
    console.warn('[BlissAI] LLM intent classify fallback:', e?.message)
    return classifyIntent(question)
  }
}

// ─── Intent 분류: 키워드 기반 (fallback) ──────────────────────────────────
// 반환: { type: 'faq'|'customer'|'sales'|'reservation'|'general', params:{...} }
export function classifyIntent(question) {
  const q = question.toLowerCase().trim();
  if (!q) return { type: 'general', params: {} };

  // 예약 조회
  if (/예약.*(몇|얼마|개|건|있|보|있어|있나|목록|리스트)|오늘.*예약|내일.*예약/.test(q) || /오늘\s*예약/.test(q)) {
    let date = todayStr();
    if (/내일/.test(q)) date = addDaysStr(todayStr(), 1);
    else if (/어제/.test(q)) date = addDaysStr(todayStr(), -1);
    else if (/모레/.test(q)) date = addDaysStr(todayStr(), 2);
    return { type: 'reservation', params: { date } };
  }

  // 매출 조회
  if (/매출|수익|얼마.*벌|총액/.test(q)) {
    let start = todayStr(), end = todayStr();
    if (/이번\s*달|이달/.test(q)) {
      const d = new Date();
      start = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
      end = todayStr();
    } else if (/지난\s*달|저번\s*달/.test(q)) {
      const d = new Date();
      const lm = new Date(d.getFullYear(), d.getMonth()-1, 1);
      const lme = new Date(d.getFullYear(), d.getMonth(), 0);
      start = lm.toISOString().slice(0,10);
      end = lme.toISOString().slice(0,10);
    } else if (/이번\s*주|이번주/.test(q)) {
      const d = new Date();
      const dow = d.getDay();
      const mon = new Date(d); mon.setDate(d.getDate() - ((dow + 6) % 7));
      start = mon.toISOString().slice(0,10);
      end = todayStr();
    } else if (/어제/.test(q)) {
      start = end = addDaysStr(todayStr(), -1);
    } else if (/7일|일주일|주간/.test(q)) {
      start = addDaysStr(todayStr(), -6);
    } else if (/30일|한달간/.test(q)) {
      start = addDaysStr(todayStr(), -29);
    }
    return { type: 'sales', params: { start, end } };
  }

  // 고객 조회 (숫자/한글 + "고객","손님" 키워드 or 4자리 이상 숫자 단독)
  if (/고객|손님|회원|전화번호|연락처/.test(q) || /\b\d{4,}\b/.test(q) || /^[가-힣]{2,4}$/.test(q.trim())) {
    // 쿼리 텀 추출: 문장에서 고객 이름/전화번호 같은 토큰 추출
    const cleaned = q.replace(/(고객|손님|회원|전화번호|연락처|찾|보여|알려|검색|정보|알려줘|조회)/g, ' ').trim();
    return { type: 'customer', params: { searchTerm: cleaned || q } };
  }

  return { type: 'faq', params: {} };
}

// ─── Intent 결과 → prompt용 컨텍스트 문자열로 포맷 ──────────────────────────
export function formatIntentResult(intent, result, branches = []) {
  if (!result) return '';
  if (result.error) return `[데이터 조회 실패] ${result.error}`;
  const branchName = (bid) => branches.find(b => b.id === bid)?.short || branches.find(b => b.id === bid)?.name || bid;

  if (intent.type === 'customer') {
    if (!result.items?.length) return `[고객 검색 결과] "${intent.params.searchTerm}" 일치 없음`;
    const lines = result.items.map(c => {
      const pkgs = c.packages.length
        ? '\n  보유권: ' + c.packages.map(p => `${p.name}${p.balance ? ` (잔액 ${p.balance})` : ` (${p.remain}/${p.total})`}`).join(', ')
        : '';
      return `- ${c.name}${c.name2 ? ` (${c.name2})` : ''} · ${c.phone || '번호없음'} · ${c.gender === 'F' ? '여' : c.gender === 'M' ? '남' : '?'} · 방문 ${c.visits}회 · 최근 ${c.last_visit_date || '-'}${c.cust_num ? ` · #${c.cust_num}` : ''}${c.bid ? ` · ${branchName(c.bid)}` : ''}${pkgs}${c.memo ? `\n  메모: ${c.memo}` : ''}`;
    });
    return `[고객 검색 결과 — 총 ${result.found}명${result.found > result.items.length ? ` (상위 ${result.items.length}명 표시)` : ''}]\n${lines.join('\n')}`;
  }

  if (intent.type === 'sales') {
    const { period, count, total, svcTotal, prodTotal, byBranch } = result;
    const brLines = Object.entries(byBranch || {})
      .sort((a,b) => b[1] - a[1])
      .map(([bid, amt]) => `  · ${branchName(bid)}: ${amt.toLocaleString()}원`)
      .join('\n');
    return `[매출 집계 ${period.start} ~ ${period.end}]
총 매출: ${total.toLocaleString()}원 (${count}건)
  - 시술: ${svcTotal.toLocaleString()}원
  - 제품: ${prodTotal.toLocaleString()}원
${brLines ? '지점별:\n' + brLines : ''}`;
  }

  if (intent.type === 'reservation') {
    const { date, count, items } = result;
    if (!count) return `[${date} 예약] 없음`;
    const byStatus = {};
    items.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
    const statusSummary = Object.entries(byStatus).map(([s,c]) => `${s}:${c}`).join(', ');
    const sample = items.slice(0, 15).map(r =>
      `  ${r.time || '--'} · ${r.name || '?'} · ${r.phone || ''} · ${branchName(r.bid)} · ${r.status}`
    );
    return `[${date} 예약 총 ${count}건 (${statusSummary})]\n${sample.join('\n')}${count > 15 ? `\n... 외 ${count - 15}건` : ''}`;
  }

  return '';
}
