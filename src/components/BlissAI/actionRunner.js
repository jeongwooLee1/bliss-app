/**
 * actionRunner.js — 클로드 AI 액션 실행 + 프리뷰 생성
 *
 * 흐름:
 *   1. validateAction(action, params, data) → 에러 메시지 or null
 *   2. buildPreview(action, params, data) → 유저에게 보여줄 변경 요약
 *   3. executeAction(action, params, data, context) → DB 실행 + 결과 반환
 */
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { ACTION_SCHEMAS } from './actionSchemas'

// ─── 타겟 검색 ──────────────────────────────────────────────────────────────
// data 내 배열에서 name/short/phone/id 등 매칭되는 항목 찾기
export function findTarget(action, target, data) {
  const schema = ACTION_SCHEMAS[action]
  if (!schema) return null
  if (!schema.targetField) return null
  const normalized = String(target || '').trim().toLowerCase()
  if (!normalized) return null

  // 테이블별 소스 배열
  const sourceMap = {
    branches: data?.branches || [],
    services: data?.services || [],
    service_categories: data?.categories || data?.serviceCategories || [],
    rooms: data?.rooms || [],
    reservation_sources: data?.resSources || [],
    customers: data?.customers || [],
  }
  const source = schema.table ? sourceMap[schema.table] : null
  if (source) {
    const fields = schema.targetField.split(',')
    // 우선 exact, 다음 contains
    for (const f of fields) {
      const exact = source.find(r => String(r[f] || '').toLowerCase() === normalized)
      if (exact) return exact
    }
    for (const f of fields) {
      const partial = source.find(r => String(r[f] || '').toLowerCase().includes(normalized))
      if (partial) return partial
    }
  }
  // schedule_data 기반 (직원 등) — 외부에서 로드 후 비교
  if (schema.scheduleKey === 'employees_v1') {
    const emps = data?._employees || []
    const fields = (schema.targetField || 'name').split(',')
    for (const f of fields) {
      const exact = emps.find(e => String(e[f] || '').toLowerCase() === normalized)
      if (exact) return exact
    }
    for (const f of fields) {
      const partial = emps.find(e => String(e[f] || '').toLowerCase().includes(normalized))
      if (partial) return partial
    }
  }
  return null
}

// ─── 검증 ──────────────────────────────────────────────────────────────────
export function validateAction(action, params) {
  const schema = ACTION_SCHEMAS[action]
  if (!schema) return `알 수 없는 액션: ${action}`
  if (schema.validate) {
    const err = schema.validate(params)
    if (err) return err
  }
  // fieldsAllowed 외 필드는 경고만 (엄격하지 않게)
  return null
}

