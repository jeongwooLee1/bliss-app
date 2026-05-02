import React, { useEffect, useState, useMemo } from 'react'
import { sb } from '../../lib/sb'
import { T } from '../../lib/constants'

// 매출 메모 + 시술 내역 날짜별 요약 페이지
// URL: /sale-summary?cust=<cust_num>  (디폴트 44700)
export default function SaleSummary() {
  const [state, setState] = useState({ loading: true, error: null, cust: null, sales: [], details: [] })

  useEffect(() => {
    const custNum = new URLSearchParams(window.location.search).get('cust') || '44700'
    let cancelled = false
    ;(async () => {
      try {
        const custs = await sb.get('customers', `&cust_num=eq.${custNum}&limit=1`)
        if (!custs?.length) {
          if (!cancelled) setState({ loading: false, error: `고객번호 ${custNum} 없음`, cust: null, sales: [], details: [] })
          return
        }
        const cust = custs[0]
        const sales = await sb.get('sales', `&cust_id=eq.${cust.id}&order=date.desc,created_at.desc`)
        let details = []
        const ids = (sales || []).map(s => s.id)
        if (ids.length) {
          details = await sb.get('sale_details', `&sale_id=in.(${ids.join(',')})&order=service_no.asc`)
        }
        if (!cancelled) setState({ loading: false, error: null, cust, sales: sales || [], details: details || [] })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: String(e?.message || e), cust: null, sales: [], details: [] })
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 날짜별 그룹 + 시술내역에서 금액>0만 필터
  const grouped = useMemo(() => {
    const { sales, details } = state
    if (!sales?.length) return []
    const byDate = new Map()
    sales.forEach(s => {
      const dts = details
        .filter(d => d.sale_id === s.id && (d.unit_price || 0) > 0)
        // 시스템 행(보유권 차감/이벤트/쿠폰 등 자동 기록) 제외 — 실제 결제 시술/제품/할인만
        .filter(d => !/^\[(이벤트|쿠폰)/.test(d.service_name || ''))
      const memo = (s.memo || '').trim()
      const total = (s.svcCash||0)+(s.svcTransfer||0)+(s.svcCard||0)+(s.svcPoint||0)
                  +(s.prodCash||0)+(s.prodTransfer||0)+(s.prodCard||0)+(s.prodPoint||0)
      const arr = byDate.get(s.date) || []
      arr.push({ sale: s, items: dts, memo, total })
      byDate.set(s.date, arr)
    })
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, list]) => ({ date, list }))
  }, [state])

  const fmt = (n) => (Number(n || 0)).toLocaleString()
  const dayLabel = (ds) => {
    const d = new Date(ds)
    const dow = ['일','월','화','수','목','금','토'][d.getDay()]
    return `${ds} (${dow})`
  }

  if (state.loading) return <div style={{padding:24,fontSize:14,color:T.textSub}}>불러오는 중…</div>
  if (state.error) return <div style={{padding:24,fontSize:14,color:T.danger}}>{state.error}</div>

  const { cust, sales } = state
  const totalGrand = grouped.reduce((s, g) => s + g.list.reduce((ss, x) => ss + x.total, 0), 0)

  return <div style={{padding:'20px 24px',maxWidth:980,margin:'0 auto',fontFamily:'inherit'}}>
    {/* 헤더 */}
    <div style={{borderBottom:'2px solid '+T.primary,paddingBottom:12,marginBottom:18}}>
      <div style={{fontSize:11,color:T.textMuted,fontWeight:600,marginBottom:4}}>매출 요약 (TEST)</div>
      <h1 style={{fontSize:22,fontWeight:800,color:T.text,margin:0}}>{cust?.name||'-'} <span style={{fontSize:13,color:T.textSub,fontWeight:500,marginLeft:6,fontFamily:'monospace'}}>#{cust?.custNum||cust?.cust_num||'-'}</span></h1>
      <div style={{marginTop:6,fontSize:12,color:T.textSub}}>
        매출 {sales.length}건 · 총 {fmt(totalGrand)}원 · 날짜 {grouped.length}일
      </div>
      {cust?.memo && <div style={{marginTop:8,padding:'8px 12px',background:T.warningLt||'#FFF8E1',border:'1px solid '+(T.warning||'#FFB74D'),borderRadius:6,fontSize:12,color:T.textSub,whiteSpace:'pre-wrap'}}>
        <span style={{fontWeight:700,color:'#7a5a00'}}>📌 고객 메모: </span>{cust.memo}
      </div>}
    </div>

    {/* 날짜별 카드 */}
    {grouped.length === 0 && <div style={{padding:24,textAlign:'center',color:T.textMuted,fontSize:13}}>매출 이력 없음</div>}
    {grouped.map(g => {
      const dayTotal = g.list.reduce((s, x) => s + x.total, 0)
      return <div key={g.date} style={{
        marginBottom:16,
        background:T.bgCard,
        border:'1px solid '+T.border,
        borderRadius:10,
        overflow:'hidden',
        boxShadow:'0 1px 3px rgba(0,0,0,.04)',
      }}>
        {/* 날짜 헤더 */}
        <div style={{
          padding:'10px 14px',
          background:'linear-gradient(135deg,#f8f9fb,#f0f2f5)',
          borderBottom:'1px solid '+T.border,
          display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,
        }}>
          <div style={{fontSize:14,fontWeight:800,color:T.text}}>{dayLabel(g.date)}</div>
          <div style={{fontSize:13,fontWeight:700,color:T.primary}}>{fmt(dayTotal)}원</div>
        </div>
        {/* 그날 매출들 */}
        {g.list.map((entry, i) => {
          const { sale, items, memo, total } = entry
          return <div key={sale.id} style={{
            padding:'10px 14px',
            borderBottom: i < g.list.length-1 ? '1px dashed '+T.border : 'none',
          }}>
            {/* 특이사항 (메모) */}
            {memo && <div style={{
              padding:'8px 10px',
              background:'#FFFBEB',
              border:'1px solid #FCD34D',
              borderRadius:6,
              fontSize:12,
              lineHeight:1.5,
              whiteSpace:'pre-wrap',
              color:'#78350F',
              marginBottom: items.length ? 8 : 0,
            }}>
              <span style={{fontWeight:700,marginRight:6}}>📝 특이사항</span>
              {memo}
            </div>}
            {/* 시술 내역 (금액 > 0만) */}
            {items.length > 0 && <div style={{display:'flex',flexDirection:'column',gap:3}}>
              {items.map(d => {
                const isDiscount = /^\[할인/.test(d.service_name||'')
                const isPkgDeduct = /^\[보유권/.test(d.service_name||'')
                const isExperience = /^\[체험단\]/.test(d.service_name||'')
                const clr = isDiscount ? T.danger : isPkgDeduct ? '#E65100' : isExperience ? '#0288D1' : T.text
                return <div key={d.id} style={{
                  display:'flex',justifyContent:'space-between',gap:10,
                  padding:'4px 8px',
                  background:isDiscount?'#FFEBEE':isPkgDeduct?'#FFF8E1':isExperience?'#E1F5FE':'transparent',
                  borderRadius:4,
                  fontSize:12,
                }}>
                  <span style={{color:clr,fontWeight:isDiscount||isPkgDeduct||isExperience?700:500,whiteSpace:'pre-wrap'}}>{d.service_name}{(d.qty||1)>1?` × ${d.qty}`:''}</span>
                  <span style={{color:clr,fontWeight:700,fontFamily:'monospace',whiteSpace:'nowrap'}}>{isDiscount?'-':''}{fmt(d.unit_price * (d.qty||1))}원</span>
                </div>
              })}
              <div style={{
                marginTop:4,paddingTop:6,borderTop:'1px solid '+T.border,
                display:'flex',justifyContent:'space-between',alignItems:'center',
              }}>
                <span style={{fontSize:11,color:T.textMuted}}>담당: {sale.staffName||sale.staff_name||'-'}</span>
                <span style={{fontSize:13,fontWeight:800,color:T.primary}}>{fmt(total)}원</span>
              </div>
            </div>}
          </div>
        })}
      </div>
    })}

    <div style={{marginTop:24,padding:12,fontSize:11,color:T.textMuted,textAlign:'center',borderTop:'1px solid '+T.border}}>
      💡 다른 고객 보기: <code style={{background:T.gray100,padding:'1px 6px',borderRadius:3}}>?cust=고객번호</code>
    </div>
  </div>
}
