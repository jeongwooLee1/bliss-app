// Supabase fetch-based API wrapper (원본 index.html L32~47 그대로)
export const SB_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co"
export const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnRscnN1cXhxcWVvdXdiZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDU4MjQsImV4cCI6MjA4NzQ4MTgyNH0.iydEkjtPjZ0jXpUUPJben4IWWneDqLomv-HDlcFayE4"

export const sbHeaders = {
  "apikey": SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
}

export const sb = {
  async get(table, filter="") {
    const hasSortCol = ["services","products","service_tags","service_categories","reservation_sources","branches"].includes(table);
    const hasCreatedAt = !["rooms","services","products","service_categories","service_tags"].includes(table);
    const order = hasSortCol ? "order=sort.asc.nullslast" : (hasCreatedAt ? "order=created_at.asc.nullslast" : "order=id.asc");
    const r=await fetch(`${SB_URL}/rest/v1/${table}?select=*&${order}${filter}`,{headers:sbHeaders});
    if(!r.ok){const e=await r.text();console.error(`DB get ${table} failed:`,${r.status},e);}
    return r.ok?r.json():[];
  },
  async getByBiz(table, bizId) { return this.get(table, `&business_id=eq.${bizId}`); },
  async upsert(table,rows) { if(!rows?.length)return; const r=await fetch(`${SB_URL}/rest/v1/${table}`,{method:"POST",headers:{...sbHeaders,"Prefer":"resolution=merge-duplicates,return=representation"},body:JSON.stringify(rows)}); if(!r.ok){const e=await r.text();console.error(`DB upsert ${table} FAILED [${r.status}]:`,e);alert(`DB저장 실패(${table}): ${e}`);} },
  async insert(table,row) { const r=await fetch(`${SB_URL}/rest/v1/${table}`,{method:"POST",headers:sbHeaders,body:JSON.stringify(row)}); if(!r.ok){const e=await r.text();console.error(`DB insert ${table} FAILED [${r.status}]:`,e);alert(`DB저장 실패(${table}): ${e}`);return null;} return r.json(); },
  async update(table,id,row) { const r=await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`,{method:"PATCH",headers:sbHeaders,body:JSON.stringify(row)}); if(!r.ok){const e=await r.text();console.error(`DB update ${table} FAILED [${r.status}]:`,e);alert(`DB수정 실패(${table}): ${e}`);} },
  async del(table,id) { await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`,{method:"DELETE",headers:sbHeaders}); },
  async delWhere(table,col,val) { await fetch(`${SB_URL}/rest/v1/${table}?${col}=eq.${val}`,{method:"DELETE",headers:sbHeaders}); },
}