// ─── 프리뷰 생성 ────────────────────────────────────────────────────────────
export function buildPreview({ action, target, changes = {} }, data) {
  const schema = ACTION_SCHEMAS[action]
  if (!schema) return { label: action, rows: [] }

  const targetRow = target ? findTarget(action, target, data) : null
  const rows = []

  if (schema.op === 'create' || schema.op === 'schedule_list_add') {
    Object.entries(changes).forEach(([k, v]) => {
      rows.push({ label: k, before: '(없음)', after: fmtVal(v) })
    })
    return { label: schema.label, icon: schema.icon, dangerous: schema.dangerous, targetName: null, rows }
  }

  if (schema.op === 'bulk_create' || schema.op === 'schedule_list_bulk_add') {
    const items = Array.isArray(changes?.items) ? changes.items : []
    rows.push({ label: '추가 건수', before: '', after: `${items.length}건` })
    items.slice(0, 10).forEach((it, i) => {
      rows.push({ label: `${i+1}. ${it.name||''}`, before: '', after: summarizeObj(it, ['name']) })
    })
    if (items.length > 10) rows.push({ label: '...', before: '', after: `외 ${items.length - 10}건` })
    return { label: schema.label, icon: schema.icon, dangerous: schema.dangerous, targetName: null, rows }
  }

  if (schema.op === 'update' || schema.op === 'schedule_list_update' || schema.op === 'update_self') {
    if (!targetRow && schema.op !== 'update_self') {
      return { label: schema.label, icon: schema.icon, dangerous: schema.dangerous, error: `대상을 찾을 수 없습니다: ${target}` }
    }
    Object.entries(changes).forEach(([k, v]) => {
      const beforeVal = targetRow ? targetRow[k] : null
      rows.push({ label: k, before: fmtVal(beforeVal), after: fmtVal(v) })
    })
    return {
      label: schema.label, icon: schema.icon, dangerous: schema.dangerous,
      targetName: targetRow?.name || targetRow?.short || target,
      rows,
    }
  }

  if (schema.op === 'delete' || schema.op === 'schedule_list_delete' || schema.op === 'soft_delete') {
    if (!targetRow) {
      return { label: schema.label, icon: schema.icon, dangerous: schema.dangerous, error: `대상을 찾을 수 없습니다: ${target}` }
    }
    rows.push({ label: '삭제 대상', before: '', after: targetRow.name || targetRow.short || targetRow.id })
    if (schema.op === 'soft_delete') rows.push({ label: '참고', before: '', after: '숨김 처리 (데이터는 유지)' })
    return {
      label: schema.label, icon: schema.icon, dangerous: schema.dangerous,
      targetName: targetRow.name || targetRow.short,
      rows,
    }
  }

  if (schema.op === 'update_setting') {
    rows.push({ label: 'setting key', before: '', after: changes.key })
    rows.push({ label: 'value', before: '', after: JSON.stringify(changes.value).slice(0, 100) })
    return { label: schema.label, icon: schema.icon, rows }
  }

  if (schema.op === 'setup_initial') {
    const c = changes || {}
    rows.push({ label: '사업 기본정보', before: '', after: c.biz ? '✓' : '(건너뜀)' })
    rows.push({ label: '지점', before: '', after: `${(c.branches||[]).length}개` })
    rows.push({ label: '카테고리', before: '', after: `${(c.categories||[]).length}개` })
    rows.push({ label: '시술', before: '', after: `${(c.services||[]).length}개` })
    rows.push({ label: '직원', before: '', after: `${(c.staff||[]).length}명` })
    rows.push({ label: '예약 경로', before: '', after: `${(c.res_sources||[]).length}개` })
    return { label: schema.label, icon: schema.icon, rows }
  }

  return { label: schema.label, icon: schema.icon, rows }
}

function fmtVal(v) {
  if (v == null) return '(없음)'
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  if (typeof v === 'number') return v.toLocaleString()
  if (Array.isArray(v)) return v.slice(0, 3).join(', ') + (v.length > 3 ? ` 외 ${v.length - 3}개` : '')
  return String(v)
}
function summarizeObj(o, keys = []) {
  const k = keys[0] || 'name'
  const name = o[k] || o.name || '?'
  const extra = Object.entries(o).filter(([kk]) => kk !== k).map(([kk, v]) => `${kk}:${fmtVal(v)}`).slice(0, 3).join(', ')
  return `${name}${extra ? ` (${extra})` : ''}`
}

