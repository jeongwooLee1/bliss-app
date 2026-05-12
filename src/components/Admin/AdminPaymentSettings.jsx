import React, { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { APageHeader, AField, AInp, AIBtn } from './AdminUI'
import I from '../common/I'

// 매장별 결제 PG 설정
// branches.payment_settings.tosspayments = { client_key, secret_key, is_test }  ← 메인 (토스 직결)
// branches.payment_settings.portone     = { store_id, channel_key, api_secret, is_test }  ← 보조 (다중 PG)
function AdminPaymentSettings({ data, setData, userBranches = [], isMaster = false }) {
  const branches = useMemo(() => (data?.branches || []).filter(b => !userBranches.length || userBranches.includes(b.id)), [data?.branches, userBranches])
  const [activeBid, setActiveBid] = useState(branches[0]?.id || '')
  const activeBranch = useMemo(() => branches.find(b => b.id === activeBid) || null, [branches, activeBid])

  const ps = useMemo(() => {
    const v = activeBranch?.payment_settings
    return typeof v === 'string' ? (() => { try { return JSON.parse(v) } catch { return {} } })() : (v || {})
  }, [activeBranch])

  const hasToss = !!(ps?.tosspayments?.client_key && ps?.tosspayments?.secret_key)
  const hasPortone = !!(ps?.portone?.store_id && ps?.portone?.channel_key)
  const [tab, setTab] = useState(hasPortone && !hasToss ? 'portone' : 'toss')

  React.useEffect(() => {
    if (hasPortone && !hasToss) setTab('portone')
    else setTab('toss')
  }, [activeBid]) // eslint-disable-line

  return <div>
    <APageHeader title="💳 결제 설정" desc="매장별 결제 PG 키를 등록합니다. 예약금 청구·정기결제·결제링크에 사용." />

    {/* 매장 선택 탭 */}
    {branches.length > 1 && (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {branches.map(b => {
          const bps = (() => { const v = b?.payment_settings; return typeof v === 'string' ? (() => { try { return JSON.parse(v) } catch { return {} } })() : (v || {}) })()
          const ok = !!(bps?.tosspayments?.client_key || bps?.portone?.store_id)
          return <button key={b.id} onClick={() => setActiveBid(b.id)} style={{
            padding: '7px 14px', borderRadius: 999,
            border: `1.5px solid ${activeBid === b.id ? T.primary : T.border}`,
            background: activeBid === b.id ? (T.primaryLt || '#ede9ff') : '#fff',
            color: activeBid === b.id ? T.primary : T.textSub,
            fontSize: T.fs.xs, fontWeight: activeBid === b.id ? 700 : 500,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>
            {b.short || b.name || b.id}{ok ? ' ✓' : ''}
          </button>
        })}
      </div>
    )}

    {!activeBranch ? <div style={{ padding: 32, textAlign: 'center', color: T.textMuted }}>매장을 선택하세요</div> : <>
      {/* PG 선택 탭 */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: `1px solid ${T.border}` }}>
        <PGTab active={tab==='toss'} onClick={()=>setTab('toss')} label="토스페이먼츠 직결" badge="추천" ok={hasToss} />
        <PGTab active={tab==='portone'} onClick={()=>setTab('portone')} label="포트원 V2 (다중 PG)" ok={hasPortone} />
      </div>

      {tab === 'toss' && <TossSection ps={ps} activeBranch={activeBranch} setData={setData} />}
      {tab === 'portone' && <PortOneSection ps={ps} activeBranch={activeBranch} setData={setData} />}
    </>}
  </div>
}

function PGTab({ active, onClick, label, badge, ok }) {
  return <button onClick={onClick} style={{
    padding: '10px 16px', border: 'none', background: 'transparent',
    borderBottom: `2px solid ${active ? T.primary : 'transparent'}`,
    color: active ? T.primary : T.textSub, fontSize: T.fs.sm,
    fontWeight: active ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: -1,
  }}>
    {label}
    {badge && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: '#7C3AED', color: '#fff', fontWeight: 700 }}>{badge}</span>}
    {ok && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: '#f0faf4', color: T.success, fontWeight: 700 }}>등록됨</span>}
  </button>
}

