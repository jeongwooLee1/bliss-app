import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import I from '../common/I'
import { APageHeader, AIBtn } from './AdminUI'

// AdminMemberPriceRules
// businesses.settings.member_price_rules 편집
// 구조: { annualEnabled: bool, prepaidMin: number, excludeServiceIds: string[] }
function AdminMemberPriceRules({ data, setData, bizId }) {
  const initialRules = useMemo(() => {
    try {
      const raw = (data?.businesses || [])[0]?.settings
      const s = typeof raw === 'string' ? JSON.parse(raw) : (raw || {})
      return s.member_price_rules || { annualEnabled: true, prepaidMin: 300000, excludeServiceIds: [] }
    } catch { return { annualEnabled: true, prepaidMin: 300000, excludeServiceIds: [] } }
  }, [data?.businesses])

  const [annualEnabled, setAnnualEnabled] = useState(!!initialRules.annualEnabled)
  const [prepaidMin, setPrepaidMin] = useState(Number(initialRules.prepaidMin) || 300000)
  const [excludeIds, setExcludeIds] = useState(Array.isArray(initialRules.excludeServiceIds) ? initialRules.excludeServiceIds : [])
  const [saving, setSaving] = useState(false)

  // initialRules 바뀌면 state 재동기화 (settings reload 대응)
  useEffect(() => {
    setAnnualEnabled(!!initialRules.annualEnabled)
    setPrepaidMin(Number(initialRules.prepaidMin) || 300000)
    setExcludeIds(Array.isArray(initialRules.excludeServiceIds) ? initialRules.excludeServiceIds : [])
  }, [initialRules])

  // 선불권 카테고리(= 다담권/바프권 등) 서비스 목록
  const prepaidSvcs = useMemo(() => {
    const cats = data?.categories || []
    const prepaidCatIds = cats.filter(c => c.name === '선불권' || c.name === '다담권').map(c => c.id)
    return (data?.services || []).filter(s => prepaidCatIds.includes(s.cat))
  }, [data?.services, data?.categories])

  const toggleExclude = (svcId) => {
    setExcludeIds(prev => prev.includes(svcId) ? prev.filter(x => x !== svcId) : [...prev, svcId])
  }

  const save = async () => {
    setSaving(true)
    try {
      // 최신 settings 재조회 (경쟁 상태 방지)
      const rows = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders }).then(r => r.json())
      const raw = rows?.[0]?.settings
      const current = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
      const next = {
        ...current,
        member_price_rules: {
          annualEnabled: !!annualEnabled,
          prepaidMin: Number(prepaidMin) || 0,
          excludeServiceIds: excludeIds,
        },
      }
      await sb.update('businesses', bizId, { settings: JSON.stringify(next) })
      // 로컬 반영
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

  const fmtNum = (n) => (Number(n) || 0).toLocaleString('ko-KR')

  return <div>
    <APageHeader title="회원가 적용 규칙" desc="회원가(할인가) 자격을 누가 받을지 결정합니다. 선불권별로 예외 지정도 가능." />

    {/* 기본 규칙 */}
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.black, color: T.text, marginBottom: 14 }}>기본 규칙</div>

      {/* 연간회원권 자격 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + T.gray100 }}>
        <div>
          <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text }}>연간회원권 보유 → 회원가</div>
          <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginTop: 2 }}>연간회원권/연간할인권 보유 고객 자동 적용</div>
        </div>
        <button onClick={() => setAnnualEnabled(v => !v)}
          style={{ width: 50, height: 28, borderRadius: 14, border: 'none', background: annualEnabled ? T.primary : T.gray300, cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 3, left: annualEnabled ? 25 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
      </div>

      {/* 선불권 최소 충전액 */}
      <div style={{ padding: '14px 0 4px' }}>
        <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text }}>선불권 최소 원 충전금액</div>
        <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginTop: 2, marginBottom: 10 }}>note의 "충전:xxx" 값이 이 금액 이상이면 회원가 자격</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="number" value={prepaidMin} onChange={e => setPrepaidMin(e.target.value)}
            style={{ width: 160, padding: '8px 12px', border: '1.5px solid ' + T.border, borderRadius: 8, fontSize: T.fs.sm, fontFamily: 'inherit' }} />
          <span style={{ fontSize: T.fs.xs, color: T.textMuted }}>원 (현재 {fmtNum(prepaidMin)})</span>
          {(Number(prepaidMin) || 0) === 0 && <span style={{ fontSize: T.fs.xxs, color: T.warning }}>0이면 선불권 자격 비활성</span>}
        </div>
      </div>
    </div>

    {/* 선불권별 예외 — 회원가 자격에서 제외 */}
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.black, color: T.text, marginBottom: 6 }}>선불권 예외 (회원가 자격 제외)</div>
      <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 14 }}>
        선불권 카테고리 상품 중 <b style={{ color: T.danger }}>회원가를 주지 않을 상품</b>을 체크. 체크된 상품 보유 고객은 다른 조건이 없다면 회원가 미적용.
      </div>

      {prepaidSvcs.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: T.fs.xs }}>선불권 카테고리 상품이 없습니다</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {prepaidSvcs.map(s => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid ' + T.border, borderRadius: 8, cursor: 'pointer', background: excludeIds.includes(s.id) ? T.danger + '0D' : '#fff' }}>
              <input type="checkbox" checked={excludeIds.includes(s.id)} onChange={() => toggleExclude(s.id)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: T.fs.xs, fontWeight: T.fw.bolder, color: T.text }}>{s.name}</div>
                <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginTop: 2 }}>
                  {(s.price_f > 0 || s.price_m > 0) && <>가격: {fmtNum(s.price_f || s.price_m)}원</>}
                  {excludeIds.includes(s.id) && <span style={{ marginLeft: 8, color: T.danger, fontWeight: 700 }}>· 회원가 제외</span>}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>

    <AIBtn onClick={save} saving={saving} disabled={saving} label="저장" style={{ width: '100%' }} />
  </div>
}

export default AdminMemberPriceRules