// ─── 실행 ──────────────────────────────────────────────────────────────────
export async function executeAction({ action, target, changes = {} }, data, { bizId, currentUser }) {
  const schema = ACTION_SCHEMAS[action]
  if (!schema) throw new Error(`알 수 없는 액션: ${action}`)

  const logBase = {
    at: new Date().toISOString(),
    user: currentUser?.name || currentUser?.id || 'unknown',
    action, target, changes,
  }

  try {
    let result

    // ─── Supabase 테이블 CRUD ───────────────────────────────────────────
    if (schema.op === 'create') {
      const payload = { ...cleanFields(changes, schema.fieldsAllowed), business_id: bizId }
      if (!payload.id) payload.id = genId(schema.table)
      result = await sb.insert(schema.table, payload)
      if (!result) throw new Error('insert 실패')
    }
    else if (schema.op === 'bulk_create') {
      const items = (changes.items || []).map(it => ({ ...cleanFields(it, schema.fieldsAllowed[0] === 'items' ? null : schema.fieldsAllowed), business_id: bizId, id: it.id || genId(schema.table) }))
      // 개별 insert (upsert 병합 옵션도 고려)
      result = { created: [] }
      for (const it of items) {
        const r = await sb.insert(schema.table, it)
        if (r) result.created.push(it)
      }
    }
    else if (schema.op === 'update') {
      const targetRow = findTarget(action, target, data)
      if (!targetRow) throw new Error(`대상을 찾을 수 없습니다: ${target}`)
      const payload = cleanFields(changes, schema.fieldsAllowed)
      result = await sb.update(schema.table, targetRow.id, payload)
    }
    else if (schema.op === 'delete') {
      const targetRow = findTarget(action, target, data)
      if (!targetRow) throw new Error(`대상을 찾을 수 없습니다: ${target}`)
      result = await sb.del(schema.table, targetRow.id)
    }
    else if (schema.op === 'soft_delete') {
      const targetRow = findTarget(action, target, data)
      if (!targetRow) throw new Error(`대상을 찾을 수 없습니다: ${target}`)
      result = await sb.update(schema.table, targetRow.id, { is_hidden: true })
    }
    else if (schema.op === 'update_self') {
      // 사업 기본정보 = businesses 테이블 현재 biz row
      if (!bizId) throw new Error('bizId 없음')
      const payload = cleanFields(changes, schema.fieldsAllowed)
      result = await sb.update(schema.table, bizId, payload)
    }
    else if (schema.op === 'update_setting') {
      // businesses.settings JSON 병합
      if (!bizId) throw new Error('bizId 없음')
      const biz = (data?.businesses || [])[0] || {}
      let settings = {}
      try {
        const raw = biz.settings
        settings = typeof raw === 'string' ? JSON.parse(raw) : (raw || {})
      } catch {}
      // changes.key 경로에 value 대입 (dot notation 지원)
      setDeepPath(settings, changes.key, changes.value)
      result = await sb.update('businesses', bizId, { settings: JSON.stringify(settings) })
    }

    // ─── schedule_data 기반 CRUD (직원 목록 등) ────────────────────────
    else if (schema.op === 'schedule_list_add' || schema.op === 'schedule_list_bulk_add' || schema.op === 'schedule_list_update' || schema.op === 'schedule_list_delete') {
      const key = schema.scheduleKey
      // 기존 로드
      const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.${key}&select=value`, {
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
      })
      const rows = await r.json()
      let list = []
      if (rows?.[0]?.value) {
        const v = rows[0].value
        list = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : [])
      }
      if (schema.op === 'schedule_list_add') {
        const newItem = { id: changes.id || genId('emp'), ...cleanFields(changes, schema.fieldsAllowed) }
        list.push(newItem)
      }
      else if (schema.op === 'schedule_list_bulk_add') {
        const items = (changes.items || []).map(it => ({ id: it.id || genId('emp'), ...cleanFields(it, null) }))
        list = [...list, ...items]
      }
      else if (schema.op === 'schedule_list_update') {
        const targetRow = findTarget(action, target, { ...data, _employees: list })
        if (!targetRow) throw new Error(`대상을 찾을 수 없습니다: ${target}`)
        list = list.map(x => x.id === targetRow.id ? { ...x, ...cleanFields(changes, schema.fieldsAllowed) } : x)
      }
      else if (schema.op === 'schedule_list_delete') {
        const targetRow = findTarget(action, target, { ...data, _employees: list })
        if (!targetRow) throw new Error(`대상을 찾을 수 없습니다: ${target}`)
        list = list.filter(x => x.id !== targetRow.id)
      }
      // 저장
      const w = await fetch(`${SB_URL}/rest/v1/schedule_data`, {
        method: 'POST',
        headers: {
          apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ id: key, key, value: JSON.stringify(list) }),
      })
      if (!w.ok) throw new Error(`schedule_data 저장 실패: ${w.status}`)
      result = { ok: true, count: list.length }
    }

    // ─── 초기 세팅 일괄 ────────────────────────────────────────────────
    else if (schema.op === 'setup_initial') {
      result = await runSetupInitial(changes, { bizId, data })
    }

    else {
      throw new Error(`미구현 op: ${schema.op}`)
    }

    await writeAuditLog({ ...logBase, ok: true, result: summarizeResult(result) })
    return { ok: true, result }
  } catch (e) {
    await writeAuditLog({ ...logBase, ok: false, error: String(e.message || e) })
    throw e
  }
}

// ─── helper ────────────────────────────────────────────────────────────────
function cleanFields(obj, allowedList) {
  if (!allowedList) return { ...obj }
  const out = {}
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (allowedList.includes(k)) out[k] = v
  })
  return out
}
function genId(prefix) {
  const p = (prefix || 'id').replace(/[^a-z_]/gi, '').slice(0, 8) || 'id'
  return `${p}_${Math.random().toString(36).slice(2, 11)}`
}
function setDeepPath(obj, path, value) {
  const parts = String(path).split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}
function summarizeResult(result) {
  if (!result) return null
  try {
    const s = JSON.stringify(result)
    return s.slice(0, 200)
  } catch { return '(object)' }
}

// ─── 감사 로그 ─────────────────────────────────────────────────────────────
async function writeAuditLog(entry) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.bliss_ai_action_logs_v1&select=value`, {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
    })
    const rows = await r.json()
    let list = []
    if (rows?.[0]?.value) {
      const v = rows[0].value
      list = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : [])
    }
    list.unshift(entry)
    if (list.length > 1000) list = list.slice(0, 1000)
    await fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: 'bliss_ai_action_logs_v1', key: 'bliss_ai_action_logs_v1', value: JSON.stringify(list) }),
    })
  } catch { /* ignore log failure */ }
}

