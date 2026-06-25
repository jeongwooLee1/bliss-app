import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { APageHeader, AIBtn } from './AdminUI'

// 재방문 스탬프 제도 설정 — businesses.settings.stamp_program
// { on, windowDays, final, milestones:[{n,label,rewardServiceId,reset}] }
// final(사이클 완성 회차)은 reset=true인 회차로 자동 산출
function AdminStampProgram({ data, setData, bizId }) {
  const allServices = data?.services || []
  const allCats = data?.categories || []

  const initial = useMemo(() => {
    let raw
    try {
      const r = (data?.businesses || [])[0]?.settings
      raw = typeof r === 'string' ? JSON.parse(r) : (r || {})
    } catch { raw = {} }
    const sp = raw.stamp_program || {}
    return {
      on: !!sp.on,
      windowDays: Number(sp.windowDays) || 28,
      milestones: Array.isArray(sp.milestones) && sp.milestones.length
        ? sp.milestones.map(m => ({ n: Number(m.n) || 0, label: m.label || '', rewardServiceId: m.rewardServiceId || null, reset: !!m.reset }))
        : [
            { n: 3, label: '인중 왁싱 무료', rewardServiceId: null, reset: false },
            { n: 5, label: '겨드랑이 왁싱 무료', rewardServiceId: null, reset: false },
            { n: 8, label: '궁/에너지테라피 20분 무료', rewardServiceId: null, reset: true },
          ],
    }
  }, [data?.businesses])

  const [on, setOn] = useState(initial.on)
  const [windowDays, setWindowDays] = useState(initial.windowDays)
  const [milestones, setMilestones] = useState(initial.milestones)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setOn(initial.on); setWindowDays(initial.windowDays); setMilestones(initial.milestones) }, [initial])

  const updM = (i, patch) => setMilestones(prev => prev.map((m, idx) => idx === i ? { ...m, ...patch } : m))
  const addM = () => setMilestones(prev => [...prev, { n: (prev.length ? Math.max(...prev.map(x => Number(x.n) || 0)) + 1 : 1), label: '', rewardServiceId: null, reset: false }])
  const removeM = (i) => setMilestones(prev => prev.filter((_, idx) => idx !== i))

  // 보상 선택 목록 (카테고리별) — 혜택관리 쿠폰(쿠폰 카테고리)을 맨 위로 (기존 쿠폰 재사용 우선)
  const svcOpts = useMemo(() => {
    const groups = allCats
      .map(c => ({ cat: c, svcs: allServices.filter(s => s.cat === c.id && s.isActive !== false) }))
      .filter(g => g.svcs.length > 0)
    groups.sort((a, b) => {
      const ac = a.cat.name === '쿠폰' ? 0 : 1, bc = b.cat.name === '쿠폰' ? 0 : 1
      if (ac !== bc) return ac - bc
      return (a.cat.sort || 0) - (b.cat.sort || 0)
    })
    return groups
  }, [allServices, allCats])

  const finalN = useMemo(() => {
    const resetM = milestones.find(m => m.reset && Number(m.n) > 0)
    const ns = milestones.map(m => Number(m.n) || 0).filter(n => n > 0)
    return resetM ? Number(resetM.n) : (ns.length ? Math.max(...ns) : 8)
  }, [milestones])

  const save = async () => {
    const ms = milestones
      .filter(m => Number(m.n) > 0 && (m.label || '').trim())
      .map(m => ({ n: Number(m.n), label: m.label.trim(), rewardServiceId: m.rewardServiceId || null, reset: !!m.reset }))
      .sort((a, b) => a.n - b.n)
    const ns = ms.map(m => m.n)
    if (new Set(ns).size !== ns.length) { alert('회차 번호가 중복됩니다. 확인해주세요.'); return }
    if (on && ms.length === 0) { alert('제도를 켜려면 보상 회차를 1개 이상 등록해주세요.'); return }
    const resetM = ms.find(m => m.reset)
    const final = resetM ? resetM.n : (ns.length ? Math.max(...ns) : 8)
    setSaving(true)
    try {
      const rows = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders }).then(r => r.json())
      const raw = rows?.[0]?.settings
      const current = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
      const next = { ...current, stamp_program: { on, windowDays: Number(windowDays) || 28, final, milestones: ms } }
      await sb.update('businesses', bizId, { settings: JSON.stringify(next) })
      if (setData) setData(prev => ({ ...prev, businesses: (prev?.businesses || []).map(b => b.id === bizId ? { ...b, settings: JSON.stringify(next) } : b) }))
      alert('저장됨')
    } catch (e) { alert('저장 실패: ' + (e?.message || e)) }
    setSaving(false)
  }

  const inpS = { padding: '6px 8px', border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none' }

  return <div>
    <APageHeader title="재방문 스탬프" desc="28일(설정값) 이내 재방문 시 스탬프가 자동 적립되고, 회차별 보상이 발급됩니다. 시스템이 방문 간격을 자동 판정하므로 직원이 임의로 적립할 수 없습니다." />

    {/* on/off + 재방문 인정 기간 */}
    <div className="card" style={{ padding: 18, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700, fontSize: T.fs.sm }}>
        <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} style={{ accentColor: T.primary, width: 18, height: 18 }} />
        제도 사용 {on ? <span style={{ color: T.primary }}>ON</span> : <span style={{ color: T.textMuted }}>OFF</span>}
      </label>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: T.fs.sm }}>
        <span style={{ color: T.textSub, fontWeight: 700 }}>재방문 인정 기간</span>
        <input type="number" min={1} max={90} value={windowDays} onChange={e => setWindowDays(e.target.value)} style={{ ...inpS, width: 64, textAlign: 'center' }} />
        <span style={{ color: T.textSub }}>일 이내</span>
      </div>
      <div style={{ fontSize: T.fs.xxs, color: T.textMuted }}>사이클 완성 회차: <b style={{ color: T.primary }}>{finalN}회</b></div>
    </div>

    {/* 보상 회차 */}
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.black, marginBottom: 6 }}>보상 회차</div>
      <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
        설정한 회차에 도달하면 보상이 고객에게 <b>자동 발급</b>됩니다(유효 2개월, 보유권에서 확인·사용). <b>혜택 관리 → 쿠폰 등록</b>에서 만든 <b>쿠폰</b>을 보상으로 고르면 그 쿠폰이 그대로 발급되고(쿠폰 시스템 재사용), 일반 시술을 고르면 그 시술 <b>무료 1회권</b>으로, 미지정 시 이름만 적힌 쿠폰으로 발급돼요.<br />
        <b>사이클 완성</b> 회차에 도달하면 다음 방문부터 새 사이클(1회차)로 리셋됩니다.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {milestones.map((m, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', background: T.gray100, borderRadius: 8 }}>
            <input type="number" min={1} value={m.n} onChange={e => updM(i, { n: Number(e.target.value) })} style={{ ...inpS, width: 52, textAlign: 'center' }} />
            <span style={{ fontSize: 12, color: T.textSub }}>회차</span>
            <input value={m.label} onChange={e => updM(i, { label: e.target.value })} placeholder="보상 이름 (예: 인중 왁싱 무료)" style={{ ...inpS, flex: 1, minWidth: 150 }} />
            <select value={m.rewardServiceId || ''} onChange={e => updM(i, { rewardServiceId: e.target.value || null })} style={{ ...inpS, minWidth: 150, fontSize: 12 }}>
              <option value="">보상 — 쿠폰/시술 선택 (미지정=라벨만)</option>
              {svcOpts.map(g => <optgroup key={g.cat.id} label={g.cat.name}>{g.svcs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: m.reset ? T.primary : T.textSub, fontWeight: m.reset ? 700 : 500 }}>
              <input type="checkbox" checked={m.reset} onChange={e => updM(i, { reset: e.target.checked })} style={{ accentColor: T.primary }} />사이클 완성
            </label>
            <button onClick={() => removeM(i)} style={{ background: 'none', border: 'none', color: T.danger, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>삭제</button>
          </div>
        ))}
      </div>
      <button onClick={addM} style={{ marginTop: 10, padding: '6px 14px', border: `1px dashed ${T.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: T.primary, fontFamily: 'inherit' }}>+ 회차 추가</button>
    </div>

    <AIBtn onClick={save} saving={saving} disabled={saving} label="저장" style={{ width: '100%' }} />
  </div>
}

export default AdminStampProgram