function TossSection({ ps, activeBranch, setData }) {
  const initial = ps?.tosspayments || {}
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  React.useEffect(() => { setForm(initial); setMsg('') }, [activeBranch?.id]) // eslint-disable-line
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const cur = activeBranch?.payment_settings
      const obj = typeof cur === 'string' ? (() => { try { return JSON.parse(cur) } catch { return {} } })() : (cur || {})
      const next = { ...obj, tosspayments: {
        client_key: (form.client_key || '').trim(),
        secret_key: (form.secret_key || '').trim(),
        is_test: !!form.is_test,
      } }
      await sb.update('branches', activeBranch.id, { payment_settings: next })
      if (setData) setData(prev => ({ ...prev, branches: (prev?.branches || []).map(b => b.id === activeBranch.id ? { ...b, payment_settings: next } : b) }))
      setMsg('✓ 저장됨')
    } catch (e) { setMsg('저장 실패: ' + (e?.message || e)) }
    setSaving(false)
  }

  const remove = async () => {
    if (!confirm('이 매장의 토스페이먼츠 키를 삭제할까요?')) return
    setSaving(true); setMsg('')
    try {
      const cur = activeBranch?.payment_settings
      const obj = typeof cur === 'string' ? (() => { try { return JSON.parse(cur) } catch { return {} } })() : (cur || {})
      const next = { ...obj }; delete next.tosspayments
      await sb.update('branches', activeBranch.id, { payment_settings: next })
      if (setData) setData(prev => ({ ...prev, branches: (prev?.branches || []).map(b => b.id === activeBranch.id ? { ...b, payment_settings: next } : b) }))
      setForm({}); setMsg('✓ 삭제됨')
    } catch (e) { setMsg('삭제 실패: ' + (e?.message || e)) }
    setSaving(false)
  }

  const hasKey = !!(form.client_key && form.secret_key)
  const hasStored = !!(initial.client_key && initial.secret_key)
  const isTestKey = (form.client_key || '').startsWith('test_') || (form.secret_key || '').startsWith('test_')

  return <div className="card" style={{ padding: 20, marginBottom: 16 }}>
    <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
      <I name="building" size={14} style={{ color: T.primary }} />
      {activeBranch.name || activeBranch.short}
      {hasStored && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: T.success, background: '#f0faf4', padding: '3px 10px', borderRadius: 999 }}>등록됨</span>}
    </div>

    <div style={{ background: '#fafafa', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: T.textSub, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, color: T.text, marginBottom: 4 }}>📌 가입 안내</div>
      <div>1. <a href="https://www.tosspayments.com/" target="_blank" rel="noopener" style={{ color: T.primary, textDecoration: 'underline' }}>토스페이먼츠 가맹점 가입</a></div>
      <div>2. <b>개발자센터 → API 키</b> — Client Key + Secret Key 복사 (테스트 키는 가입 즉시 발급)</div>
      <div>3. 처음에는 <b>테스트 키</b>(`test_ck_*` / `test_sk_*`)로 등록 → 검증 후 라이브 키로 교체</div>
      <div>4. <b>일반결제 + 충전형(빌링) + 결제링크</b> 모두 동일 키로 사용</div>
    </div>

    <AField label="Client Key (클라이언트 키, 결제창 호출용)">
      <input style={AInp} type="text" value={form.client_key || ''} onChange={e => update('client_key', e.target.value)}
        placeholder="test_ck_... 또는 live_ck_..." spellCheck={false} autoComplete="off" />
    </AField>
    <AField label="Secret Key (시크릿 키, 서버 결제 승인용)">
      <input style={AInp} type="password" value={form.secret_key || ''} onChange={e => update('secret_key', e.target.value)}
        placeholder="test_sk_... 또는 live_sk_..." spellCheck={false} autoComplete="off" />
    </AField>

    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 14, fontSize: T.fs.sm, color: T.text, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!form.is_test} onChange={e => update('is_test', e.target.checked)} style={{ accentColor: T.primary, width: 16, height: 16 }} />
      <span>테스트 모드 <span style={{ color: T.textMuted, fontSize: 11, marginLeft: 6 }}>(test_ck_/test_sk_ 키 사용 시 체크)</span></span>
    </label>

    {isTestKey && !form.is_test && (
      <div style={{ fontSize: 11, color: '#854d0e', background: '#fef9c3', padding: '8px 12px', borderRadius: 8, marginBottom: 12 }}>
        ⚠️ 키가 test_로 시작합니다. 테스트 모드 체크박스도 함께 켜는 걸 권장합니다.
      </div>
    )}

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

    <div style={{ marginTop: 16, fontSize: 12, color: T.textSub, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>ℹ️ 수수료 (영중소 우대)</div>
      <div>• 영세 1.6% · 중소1 2.0% · 중소2 2.2% · 중소3 2.3%</div>
      <div>• 정산은 토스페이먼츠에서 매장 통장으로 직접 입금</div>
      <div>• Secret Key는 서버에서만 사용 (Edge Function 결제 승인용 — 클라이언트엔 노출 X)</div>
    </div>
  </div>
}

function PortOneSection({ ps, activeBranch, setData }) {
  const initial = ps?.portone || {}
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  React.useEffect(() => { setForm(initial); setMsg('') }, [activeBranch?.id]) // eslint-disable-line
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
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
      await sb.update('branches', activeBranch.id, { payment_settings: next })
      if (setData) setData(prev => ({ ...prev, branches: (prev?.branches || []).map(b => b.id === activeBranch.id ? { ...b, payment_settings: next } : b) }))
      setMsg('✓ 저장됨')
    } catch (e) { setMsg('저장 실패: ' + (e?.message || e)) }
    setSaving(false)
  }

  const remove = async () => {
    if (!confirm('이 매장의 포트원 키를 삭제할까요?')) return
    setSaving(true); setMsg('')
    try {
      const cur = activeBranch?.payment_settings
      const obj = typeof cur === 'string' ? (() => { try { return JSON.parse(cur) } catch { return {} } })() : (cur || {})
      const next = { ...obj }; delete next.portone
      await sb.update('branches', activeBranch.id, { payment_settings: next })
      if (setData) setData(prev => ({ ...prev, branches: (prev?.branches || []).map(b => b.id === activeBranch.id ? { ...b, payment_settings: next } : b) }))
      setForm({}); setMsg('✓ 삭제됨')
    } catch (e) { setMsg('삭제 실패: ' + (e?.message || e)) }
    setSaving(false)
  }

  const hasKey = !!(form.store_id && form.channel_key && form.api_secret)
  const hasStored = !!(initial.store_id && initial.channel_key)

  return <div className="card" style={{ padding: 20, marginBottom: 16 }}>
    <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
      <I name="building" size={14} style={{ color: T.primary }} />
      {activeBranch.name || activeBranch.short}
      {hasStored && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: T.success, background: '#f0faf4', padding: '3px 10px', borderRadius: 999 }}>등록됨</span>}
    </div>

    <div style={{ background: '#fafafa', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: T.textSub, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, color: T.text, marginBottom: 4 }}>📌 가입 안내</div>
      <div>1. <a href="https://portone.io" target="_blank" rel="noopener" style={{ color: T.primary, textDecoration: 'underline' }}>포트원 가입</a> (V2, 가입비/연회비 0원)</div>
      <div>2. <b>대시보드 → 채널 추가</b> — KG이니시스/나이스페이/토스/카카오페이 등 PG 가맹 후 채널 등록</div>
      <div>3. <b>대시보드 → 상점·연동 정보</b>에서 <b>Store ID</b> + <b>Channel Key</b> 복사</div>
      <div>4. <b>대시보드 → API Keys</b>에서 <b>API Secret</b> 발급</div>
    </div>

    <AField label="Store ID (스토어 ID)">
      <input style={AInp} type="text" value={form.store_id || ''} onChange={e => update('store_id', e.target.value)}
        placeholder="store-12345..." spellCheck={false} autoComplete="off" />
    </AField>
    <AField label="Channel Key (채널 키)">
      <input style={AInp} type="text" value={form.channel_key || ''} onChange={e => update('channel_key', e.target.value)}
        placeholder="channel-key-..." spellCheck={false} autoComplete="off" />
    </AField>
    <AField label="API Secret (서버 결제 검증용)">
      <input style={AInp} type="password" value={form.api_secret || ''} onChange={e => update('api_secret', e.target.value)}
        placeholder="V2 API Secret" spellCheck={false} autoComplete="off" />
    </AField>

    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 14, fontSize: T.fs.sm, color: T.text, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!form.is_test} onChange={e => update('is_test', e.target.checked)} style={{ accentColor: T.primary, width: 16, height: 16 }} />
      <span>테스트 모드</span>
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

    <div style={{ marginTop: 16, fontSize: 12, color: T.textSub, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>ℹ️ 참고</div>
      <div>• 포트원 자체 수수료 0% · 가입비 0원 · 연회비 0원</div>
      <div>• 실제 결제 수수료는 매장이 선택한 PG에 따라 결정</div>
      <div>• 매장이 직접 토스페이먼츠 가맹점 가입했다면 위의 <b>토스페이먼츠 직결</b> 탭을 쓰는 게 단순합니다</div>
    </div>
  </div>
}

export default AdminPaymentSettings
