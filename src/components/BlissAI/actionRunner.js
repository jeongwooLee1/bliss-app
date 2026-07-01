/**
 * actionRunner.js — 블리스 AI 액션 실행 + 프리뷰 생성
 *
 * 흐름:
 *   1. validateAction(action, params, data) → 에러 메시지 or null
 *   2. buildPreview(action, params, data) → 유저에게 보여줄 변경 요약
 *   3. executeAction(action, params, data, context) → DB 실행 + 결과 반환
 */
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { ACTION_SCHEMAS, NOTI_KEY_LABELS, AI_CHANNEL_LABELS } from './actionSchemas'
import { saveFaqItem } from '../../lib/faqStore'
import { parseBookingWithAI, findCustomerForBooking } from '../../lib/aiBookParse'

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
    products: data?.products || [],
    service_tags: data?.serviceTags || [],
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

  if (schema.op === 'update_noti_config') {
    const branches = data?.branches || []
    const branch = targetRow || (branches.length === 1 ? branches[0] : null)
    if (!branch && target) {
      return { label: schema.label, icon: schema.icon, error: `지점을 찾을 수 없습니다: ${target}` }
    }
    const kLabel = NOTI_KEY_LABELS[changes.notiKey] || changes.notiKey || '(알림 종류 지정 필요)'
    rows.push({ label: '지점', before: '', after: branch?.name || branch?.short || '(어느 지점? — 지점명 필요)' })
    rows.push({ label: '알림 종류', before: '', after: kLabel })
    if (changes.on != null) rows.push({ label: '상태', before: '', after: changes.on ? '켜기 ✅' : '끄기 ⛔' })
    if (changes.sendTime) rows.push({ label: '발송 시각', before: '', after: changes.sendTime })
    if (changes.msgTpl) rows.push({ label: '문구', before: '(현재 문구)', after: changes.msgTpl })
    return { label: schema.label, icon: schema.icon, targetName: branch?.name || branch?.short, rows }
  }

  if (schema.op === 'toggle_ai_reply') {
    const chLabel = changes.channel ? (AI_CHANNEL_LABELS[changes.channel] || changes.channel) : '전체 채널'
    rows.push({ label: '대상', before: '', after: chLabel })
    rows.push({ label: '상태', before: '', after: changes.on ? '자동응대 켜기 ✅' : '자동응대 끄기 ⛔' })
    return { label: schema.label, icon: schema.icon, rows }
  }

  if (schema.op === 'add_faq') {
    rows.push({ label: '질문(Q)', before: '', after: changes.q || '(없음)' })
    rows.push({ label: '답변(A)', before: '', after: changes.a || '(없음)' })
    if (changes.category) rows.push({ label: '분류', before: '', after: changes.category })
    return { label: schema.label, icon: schema.icon, rows }
  }

  if (schema.op === 'toggle_stamp_program' || schema.op === 'toggle_events_master') {
    const settings = _readBizSettings(data)
    const cur = schema.op === 'toggle_stamp_program'
      ? !!(settings.stamp_program && settings.stamp_program.on)
      : (settings.events_master_enabled !== false)
    rows.push({ label: '현재', before: '', after: cur ? '켜짐 ✅' : '꺼짐 ⛔' })
    rows.push({ label: '변경', before: '', after: changes.on ? '켜기 ✅' : '끄기 ⛔' })
    return { label: schema.label, icon: schema.icon, rows }
  }

  if (schema.op === 'toggle_event') {
    const settings = _readBizSettings(data)
    const evts = Array.isArray(settings.events) ? settings.events : []
    const evt = evts.find(e => String(e.name || '').toLowerCase() === String(target || '').toLowerCase())
      || evts.find(e => String(e.name || '').toLowerCase().includes(String(target || '').toLowerCase()) && target)
    if (!evt) {
      const names = evts.map(e => e.name).filter(Boolean).slice(0, 8).join(', ')
      return { label: schema.label, icon: schema.icon, error: `이벤트를 찾을 수 없어요: ${target}${names ? `\n(등록된 이벤트: ${names})` : ''}` }
    }
    rows.push({ label: '이벤트', before: '', after: evt.name })
    rows.push({ label: '현재', before: '', after: (evt.enabled !== false) ? '켜짐 ✅' : '꺼짐 ⛔' })
    rows.push({ label: '변경', before: '', after: changes.on ? '켜기 ✅' : '끄기 ⛔' })
    return { label: schema.label, icon: schema.icon, targetName: evt.name, rows }
  }

  if (schema.op === 'cancel_reservation') {
    const matches = changes._matchedRes || []
    const ps = changes._parsed || {}
    if (matches.length === 0) {
      return { label: schema.label, icon: schema.icon, dangerous: true, error: '취소할 예약을 찾지 못했습니다' }
    }
    rows.push({ label: '검색 조건', before: '', after: `${ps.custName || ''} ${ps.custPhone || ''} ${ps.date || ''} ${ps.time || ''}`.trim() })
    matches.slice(0, 5).forEach((r, i) => {
      const branchName = (data?.branches || []).find(b => b.id === r.bid)?.short || ''
      rows.push({
        label: `예약 ${i + 1}`,
        before: '',
        after: `${branchName} · ${r.date || ''} ${r.time || ''} · ${r.custName || r.cust_name || ''} (${r.custPhone || r.cust_phone || ''}) · 상태:${r.status}`,
      })
    })
    if (matches.length > 5) rows.push({ label: '...', before: '', after: `외 ${matches.length - 5}건` })
    rows.push({ label: '실행', before: '', after: `위 ${matches.length}건을 status=cancelled로 변경` })
    return { label: schema.label, icon: schema.icon, dangerous: true, rows }
  }

  if (schema.op === 'create_reservation') {
    const ps = changes._parsed || {}
    const matchedCustId = changes._matchedCustId
    rows.push({ label: '날짜·시간', before: '', after: `${ps.date || '?'} ${ps.time || '?'}` })
    rows.push({ label: '고객', before: '', after: `${ps.custName || '?'}${ps.custPhone ? ' / ' + ps.custPhone : ''}${ps.custEmail ? ' / ' + ps.custEmail : ''}${matchedCustId ? ' (기존 고객 매칭)' : ' (신규 고객 자동 등록)'}` })
    if (ps.branch) rows.push({ label: '지점', before: '', after: ps.branch })
    // 시술명 매칭
    const svcNames = (ps.matchedServiceIds || []).map(id => {
      const s = (data?.services || []).find(x => x.id === id)
      return s ? s.name : id
    })
    if (svcNames.length) rows.push({ label: '시술', before: '', after: svcNames.join(', ') })
    if (ps.dur) rows.push({ label: '소요시간', before: '', after: `${ps.dur}분` })
    if (ps.memo) rows.push({ label: '메모', before: '', after: ps.memo })
    rows.push({ label: '상태', before: '', after: '예약중 (직원 미배정)' })
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
    else if (schema.op === 'update_noti_config') {
      // 알림톡/문자 설정 = branches.noti_config JSON.
      // ⚠️ DB에서 현재 config를 fresh 읽어 해당 notiKey만 merge (data.branches stale값 덮으면 다른 알림 전부 소실)
      if (!bizId) throw new Error('bizId 없음')
      const branches = data?.branches || []
      let branch = target ? findTarget(action, target, data) : null
      if (!branch && branches.length === 1) branch = branches[0]
      if (!branch) throw new Error(target ? `지점을 찾을 수 없어요: ${target}` : '어느 지점의 알림을 바꿀지 지점명을 알려주세요 (예: 강남점)')
      const key = changes.notiKey
      if (!key) throw new Error('알림 종류(notiKey)가 필요합니다')
      const r = await fetch(`${SB_URL}/rest/v1/branches?id=eq.${branch.id}&select=noti_config`, {
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
      })
      let cfg = {}
      try { const arr = await r.json(); const raw = arr?.[0]?.noti_config; cfg = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}) } catch {}
      const cur = cfg[key] || {}
      cfg[key] = {
        ...cur,
        ...(changes.on != null ? { on: !!changes.on } : {}),
        ...(changes.msgTpl ? { msgTpl: changes.msgTpl } : {}),
        ...(changes.sendTime ? { sendTime: changes.sendTime } : {}),
      }
      result = await sb.update('branches', branch.id, { noti_config: JSON.stringify(cfg) })
    }
    else if (schema.op === 'toggle_ai_reply') {
      // AI 자동응대 = businesses.settings.ai_auto_reply_channels JSON.
      // ⚠️ DB에서 현재 settings를 fresh 읽어 병합 (data.businesses stale값이 다른 설정 덮는 것 방지)
      if (!bizId) throw new Error('bizId 없음')
      const on = !!changes.on
      const r = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, {
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
      })
      let settings = {}
      try { const arr = await r.json(); const raw = arr?.[0]?.settings; settings = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}) } catch {}
      const chans = { ...(settings.ai_auto_reply_channels || {}) }
      const ch = changes.channel
      if (ch) {
        chans[ch] = on
      } else {
        // 채널 미지정 → 전체 채널 일괄
        for (const c of Object.keys(AI_CHANNEL_LABELS)) chans[c] = on
      }
      settings.ai_auto_reply_channels = chans
      settings.ai_auto_reply_enabled = Object.values(chans).some(v => v)
      result = await sb.update('businesses', bizId, { settings: JSON.stringify(settings) })
    }
    else if (schema.op === 'add_faq') {
      // AI 참고 FAQ = RAG 학습문서(document_chunks) 임베딩. faqStore 재사용(FAQ 편집기와 동일 경로)
      if (!bizId) throw new Error('bizId 없음')
      const q = (changes.q || '').trim(), a = (changes.a || '').trim()
      if (!q || !a) throw new Error('FAQ 질문·답변이 필요합니다')
      const gkey = (typeof window !== 'undefined' && window.__systemGeminiKey) || ''
      if (!gkey) throw new Error('AI 키가 없어 FAQ를 추가할 수 없어요 (관리자에게 문의)')
      const id = await saveFaqItem(bizId, { q, a, category: changes.category || '기타', core: false, active: true }, gkey)
      result = { id, q, a }
    }
    else if (schema.op === 'toggle_stamp_program' || schema.op === 'toggle_events_master' || schema.op === 'toggle_event') {
      // businesses.settings 토글 — DB에서 fresh 읽어 병합 (다른 설정 stale 덮어쓰기 방지)
      if (!bizId) throw new Error('bizId 없음')
      const on = !!changes.on
      const r = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, {
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
      })
      let settings = {}
      try { const arr = await r.json(); const raw = arr?.[0]?.settings; settings = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}) } catch {}
      if (schema.op === 'toggle_stamp_program') {
        settings.stamp_program = { ...(settings.stamp_program || {}), on }
      } else if (schema.op === 'toggle_events_master') {
        settings.events_master_enabled = on
      } else {
        // toggle_event — 이름으로 매칭해 enabled flip
        const evts = Array.isArray(settings.events) ? settings.events : []
        const t = String(target || '').toLowerCase()
        let idx = evts.findIndex(e => String(e.name || '').toLowerCase() === t)
        if (idx < 0 && t) idx = evts.findIndex(e => String(e.name || '').toLowerCase().includes(t))
        if (idx < 0) throw new Error(`이벤트를 찾을 수 없어요: ${target}`)
        evts[idx] = { ...evts[idx], enabled: on }
        settings.events = evts
      }
      result = await sb.update('businesses', bizId, { settings: JSON.stringify(settings) })
    }

    // ─── schedule_data 기반 CRUD (직원 목록 등) ────────────────────────
    else if (schema.op === 'schedule_list_add' || schema.op === 'schedule_list_bulk_add' || schema.op === 'schedule_list_update' || schema.op === 'schedule_list_delete') {
      const key = schema.scheduleKey
      // 기존 로드
      const r = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.${key}&select=value`, {
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
      const w = await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`, {
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

    // ─── 예약 생성 (자연어 파싱 → 고객 매칭/생성 → reservations INSERT) ───
    else if (schema.op === 'create_reservation') {
      result = await runCreateReservation(changes, { bizId, data })
    }

    // ─── 예약 취소 (검색된 예약 status='cancelled' 처리) ───────────────
    else if (schema.op === 'cancel_reservation') {
      const matches = changes._matchedRes || []
      if (matches.length === 0) throw new Error('취소할 예약 없음')
      const cancelled = []
      for (const r of matches) {
        try {
          await sb.update('reservations', r.id, { status: 'cancelled' })
          cancelled.push(r.id)
        } catch (e) { console.warn('[cancel_reservation] 실패:', r.id, e?.message) }
      }
      result = { ok: true, cancelled_count: cancelled.length, ids: cancelled }
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
// businesses.settings 파싱 (data.businesses[0].settings — 미리보기의 현재값 표시용)
function _readBizSettings(data) {
  const biz = (data?.businesses || [])[0] || {}
  try { const raw = biz.settings; return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}) } catch { return {} }
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
    const r = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.bliss_ai_action_logs_v1&select=value`, {
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
    await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ business_id: _activeBizId, id: 'bliss_ai_action_logs_v1', key: 'bliss_ai_action_logs_v1', value: JSON.stringify(list) }),
    })
  } catch { /* ignore log failure */ }
}

// ─── 예약 생성 실행 ────────────────────────────────────────────────────────
// 정책:
//   고객 매칭 = 연락처(phone/phone2) 또는 이메일이 일치하면 동일인 (이름만 같으면 X)
//   매칭 안 되면 신규 고객 자동 생성
//   직원/룸 미배정, status='reserved'
async function runCreateReservation(changes, { bizId, data }) {
  const ps = changes?._parsed || {}
  if (!ps.date || !ps.time) throw new Error('날짜·시간 정보 누락')
  if (!ps.custName && !ps.custPhone && !ps.custEmail) throw new Error('고객 정보 누락 (이름/연락처/이메일 중 하나는 필수)')

  // 1) 지점 매칭 (등록된 지점에서 짧은이름/이름 부분일치) — fallback 금지, 명시적 지정 필수
  const branches = data?.branches || []
  const branchKey = String(ps.branch || '').replace(/\s+/g, '').replace(/점$/, '')
  if (!branchKey) {
    const list = branches.map(b => b.short || b.name).filter(Boolean).join(' / ')
    throw new Error(`지점이 지정되지 않았습니다. 다음 중 하나를 알려주세요: ${list}`)
  }
  const matchedBranch = branches.find(b => {
    const s = String(b.short || '').replace(/\s+/g, '').replace(/점$/, '')
    const n = String(b.name || '').replace(/\s+/g, '').replace(/점$/, '')
    return s === branchKey || n === branchKey || s.includes(branchKey) || branchKey.includes(s) || n.includes(branchKey) || branchKey.includes(n)
  })
  if (!matchedBranch) {
    const list = branches.map(b => b.short || b.name).filter(Boolean).join(' / ')
    throw new Error(`"${ps.branch}"와 일치하는 지점을 찾지 못했습니다. 등록된 지점: ${list}`)
  }
  const branchId = matchedBranch.id

  // 2) 고객 매칭 — 정확 일치 + 부분 일치 (공통 함수)
  let custId = null
  let isNewCust = false
  // _matchedCustId가 preview 단계에서 이미 채워져 있으면 그대로 사용
  if (changes._matchedCustId) {
    custId = changes._matchedCustId
  } else {
    const { custId: matched } = await findCustomerForBooking(ps, bizId, changes.input)
    if (matched) custId = matched
  }
  if (!custId) {
    // 신규 고객 생성
    const newCustId = genId('cust')
    const newCust = {
      id: newCustId,
      business_id: bizId,
      bid: branchId,
      name: ps.custName || '',
      phone: ps.custPhone || '',
      email: ps.custEmail || '',
      gender: ps.custGender || '',
      sms_consent: true,
      created_at: new Date().toISOString(),
      join_date: ps.date, // 첫 예약일 = 가입일로 일단
    }
    try {
      await sb.insert('customers', newCust)
      custId = newCustId
      isNewCust = true
    } catch (e) {
      // 고객 생성 실패해도 예약은 진행 (cust_id 없이)
      console.warn('[create_reservation] 고객 생성 실패:', e?.message)
    }
  }

  // 3) 시술시간 합산 (없으면 dur fallback, 그것도 없으면 60)
  const services = data?.services || []
  const matchedSvcIds = ps.matchedServiceIds || []
  const svcDurSum = matchedSvcIds.reduce((sum, id) => {
    const s = services.find(x => x.id === id)
    return sum + (Number(s?.dur) || 0)
  }, 0)
  const dur = svcDurSum > 0 ? svcDurSum : (Number(ps.dur) || 60)

  // 4) 종료 시간 계산
  const [hh, mm] = String(ps.time).split(':').map(Number)
  const endMin = hh * 60 + mm + dur
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`

  // 5) reservations INSERT
  const resId = genId('res')
  // reservation_id는 NULLS NOT DISTINCT unique constraint — 반드시 고유값 필요
  const reservationId = `aibook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const payload = {
    id: resId,
    business_id: bizId,
    bid: branchId,
    room_id: '', // 미배정
    staff_id: '', // 미배정
    cust_id: custId || null,
    cust_name: ps.custName || '',
    cust_phone: ps.custPhone || '',
    cust_email: ps.custEmail || '',
    cust_gender: ps.custGender || '',
    date: ps.date,
    time: ps.time,
    end_time: endTime,
    dur,
    selected_tags: JSON.stringify(ps.matchedTagIds || []),
    selected_services: JSON.stringify(matchedSvcIds),
    status: 'reserved',
    type: 'reservation',
    is_schedule: false,
    is_new_cust: isNewCust,
    source: ps.source || 'AI 예약',
    memo: ps.memo || '',
    reservation_id: reservationId,
    external_prepaid: Number(ps.externalPrepaid) || 0,
    external_platform: ps.externalPlatform || '',
  }
  await sb.insert('reservations', payload)
  return {
    ok: true,
    reservation_id: resId,
    cust_id: custId,
    is_new_cust: isNewCust,
    branch_id: branchId,
  }
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
    const r = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.employees_v1&select=value`, {
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
    await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ business_id: _activeBizId, id: 'employees_v1', key: 'employees_v1', value: JSON.stringify(list) }),
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