// ─── 초기 세팅 일괄 실행 ──────────────────────────────────────────────────
async function runSetupInitial(changes, { bizId, data }) {
  const out = { biz: false, branches: 0, categories: 0, services: 0, staff: 0, res_sources: 0 }
  const c = changes || {}

  // 1. 사업 기본정보
  if (c.biz && bizId) {
    const allowed = ['name', 'address', 'phone', 'biz_type', 'email']
    const payload = {}
    Object.entries(c.biz).forEach(([k, v]) => { if (allowed.includes(k)) payload[k] = v })
    if (Object.keys(payload).length) {
      await sb.update('businesses', bizId, payload).catch(() => {})
      out.biz = true
    }
  }
  // 2. 지점
  for (const b of (c.branches || [])) {
    const id = b.id || genId('br')
    await sb.insert('branches', { id, business_id: bizId, ...b }).catch(() => {})
    out.branches++
  }
  // 3. 카테고리
  for (const cat of (c.categories || [])) {
    const id = cat.id || genId('cat')
    await sb.insert('service_categories', { id, business_id: bizId, ...cat }).catch(() => {})
    out.categories++
  }
  // 4. 시술
  for (const s of (c.services || [])) {
    const id = s.id || genId('sv')
    await sb.insert('services', { id, business_id: bizId, ...s }).catch(() => {})
    out.services++
  }
  // 5. 직원 (schedule_data.employees_v1)
  if ((c.staff || []).length) {
    const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value`, {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
    })
    const rows = await r.json()
    let list = []
    if (rows?.[0]?.value) {
      const v = rows[0].value
      list = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : [])
    }
    for (const st of c.staff) {
      list.push({ id: st.id || genId('emp'), ...st })
      out.staff++
    }
    await fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: 'employees_v1', key: 'employees_v1', value: JSON.stringify(list) }),
    })
  }
  // 6. 예약 경로
  for (const r of (c.res_sources || [])) {
    const id = r.id || genId('src')
    await sb.insert('reservation_sources', { id, business_id: bizId, ...r }).catch(() => {})
    out.res_sources++
  }
  return out
}
