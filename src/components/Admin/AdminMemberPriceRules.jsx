import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { APageHeader, AIBtn } from './AdminUI'

// AdminMemberPriceRules
// businesses.settings.member_price_rules 편집
// 새 구조: { qualifyingServiceIds: string[] }
// 레거시 자동 마이그레이션: { annualEnabled, prepaidMin } → qualifyingServiceIds
function AdminMemberPriceRules({ data, setData, bizId }) {
  const allServices = data?.services || []
  const allCats = data?.categories || []

  // 레거시 마이그레이션
  const initialIds = useMemo(() => {
    let raw
    try {
      const r = (data?.businesses || [])[0]?.settings
      raw = typeof r === 'string' ? JSON.parse(r) : (r || {})
    } catch { raw = {} }
    const stored = raw.member_price_rules || {}

    if (Array.isArray(stored.qualifyingServiceIds)) return stored.qualifyingServiceIds

    // 레거시 → 마이그레이션 (annual + prepaid 카테고리 시술 추출)
    const annualEnabled = stored.annualEnabled !== false
    const prepaidMinPositive = Number(stored.prepaidMin || 0) > 0 || stored.prepaidMin === undefined
    const ids = []
    allServices.forEach(s => {
      const nm = (s.name || '').toLowerCase()
      const catName = (allCats.find(c => c.id === s.cat)?.name || '').toLowerCase()
      const isAnnual = /연간|회원권|할인권/.test(nm) || /연간|회원권/.test(catName)
      const isPrepaid = /다담권|선불권/.test(catName) || /다담권|선불권/.test(nm)
      if (isAnnual && annualEnabled) ids.push(s.id)
      else if (isPrepaid && prepaidMinPositive) ids.push(s.id)
      else if (s.isPackage) ids.push(s.id)
    })
    return ids
  }, [data?.businesses, allServices, allCats])

  const [qualifyingIds, setQualifyingIds] = useState(initialIds)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setQualifyingIds(initialIds)
  }, [initialIds])

  const toggleQual = (id) => setQualifyingIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  // 카테고리별 그룹화 (전체 시술상품 — 카테고리 정렬 순서 따름)
  const byCategory = useMemo(() => {
    const sortedCats = [...allCats].sort((a,b) => (a.sort||0) - (b.sort||0))
    return sortedCats
      .map(c => ({ cat: c, svcs: allServices.filter(s => s.cat === c.id && s.isActive !== false) }))
      .filter(g => g.svcs.length > 0)
  }, [allServices, allCats])

  const save = async () => {
    setSaving(true)
    try {
      const rows = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders }).then(r => r.json())
      const raw = rows?.[0]?.settings
      const current = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
      const next = {
        ...current,
        member_price_rules: { qualifyingServiceIds: qualifyingIds },
      }
      await sb.update('businesses', bizId, { settings: JSON.stringify(next) })
      if (setData) {
        setData(prev => ({
          ...prev,
          businesses: (prev?.businesses || []).map(b => b.id === bizId ? { ...b, settings: JSON.stringify(next) } : b),
        }))
      }
      alert('저장됨')
    } catch (e) {
      alert('저장 실패: ' + (e?.message || e))
    }
    setSaving(false)
  }

  return <div>
    <APageHeader title="회원가 적용 규칙" desc="회원가(할인가)를 받을 자격(보유권)을 시술상품에서 선택합니다." />

    {/* 회원가 자격 부여 보유권 — 시술상품 전체 카테고리별 표시 */}
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.black, color: T.text, marginBottom: 6 }}>회원가 자격 부여 보유권 <span style={{ color: T.primary }}>({qualifyingIds.length}개 선택)</span></div>
      <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 14 }}>
        체크된 보유권을 가진(또는 동시 구매하는) 고객은 매출등록 시 시술가가 <b style={{ color: T.primary }}>회원가</b>로 자동 표시됩니다. 시술상품관리에서 등록된 모든 항목이 표시됩니다.
      </div>

      {byCategory.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: T.fs.xs }}>등록된 시술상품이 없습니다</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {byCategory.map(g => (
            <div key={g.cat.id}>
              <div style={{ fontSize: T.fs.xxs, fontWeight: T.fw.bolder, color: T.textSub, marginBottom: 6 }}>{g.cat.name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.svcs.map(s => {
                  const on = qualifyingIds.includes(s.id)
                  return <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: `1.5px solid ${on ? T.primary : T.border}`, borderRadius: 18, background: on ? (T.primaryLt || '#ede9ff') : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 500, color: on ? T.primary : T.text }}>
                    <input type="checkbox" checked={on} onChange={() => toggleQual(s.id)} style={{ accentColor: T.primary }} />
                    {s.name}
                  </label>
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    <AIBtn onClick={save} saving={saving} disabled={saving} label="저장" style={{ width: '100%' }} />
  </div>
}

export default AdminMemberPriceRules
