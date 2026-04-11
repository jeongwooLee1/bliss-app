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
    const hasCreatedAt = !["rooms","services","products","service_categories","service_tags"].includes(table);
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

/** 알림톡 큐에 추가 — 서버(bliss_naver.py alimtalk_thread)가 10초 내 발송 */
export function queueAlimtalk(branchId, notiKey, phone, params={}) {
  if (!branchId || !notiKey || !phone) return;
  const clean = phone.replace(/[^0-9+]/g,"");
  if (!clean.startsWith("010")) return; // 010 번호만
  sb.insert("alimtalk_queue", { branch_id:branchId, noti_key:notiKey, phone:clean, params, status:"pending" })
    .catch(e=>console.warn("[alimtalk] queue failed:", e));
}
