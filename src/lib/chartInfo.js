import { sb } from './sb'

// 📋 예약의 차트·동의서 발송/작성 상태 로더 — ReservationModal의 개별조회 로직과 동일.
//   여러 화면(예약목록·매출관리·타임라인 등)에서 ConsentModal/ConsentDocsViewer를 띄우기 위한 공통 빌더.
//   반환: { chart:{status,consent,tplIds,signedAt}, doc:{...}, chartPresetIds }  (status: 'none'|'sent'|'signed')
export async function loadChartInfo(reservationId, bizId) {
  const rid = reservationId
  if (!rid) return null
  // 템플릿 → 폴더/이름 맵 (차트 vs 동의서 분류용, 비활성 포함)
  const [tplRows, folderRows] = await Promise.all([
    sb.get('consent_templates', `&business_id=eq.${bizId}&select=id,name,folder_id,is_active`).catch(() => []),
    sb.get('template_folders', `&business_id=eq.${bizId}&select=id,name`).catch(() => []),
  ])
  const folderName = {}; (folderRows || []).forEach(f => { folderName[f.id] = f.name || '' })
  const tplFolder = {}, tplName = {}
  ;(tplRows || []).forEach(t => { tplFolder[t.id] = folderName[t.folder_id] || ''; tplName[t.id] = t.name || '' })
  // 차트(신규차트·체크리스트) vs 동의서 분류 — 폴더명 → 템플릿명 → ID패턴 3중
  const kindOf = (tplId, tName) => {
    const hay = (tplFolder[tplId] || '') + ' ' + (tName || tplName[tplId] || '')
    if (/차트|체크|chart|checklist/i.test(hay)) return 'chart'
    if (/condition|eyelash|consent_full|chart/i.test(String(tplId || ''))) return 'chart'
    return 'doc'
  }
  // 토큰(발송) + 작성결과
  const tokens = await sb.get('consent_tokens', `&prefill_data->>reservation_id=eq.${rid}&order=created_at.desc`).catch(() => [])
  let consents = await sb.get('customer_consents', `&form_data->>reservation_id=eq.${rid}&order=signed_at.desc`).catch(() => [])
  // form_data에 reservation_id 없는 구버전 차트 → 토큰 used_at ≈ 서명시각으로 매칭
  if ((!Array.isArray(consents) || consents.length === 0) && Array.isArray(tokens)) {
    const usedTok = tokens.find(t => t.used_at && t.customer_id)
    if (usedTok) {
      const byCust = await sb.get('customer_consents', `&customer_id=eq.${usedTok.customer_id}&order=signed_at.desc&limit=30`).catch(() => [])
      const u = new Date(usedTok.used_at).getTime()
      const matched = (byCust || []).filter(c => c.signed_at && Math.abs(new Date(c.signed_at).getTime() - u) < 10000)
      if (matched.length) consents = matched
    }
  }
  const _tokIds = (t) => (Array.isArray(t.template_ids) && t.template_ids.length ? t.template_ids : [t.template_id]).filter(Boolean)
  // 트랙별 집계: signed > sent > none
  const mk = (kind) => {
    const grpTokens = (tokens || []).filter(t => _tokIds(t).some(id => kindOf(id) === kind))
    const grpConsents = (consents || []).filter(c => kindOf(c.template_id, c.template_name) === kind)
    const consentDoc = grpConsents.length ? grpConsents[0] : null
    const lastTok = grpTokens.length ? grpTokens[0] : null
    const tplIds = lastTok ? _tokIds(lastTok).filter(id => kindOf(id) === kind) : []
    let status = 'none'
    if (consentDoc) status = 'signed'
    else if (grpTokens.length) status = 'sent'
    return { status, consent: consentDoc, tplIds, signedAt: consentDoc?.signed_at || null }
  }
  const chartPresetIds = (tplRows || []).filter(t => t.is_active !== false && kindOf(t.id, t.name) === 'chart').map(t => t.id)
  return { chart: mk('chart'), doc: mk('doc'), chartPresetIds }
}
