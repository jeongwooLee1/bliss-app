import React, { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { APageHeader, AField, AInp, AIBtn } from './AdminUI'
import I from '../common/I'

// 매장별 포트원(PortOne) V2 결제 설정
// branches.payment_settings.portone = { store_id, channel_key, api_secret, is_test }
// 매장은 포트원에 가입(가입비/연회비 무료) 후 KG이니시스·나이스페이·토스 등 PG 자유 연결
function AdminPaymentSettings({ data, setData, userBranches = [], isMaster = false }) {
  const branches = useMemo(() => (data?.branches || []).filter(b => !userBranches.length || userBranches.includes(b.id)), [data?.branches, userBranches])
  const [activeBid, setActiveBid] = useState(branches[0]?.id || '')
  const activeBranch = useMemo(() => branches.find(b => b.id === activeBid) || null, [branches, activeBid])

  const initial = useMemo(() => {
    const ps = activeBranch?.payment_settings
    const obj = typeof ps === 'string' ? (() => { try { return JSON.parse(ps) } catch { return {} } })() : (ps || {})
    return obj.portone || {}
  }, [activeBranch])

  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  React.useEffect(() => { setForm(initial); setMsg('') }, [initial])

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!activeBid) return
    setSaving(true); setMsg('')
    try {
      const cur = activeBranch?.payment_settings
      const obj = typeof cur === 'string' ? (() => { try { return JSON.parse(cur) } catch { return {} } })() : (cur || {})
      const next = { ...obj, portone: {
        store_id: (form.store_id || '').trim(),
        channel_key: (form.channel_key || '').trim(),
        api_secret: (form.api_secret || '').trim(),
        is_test: !!form.is_test,
      } }
      await sb.update('branches', activeBid, { payment_settings: next })
      if (setData) {
        setData(prev => ({ ...prev, branches: (prev?.branches || []).map(b => b.id === activeBid ? { ...b, payment_settings: next } : b) }))
      }
      setMsg('✓ 저장됨')
    } catch (e) {
      setMsg('저장 실패: ' + (e?.message || e))
    }
    setSaving(false)
  }

  const remove = async () => {
    if (!activeBid) return
    if (!confirm('이 매장의 포트원 키를 삭제할까요? 결제 링크 발급이 중단됩니다.')) return
    setSaving(true); setMsg('')
    try {
      const cur = activeBranch?.payment_settings
      const obj = typeof cur === 'string' ? (() => { try { return JSON.parse(cur) } catch { return {} } })() : (cur || {})
      const next = { ...obj }; delete next.portone; delete next.tosspayments
      await sb.update('branches', activeBid, { payment_settings: next })
      if (setData) {
        setData(prev => ({ ...prev, branches: (prev?.branches || []).map(b => b.id === activeBid ? { ...b, payment_settings: next } : b) }))
      }
      setForm({})
      setMsg('✓ 삭제됨')
    } catch (e) { setMsg('삭제 실패: ' + (e?.message || e)) }
    setSaving(false)
  }

  const hasKey = !!(form.store_id && form.channel_key && form.api_secret)
  const hasStored = !!(initial.store_id && initial.channel_key)

  return <div>
    <APageHeader title="💳 결제 설정 (포트원)" desc="매장별 포트원(PortOne) 키를 등록합니다. 가입비·연회비 0원, KG이니시스·나이스페이·토스·카카오페이 등 PG 자유 연결." />

    {/* 매장 선택 탭 */}
    {branches.length > 1 && (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {branches.map(b => (
          <button key={b.id} onClick={() => setActiveBid(b.id)} style={{
            padding: '7px 14px', borderRadius: 999,
            border: `1.5px solid ${activeBid === b.id ? T.primary : T.border}`,
            background: activeBid === b.id ? (T.primaryLt || '#ede9ff') : '#fff',
            color: activeBid === b.id ? T.primary : T.textSub,
            fontSize: T.fs.xs, fontWeight: activeBid === b.id ? 700 : 500,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>
            {b.short || b.name || b.id}
            {(typeof b.payment_settings === 'string' ? (() => { try { return JSON.parse(b.payment_settings) } catch { return {} } })() : b.payment_settings || {})?.portone?.store_id ? ' ✓' : ''}
          </button>
        ))}
      </div>
    )}

    {!activeBranch ? <div style={{ padding: 32, textAlign: 'center', color: T.textMuted }}>매장을 선택하세요</div> : (
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <I name="building" size={14} style={{ color: T.primary }} />
          {activeBranch.name || activeBranch.short}
          {hasStored && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: T.success, background: '#f0faf4', padding: '3px 10px', borderRadius: 999 }}>등록됨</span>}
        </div>

        <div style={{ background: '#f9fafb', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: T.textSub, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 4 }}>📌 가입 안내</div>
          <div>1. <a href="https://portone.io" target="_blank" rel="noopener" style={{ color: T.primary, textDecoration: 'underline' }}>포트원 가입</a> (V2, 가입비/연회비 0원)</div>
          <div>2. <b>대시보드 → 채널 추가</b> — KG이니시스/나이스페이/토스/카카오페이 등 원하는 PG 가맹 후 채널 등록</div>
          <div>3. <b>대시보드 → 상점·연동 정보</b>에서 <b>Store ID</b> + <b>Channel Key</b> 복사</div>
          <div>4. <b>대시보드 → API Keys</b>에서 <b>API Secret</b> 발급 (서버에서 결제 검증용)</div>
          <div>5. 처음엔 <b>테스트 채널</b>로 등록 → 검증 후 라이브 채널로 교체</div>
        </div>

        <AField label="Store ID (스토어 ID)">
          <input style={AInp} type="text" value={form.store_id || ''} onChange={e => update('store_id', e.target.value)}
            placeholder="store-12345..." spellCheck={false} autoComplete="off" />
        </AField>
        <AField label="Channel Key (채널 키)">
          <input style={AInp} type="text" value={form.channel_key || ''} onChange={e => update('channel_key', e.target.value)}
            placeholder="channel-key-..." spellCheck={false} autoComplete="off" />
        </AField>
        <AField label="API Secret (API 시크릿, 서버 결제 검증용)">
          <input style={AInp} type="password" value={form.api_secret || ''} onChange={e => update('api_secret', e.target.value)}
            placeholder="V2 API Secret" spellCheck={false} autoComplete="off" />
        </AField>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 14, fontSize: T.fs.sm, color: T.text, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!form.is_test} onChange={e => update('is_test', e.target.checked)} style={{ accentColor: T.primary, width: 16, height: 16 }} />
          <span>테스트 모드 <span style={{ color: T.textMuted, fontSize: 11, marginLeft: 6 }}>(테스트 채널 사용 시 체크)</span></span>
        </label>

        {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? T.success : T.danger, padding: '8px 12px', borderRadius: 8, background: msg.startsWith('✓') ? '#f0faf4' : '#fff5f5', marginBottom: 12 }}>{msg}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <AIBtn onClick={save} saving={saving} disabled={saving || !hasKey} label={hasStored ? '업데이트' : '저장'} style={{ flex: 1 }} />
          {hasStored && (
            <button onClick={remove} disabled={saving} style={{
              padding: '12px 18px', borderRadius: 10,
              border: `1.5px solid ${T.danger}44`, background: '#fff5f5',
              color: T.danger, fontSize: T.fs.sm, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
            }}>삭제</button>
          )}
        </div>
      </div>
    )}

    <div className="card" style={{ padding: 16, fontSize: 12, color: T.textSub, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>ℹ️ 참고</div>
      <div>• <b>포트원 자체 수수료 0%</b> · 가입비 0원 · 연회비 0원</div>
      <div>• 실제 결제 수수료는 매장이 선택한 PG(KG이니시스/나이스페이/토스 등)에 따라 결정</div>
      <div>• API Secret은 서버에서만 사용 (Edge Function 결제 검증용 — 클라이언트엔 노출 X)</div>
      <div>• Store ID와 Channel Key는 결제창 호출용 (공개 정보)</div>
      <div>• 정산은 매장이 가입한 PG가 매장 통장으로 직접 입금 — Bliss는 결제 링크 도구만 제공</div>
    </div>
  </div>
}

export default AdminPaymentSettings
