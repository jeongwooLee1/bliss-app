// Supabase fetch-based API wrapper (원본 index.html L32~47 그대로)
export const SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
export const SB_KEY = "sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj"

export const sbHeaders = {
  "apikey": SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
}

export const sb = {
  async get(table, filter="") {
    // filter가 &로 시작하지 않는 단순 ID면 → &id=eq.{id}&limit=1 로 변환
    if (filter && !filter.startsWith("&")) {
      filter = `&id=eq.${filter}&limit=1`;
    }
    const hasSortCol = ["services","products","service_tags","service_categories","reservation_sources","branches"].includes(table);
    const hasCreatedAt = !["rooms","services","products","service_categories","service_tags","schedule_data"].includes(table);
    const descTables = ["customers"];
    const order = hasSortCol ? "order=sort.asc.nullslast" : (hasCreatedAt ? (descTables.includes(table) ? "order=created_at.desc.nullslast" : "order=created_at.asc.nullslast") : "order=id.asc");
    const r=await fetch(`${SB_URL}/rest/v1/${table}?select=*${filter.includes('order=')?'':('&'+order)}${filter}`,{headers:{...sbHeaders,"Cache-Control":"no-cache"},cache:"no-store"});
    if(!r.ok){const e=await r.text();console.error(`DB get ${table} failed:`, r.status, e);}
    return r.ok?r.json():[];
  },
  async getByBiz(table, bizId) { return this.get(table, `&business_id=eq.${bizId}`); },
  async upsert(table,rows) { if(!rows?.length)return; const r=await fetch(`${SB_URL}/rest/v1/${table}`,{method:"POST",headers:{...sbHeaders,"Prefer":"resolution=merge-duplicates,return=representation"},body:JSON.stringify(rows)}); if(!r.ok){const e=await r.text();console.error(`DB upsert ${table} FAILED [${r.status}]:`,e);alert(`DB저장 실패(${table}): ${e}`);} },
  async insert(table,row) { const r=await fetch(`${SB_URL}/rest/v1/${table}`,{method:"POST",headers:sbHeaders,body:JSON.stringify(row)}); if(!r.ok){const e=await r.text();console.error(`DB insert ${table} FAILED [${r.status}]:`,e);alert(`DB저장 실패(${table}): ${e}`);return null;} return r.json(); },
  async update(table,id,row) { const r=await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`,{method:"PATCH",headers:sbHeaders,body:JSON.stringify(row)}); if(!r.ok){const e=await r.text();console.error(`DB update ${table} FAILED [${r.status}]:`,e);alert(`DB수정 실패(${table}): ${e}`);} },
  async del(table,id) { await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`,{method:"DELETE",headers:sbHeaders}); },
  async delWhere(table,col,val) { await fetch(`${SB_URL}/rest/v1/${table}?${col}=eq.${val}`,{method:"DELETE",headers:sbHeaders}); },
}

/**
 * 다토큰 AND + 필드 OR 검색 필터 빌더
 * "정우 8008" 같은 공백 구분 검색어에서 각 토큰이 어느 필드에든 포함되면 매칭.
 * @param {string} raw   검색어 전체 문자열
 * @param {string[]} fields  검색 대상 DB 컬럼명 배열
 * @returns {string} &or=(...) 또는 &and=(or(...),or(...)) 형태 필터 (빈 검색어면 "")
 */
export function buildTokenSearch(raw, fields) {
  const tokens = (raw||"").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !fields?.length) return "";
  const orOf = (tok) => {
    const e = encodeURIComponent(tok);
    return fields.map(f => `${f}.ilike.*${e}*`).join(",");
  };
  if (tokens.length === 1) return `&or=(${orOf(tokens[0])})`;
  return `&and=(${tokens.map(t => `or(${orOf(t)})`).join(",")})`;
}

/** 다토큰 AND 클라이언트 매처 — 로컬 배열 검색용 */
export function matchAllTokens(haystack, raw) {
  const tokens = (raw||"").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = (haystack||"").toLowerCase();
  return tokens.every(t => hay.includes(t.toLowerCase()));
}

/**
 * 대용량 테이블용 하이브리드 검색: 첫 토큰만 서버 OR 필터, 나머지 토큰은 클라이언트 AND에서 처리.
 * 반환된 결과를 클라이언트에서 matchAllTokens(row_haystack, raw)로 추가 필터링해야 함.
 */
export function buildFirstTokenSearch(raw, fields) {
  const tokens = (raw||"").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !fields?.length) return "";
  const e = encodeURIComponent(tokens[0]);
  return `&or=(${fields.map(f => `${f}.ilike.*${e}*`).join(",")})`;
}

/** 알림톡 큐에 추가 — 서버(bliss_naver.py alimtalk_thread)가 10초 내 발송 */
export function queueAlimtalk(branchId, notiKey, phone, params={}) {
  if (!branchId || !notiKey || !phone) return;
  const clean = phone.replace(/[^0-9+]/g,"");
  if (!clean.startsWith("010")) return; // 010 번호만
  sb.insert("alimtalk_queue", { branch_id:branchId, noti_key:notiKey, phone:clean, params, status:"pending" })
    .catch(e=>console.warn("[alimtalk] queue failed:", e));
}
