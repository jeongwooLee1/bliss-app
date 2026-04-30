import React, { useState, useMemo, useEffect } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'

/**
 * 직원이 고객에게 직접 SMS를 발송하는 공통 모달.
 *
 * Props:
 *  - open       : boolean
 *  - onClose    : () => void
 *  - customers  : [{id,name,phone,smsConsent,bid,...}] 발송 대상 (필수)
 *  - branches   : [{id,name,short,smsCallback,phone}] 전 지점 (필수)
 *  - userBranches : 권한 있는 지점 ID 배열 (없으면 전체)
 *  - defaultBranchId : 기본 발신 지점
 *  - selfPhone  : 테스트 발송 폰 (관리자 본인 010..., 없으면 prompt)
 *
 * 발송 흐름:
 *  1) sms_consent === false 자동 제외 (UI에 표시)
 *  2) send-sms Edge Function 호출 (100건/배치)
 *  3) Edge Function이 sms_send_log에 자동 기록 + sms_consent 재차단
 */
export default function SendSmsModal({ open, onClose, customers = [], branches = [], userBranches = [], defaultBranchId, selfPhone, bizId = 'biz_khvurgshb' }) {
  const [branchId, setBranchId] = useState(defaultBranchId || '')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(null) // {sent, total, ok, fail}
  const [templates, setTemplates] = useState([]) // [{id,label,content}]
  const [tplLoading, setTplLoading] = useState(false)
  const [tplManageOpen, setTplManageOpen] = useState(false)
  const [editingTplId, setEditingTplId] = useState(null) // null|new|<id>
  const [tplDraft, setTplDraft] = useState({ label:'', content:'' })
  const [manualText, setManualText] = useState('') // 직접 입력 수신자 (한 줄당 1명)

  // 발신 지점 후보: 권한 있는 지점만 (sms_callback 등록된 지점만)
  const branchOptions = useMemo(() => {
    const allowed = (userBranches && userBranches.length) ? new Set(userBranches) : null
    return (branches || []).filter(b => (b.smsCallback || b.sms_callback) && (!allowed || allowed.has(b.id)))
  }, [branches, userBranches])
  const cb = (b) => b?.smsCallback || b?.sms_callback || ''

  useEffect(() => {
    if (!branchId && branchOptions[0]) setBranchId(branchOptions[0].id)
  }, [branchOptions, branchId])

  // 템플릿 로드
  const loadTemplates = async () => {
    setTplLoading(true)
    try {
      const r = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
      const rows = await r.json()
      const raw = rows?.[0]?.settings
      const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
      setTemplates(Array.isArray(parsed.sms_templates) ? parsed.sms_templates : [])
    } catch (e) { console.error('[SendSmsModal] templates load:', e) }
    finally { setTplLoading(false) }
  }
  useEffect(() => { if (open) loadTemplates() }, [open])

  const persistTemplates = async (next) => {
    // settings 전체 read → sms_templates만 교체 → write (스프레드 사고 방지)
    const r = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
    const rows = await r.json()
    const raw = rows?.[0]?.settings
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
    parsed.sms_templates = next
    const w = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ settings: JSON.stringify(parsed) }),
    })
    if (!w.ok) throw new Error('템플릿 저장 실패: ' + w.status)
    setTemplates(next)
  }

  const applyTemplate = (tpl) => {
    if (!tpl) return
    if (message.trim() && !confirm('현재 메시지를 템플릿으로 덮어쓸까요?')) return
    setMessage(tpl.content || '')
  }
  const startNewTpl = () => { setEditingTplId('new'); setTplDraft({ label:'', content: message || '' }) }
  const startEditTpl = (tpl) => { setEditingTplId(tpl.id); setTplDraft({ label: tpl.label, content: tpl.content }) }
  const cancelTplEdit = () => { setEditingTplId(null); setTplDraft({ label:'', content:'' }) }
  const saveTpl = async () => {
    if (!tplDraft.label.trim() || !tplDraft.content.trim()) { alert('이름과 내용을 입력하세요'); return }
    let next
    if (editingTplId === 'new') {
      const id = 'tpl_' + Math.random().toString(36).slice(2, 10)
      next = [...templates, { id, label: tplDraft.label.trim(), content: tplDraft.content }]
    } else {
      next = templates.map(t => t.id === editingTplId ? { ...t, label: tplDraft.label.trim(), content: tplDraft.content } : t)
    }
    try { await persistTemplates(next); cancelTplEdit() }
    catch (e) { alert(e.message) }
  }
  const deleteTpl = async (tpl) => {
    if (!confirm(`"${tpl.label}" 템플릿을 삭제할까요?`)) return
    try { await persistTemplates(templates.filter(t => t.id !== tpl.id)) }
    catch (e) { alert(e.message) }
  }

  // ESC 닫기
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, sending])

  // 직접 입력 수신자 파싱 — "이름 010..." 또는 번호만
  const manualParsed = useMemo(() => {
    const lines = (manualText || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    const out = []
    lines.forEach((line, i) => {
      const m = line.match(/(\D*?)\s*(0\d[\d\-\s]{8,12})\s*$/)
      const ph = m ? m[2].replace(/[^0-9]/g, '') : line.replace(/[^0-9]/g, '')
      const name = m ? (m[1] || '').trim() : ''
      const isMobile = /^01[0-9]/.test(ph) && ph.length >= 10 && ph.length <= 11
      if (isMobile) out.push({ id: `_manual_${i}_${ph}`, name: name || `수동${i+1}`, phone: ph, _ph: ph, _manual: true })
    })
    return out
  }, [manualText])

  // 010~019 휴대폰 + sms_consent 분류 (customers + manual 합쳐서)
  const partition = useMemo(() => {
    const valid = []
    const blocked = []
    const invalidPhone = []
    customers.forEach(c => {
      const ph = (c.phone || '').replace(/[^0-9]/g, '')
      const isMobile = /^01[0-9]/.test(ph) && ph.length >= 10 && ph.length <= 11
      if (!isMobile) { invalidPhone.push(c); return }
      if (c.smsConsent === false || c.sms_consent === false) { blocked.push(c); return }
      valid.push({ ...c, _ph: ph })
    })
    // 수동 입력 수신자 — 중복 phone 제외
    const phoneSet = new Set(valid.map(v => v._ph))
    manualParsed.forEach(m => { if (!phoneSet.has(m._ph)) { phoneSet.add(m._ph); valid.push(m) } })
    return { valid, blocked, invalidPhone }
  }, [customers, manualParsed])

  const branch = useMemo(() => branches.find(b => b.id === branchId) || {}, [branches, branchId])

  // 변수 치환 (미리보기용)
  const buildCustomFields = (c) => ({
    고객명: c.name || '',
    매장명: branch.name || '',
    지점명: branch.short || branch.name || '',
    대표전화번호: branch.phone || '',
  })
  const renderTemplate = (tpl, fields) => {
    let out = tpl || ''
    for (const [k, v] of Object.entries(fields || {})) {
      out = out.split(`#{${k}}`).join(v == null ? '' : String(v))
    }
    return out
  }

  // 바이트 카운터
  const byteLen = (s) => { let b = 0; for (const ch of String(s || '')) b += ch.charCodeAt(0) > 127 ? 2 : 1; return b }
  const previewMsg = useMemo(() => {
    const c = partition.valid[0] || partition.blocked[0] || partition.invalidPhone[0]
    if (!c) return message
    return renderTemplate(message, buildCustomFields(c))
  }, [message, partition, branch])
  const mb = byteLen(previewMsg)
  const msgType = mb <= 90 ? 'SMS' : mb <= 2000 ? 'LMS' : 'OVER'

  const insertVar = (k) => setMessage(prev => prev + `#{${k}}`)

  const callEdge = async (receivers, msgOverride) => {
    const r = await fetch(`${SB_URL}/functions/v1/send-sms`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branchId, message: msgOverride || message, receivers }),
    })
    let body = null
    try { body = await r.json() } catch { body = { _raw: 'parse fail' } }
    return { ok: r.ok, status: r.status, body }
  }
  // UMS 응답 — code='100'(성공) + data[].msgKey가 발급되어야 실제 발송
  const isAck = (b) => {
    if (!b || typeof b !== 'object') return false
    const code = String(b.code || '')
    if (code !== '100' && code !== '200' && b.ok !== true) return false
    const list = Array.isArray(b.data) ? b.data : (Array.isArray(b.data?.resultList) ? b.data.resultList : [])
    if (list.length === 0 && b.ok === true) return true
    return list.length > 0 && list.every(d => d?.msgKey)
  }

  const handleSend = async () => {
    if (!branchId) { alert('발신 지점을 선택해주세요'); return }
    if (!message.trim()) { alert('메시지를 입력해주세요'); return }
    if (mb > 2000) { alert('LMS 한도 2,000byte 초과'); return }
    if (partition.valid.length === 0) { alert('발송 가능한 수신자가 없습니다'); return }
    if (!confirm(`${partition.valid.length}명에게 SMS 발송할까요?\n(수신거부 ${partition.blocked.length}명, 휴대폰 아님 ${partition.invalidPhone.length}명 제외)`)) return

    setSending(true)
    setProgress({ sent: 0, total: partition.valid.length, ok: 0, fail: 0 })

    try {
      let ok = 0, fail = 0
      const hasVar = /#\{[^}]+\}/.test(message)
      if (!hasVar) {
        // 변수 없음 → 100명/배치 단일 메시지 발송
        const BATCH = 100
        for (let i = 0; i < partition.valid.length; i += BATCH) {
          const slice = partition.valid.slice(i, i + BATCH)
          const receivers = slice.map(c => ({ phone: c._ph, userKey: c.id || c._ph }))
          const res = await callEdge(receivers)
          if (res.ok && isAck(res.body)) ok += slice.length
          else { fail += slice.length; console.warn('[send-sms] batch fail', res) }
          setProgress({ sent: i + slice.length, total: partition.valid.length, ok, fail })
        }
      } else {
        // 변수 사용 → 1명씩 치환 + 호출 (UMS는 변수 치환 미지원)
        for (let i = 0; i < partition.valid.length; i++) {
          const c = partition.valid[i]
          const personalMsg = renderTemplate(message, buildCustomFields(c))
          const receivers = [{ phone: c._ph, userKey: c.id || c._ph }]
          const res = await callEdge(receivers, personalMsg)
          if (res.ok && isAck(res.body)) ok++
          else { fail++; console.warn('[send-sms] one fail', c._ph, res) }
          setProgress({ sent: i + 1, total: partition.valid.length, ok, fail })
        }
      }
      alert(`발송 완료\n성공: ${ok}건\n실패: ${fail}건`)
      onClose?.()
    } catch (e) {
      alert('발송 실패: ' + (e?.message || e))
    } finally {
      setSending(false)
    }
  }

  const handleTest = async () => {
    if (!branchId) { alert('발신 지점을 선택해주세요'); return }
    if (!message.trim()) { alert('메시지를 입력해주세요'); return }
    let phone = selfPhone || prompt('테스트 발송 받을 본인 휴대폰 (예: 01012345678)', '')
    if (!phone) return
    phone = String(phone).replace(/[^0-9]/g, '')
    if (!/^01[0-9]/.test(phone) || phone.length < 10 || phone.length > 11) { alert('휴대폰 번호 형식 오류'); return }
    const sample = partition.valid[0] || partition.blocked[0] || customers[0] || { name: '테스트', id: 'test' }
    const personalMsg = renderTemplate(message, buildCustomFields(sample))
    const receivers = [{ phone, userKey: 'test_' + Date.now() }]
    setSending(true)
    try {
      const res = await callEdge(receivers, personalMsg)
      if (res.ok && isAck(res.body)) alert('테스트 발송 완료 — 폰 확인하세요')
      else alert('테스트 발송 실패: ' + JSON.stringify(res.body).slice(0, 200))
    } finally { setSending(false) }
  }

  if (!open) return null

  const total = customers.length + manualParsed.length
  return (
    <div onClick={() => !sending && onClose?.()} style={{position:'fixed',inset:0,zIndex:9000,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:14,maxWidth:560,width:'100%',maxHeight:'90vh',overflowY:'auto',padding:20,fontFamily:'inherit'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <div style={{fontSize:18,fontWeight:800}}>📱 문자 발송 ({total}명{customers.length>0&&manualParsed.length>0?` · ${customers.length}+${manualParsed.length}`:''})</div>
          <button onClick={()=>!sending && onClose?.()} style={{background:'none',border:'none',cursor:'pointer',fontSize:22,color:'#999',padding:0,lineHeight:1}}>×</button>
        </div>

        {/* 발신 지점 */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:4,color:T.gray600}}>
            발신 지점 (sms_callback) {branchOptions.length===0 && <span style={{color:T.danger,fontWeight:600}}>· 권한 있는 지점 없음</span>}
          </div>
          <select value={branchId} onChange={e=>setBranchId(e.target.value)} disabled={sending}
            style={{width:'100%',padding:'8px 10px',border:'1px solid '+T.border,borderRadius:8,fontSize:13,fontFamily:'inherit'}}>
            <option value="">선택</option>
            {branchOptions.map(b => <option key={b.id} value={b.id}>{b.short || b.name} · {cb(b)}</option>)}
          </select>
        </div>

        {/* 📋 템플릿 */}
        <div style={{marginBottom:12,padding:'10px 12px',background:'#F0F9FF',border:'1px solid #BAE6FD',borderRadius:8}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:tplManageOpen?8:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',flex:1}}>
              <span style={{fontSize:12,fontWeight:700,color:'#0369A1'}}>📋 템플릿</span>
              {tplLoading ? <span style={{fontSize:11,color:T.gray500}}>로드중...</span>
              : templates.length===0 ? <span style={{fontSize:11,color:T.gray500}}>저장된 템플릿 없음</span>
              : <select onChange={e=>{const t=templates.find(x=>x.id===e.target.value); if(t) applyTemplate(t); e.target.value='';}} disabled={sending}
                  style={{padding:'4px 8px',fontSize:12,border:'1px solid '+T.border,borderRadius:6,fontFamily:'inherit',maxWidth:280}}>
                  <option value="">— 템플릿 적용 —</option>
                  {templates.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
                </select>}
            </div>
            <button onClick={()=>setTplManageOpen(v=>!v)} disabled={sending}
              style={{padding:'4px 10px',fontSize:11,border:'1px solid #0EA5E9',background:tplManageOpen?'#0EA5E9':'#fff',color:tplManageOpen?'#fff':'#0369A1',borderRadius:6,cursor:'pointer',fontFamily:'inherit',fontWeight:600,whiteSpace:'nowrap'}}>
              {tplManageOpen?'닫기':'관리'}
            </button>
          </div>
          {tplManageOpen && (
            <div style={{marginTop:6}}>
              {editingTplId ? (
                <div style={{padding:8,background:'#fff',borderRadius:6,border:'1px solid '+T.border}}>
                  <input value={tplDraft.label} onChange={e=>setTplDraft(d=>({...d,label:e.target.value}))}
                    placeholder="템플릿 이름 (예: 예약 도착 확인)"
                    style={{width:'100%',padding:'5px 8px',fontSize:12,border:'1px solid '+T.border,borderRadius:4,marginBottom:4,fontFamily:'inherit',boxSizing:'border-box'}}/>
                  <textarea value={tplDraft.content} onChange={e=>setTplDraft(d=>({...d,content:e.target.value}))}
                    placeholder="템플릿 본문 (#{고객명} 등 변수 사용 가능)"
                    style={{width:'100%',minHeight:60,padding:'5px 8px',fontSize:12,border:'1px solid '+T.border,borderRadius:4,fontFamily:'inherit',boxSizing:'border-box',resize:'vertical'}}/>
                  <div style={{display:'flex',gap:6,marginTop:6,justifyContent:'flex-end'}}>
                    <button onClick={cancelTplEdit} style={{padding:'4px 10px',fontSize:11,border:'1px solid '+T.border,background:'#fff',borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
                    <button onClick={saveTpl} style={{padding:'4px 10px',fontSize:11,border:'none',background:'#0EA5E9',color:'#fff',borderRadius:5,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>저장</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    {templates.map(t => (
                      <div key={t.id} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 6px',background:'#fff',borderRadius:5,border:'1px solid '+T.border}}>
                        <span style={{flex:1,fontSize:12,fontWeight:600,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.label}</span>
                        <button onClick={()=>applyTemplate(t)} title="이 템플릿 적용" style={{padding:'2px 6px',fontSize:10,border:'1px solid #0EA5E9',background:'#fff',color:'#0369A1',borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>적용</button>
                        <button onClick={()=>startEditTpl(t)} title="편집" style={{padding:'2px 6px',fontSize:10,border:'1px solid '+T.border,background:'#fff',borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>✏️</button>
                        <button onClick={()=>deleteTpl(t)} title="삭제" style={{padding:'2px 6px',fontSize:10,border:'1px solid #fecaca',background:'#fff',color:'#dc2626',borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>🗑️</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={startNewTpl} style={{marginTop:6,padding:'5px 10px',fontSize:11,border:'1px dashed #0EA5E9',background:'#fff',color:'#0369A1',borderRadius:5,cursor:'pointer',fontFamily:'inherit',fontWeight:600,width:'100%'}}>
                    ➕ 현재 메시지를 템플릿으로 저장 / 새 템플릿 추가
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* 수신자 요약 */}
        <div style={{marginBottom:12,padding:'10px 12px',background:T.gray100,borderRadius:8,fontSize:12,lineHeight:1.6}}>
          <div>✅ 발송 가능: <b style={{color:T.success}}>{partition.valid.length}명</b>
            {manualParsed.length>0 && <span style={{color:T.gray500,marginLeft:6}}>(직접입력 {manualParsed.length}명 포함)</span>}
          </div>
          {partition.blocked.length>0 && <div>🚫 수신거부 자동 제외: <b style={{color:'#dc2626'}}>{partition.blocked.length}명</b></div>}
          {partition.invalidPhone.length>0 && <div>📵 휴대폰 번호 아님 제외: <b style={{color:T.gray500}}>{partition.invalidPhone.length}명</b></div>}
        </div>

        {/* ✏️ 직접 번호 입력 (등록 안 된 고객) */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:4,color:T.gray600,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span>✏️ 직접 번호 입력 (등록 안 된 번호도 가능)</span>
            {manualParsed.length>0 && <span style={{fontSize:11,color:T.success,fontWeight:600}}>{manualParsed.length}명 인식</span>}
          </div>
          <textarea value={manualText} onChange={e=>setManualText(e.target.value)} disabled={sending}
            placeholder={'한 줄에 한 명씩 — "이름 010-1234-5678" 또는 번호만\n예시:\n김철수 01012345678\n01087654321'}
            style={{width:'100%',minHeight:60,padding:'8px 10px',border:'1px solid '+T.border,borderRadius:6,fontSize:12,resize:'vertical',fontFamily:'inherit',outline:'none',boxSizing:'border-box',lineHeight:1.5}}/>
        </div>

        {/* 변수 헬퍼 — 수신자가 있을 때만 의미있음 */}
        <div style={{marginBottom:6}}>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:3}}>
            <span style={{fontSize:11,color:T.gray500}}>변수 삽입:</span>
            {['고객명','매장명','지점명','대표전화번호'].map(k => (
              <button key={k} onClick={()=>insertVar(k)} disabled={sending||partition.valid.length===0}
                style={{padding:'3px 8px',fontSize:11,border:'1px solid '+T.border,borderRadius:6,background:'#fff',cursor:partition.valid.length===0?'not-allowed':'pointer',fontFamily:'inherit',color:partition.valid.length===0?T.gray400:T.primary,fontWeight:600,opacity:partition.valid.length===0?0.5:1}}>#{k}</button>
            ))}
          </div>
          <div style={{fontSize:10,color:T.gray500,lineHeight:1.4}}>
            {partition.valid.length===0
              ? '⚠ 수신자(고객 선택 또는 직접 번호 입력)가 있어야 변수가 자동 치환됩니다.'
              : <>변수는 수신자별로 자동 치환됩니다 — <b>#{'{고객명}'}</b> → 등록 고객은 DB 이름, 직접 입력은 "{'이름 010-...'}"의 이름 부분 (이름 없으면 "수동N"). <b>#{'{매장명}'}/#{'{지점명}'}/#{'{대표전화번호}'}</b>는 위 발신 지점 정보로 치환.</>}
          </div>
        </div>

        {/* 메시지 */}
        <textarea value={message} onChange={e=>setMessage(e.target.value)} disabled={sending}
          placeholder="예시: [하우스왁싱] #{고객명}님 안녕하세요~ #{매장명}에서 안내드립니다."
          style={{width:'100%',minHeight:120,padding:'10px 12px',border:'1px solid '+T.border,borderRadius:8,fontSize:13,resize:'vertical',fontFamily:'inherit',outline:'none',boxSizing:'border-box',lineHeight:1.5}} />

        {/* 바이트 카운터 */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6,marginBottom:12}}>
          <span style={{fontSize:11,color:mb>2000?T.danger:mb>90?T.warning:T.gray500,fontWeight:600}}>
            {mb} byte · {msgType}{msgType==='OVER'?' (한도 초과)':''}
          </span>
          <span style={{fontSize:11,color:T.gray500}}>SMS 90byte 이하 / LMS 90~2000byte</span>
        </div>

        {/* 미리보기 */}
        {previewMsg && partition.valid[0] && (
          <div style={{marginBottom:14,padding:'10px 12px',background:'#FEF3C7',borderRadius:8,fontSize:12,lineHeight:1.5}}>
            <div style={{fontSize:11,fontWeight:700,color:'#92400E',marginBottom:4}}>👤 {partition.valid[0].name}님 미리보기</div>
            <div style={{whiteSpace:'pre-wrap'}}>{previewMsg}</div>
          </div>
        )}

        {/* 진행률 */}
        {progress && (
          <div style={{marginBottom:12,padding:'8px 10px',background:'#EFF6FF',borderRadius:8,fontSize:12}}>
            진행: {progress.sent}/{progress.total} (성공 {progress.ok} / 실패 {progress.fail})
          </div>
        )}

        {/* 액션 */}
        <div style={{display:'flex',gap:8}}>
          <button onClick={handleTest} disabled={sending} style={{padding:'10px 14px',border:'1px solid '+T.primary,background:'#fff',color:T.primary,borderRadius:8,fontWeight:700,fontSize:13,cursor:sending?'not-allowed':'pointer',opacity:sending?0.5:1,fontFamily:'inherit'}}>
            🧪 테스트 1건
          </button>
          <button onClick={handleSend} disabled={sending||partition.valid.length===0||!message.trim()||mb>2000}
            style={{flex:1,padding:'10px 14px',border:'none',background:sending?T.gray400:T.primary,color:'#fff',borderRadius:8,fontWeight:800,fontSize:14,cursor:sending?'wait':'pointer',fontFamily:'inherit'}}>
            {sending ? `⏳ 발송 중...` : `📤 ${partition.valid.length}명에게 발송`}
          </button>
        </div>
      </div>
    </div>
  )
}
