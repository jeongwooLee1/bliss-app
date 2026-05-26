import React, { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'
import { _activeBizId, fromDb } from '../../lib/db'
import I from '../common/I'

const FILTER_KEY = 'salesGrid_filters_v2'

// 이 날짜부터(>=) 발생한 매출은 포인트를 금액(매출)에서 제외(현금 미수취). 이전은 그대로.
const POINT_EXCL_FROM = '2026-05-26'
const exclPt = (sale, v) => ((sale?.date || '') >= POINT_EXCL_FROM ? (v || 0) : 0)

const today = () => new Date().toISOString().slice(0, 10)
const back = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0,10) }

const defaultFilters = () => ({
  date:    { sort: null, start: back(30), end: today() },
  custNum: { sort: null, selected: null, includeEmpty: true },
  custName:{ sort: null, selected: null, includeEmpty: true, enOnly: false },
  custPhone:{ sort: null, selected: null, includeEmpty: true },
  joinDate:{ sort: null, start: '', end: '', includeEmpty: true },
  service: { sort: null, selected: null, includeEmpty: true },
  staff:   { sort: null, selected: null, includeEmpty: true },
  bid:     { sort: null, selected: null, includeEmpty: true },
  amount:  { sort: null, min: '', max: '' },
  memo:    { sort: null, selected: null, includeEmpty: true },
})

const loadFilters = () => {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY)
    if (!raw) return defaultFilters()
    const parsed = JSON.parse(raw)
    Object.keys(parsed).forEach(k => {
      if (parsed[k] && Array.isArray(parsed[k].selected)) parsed[k].selected = new Set(parsed[k].selected)
    })
    return { ...defaultFilters(), ...parsed }
  } catch { return defaultFilters() }
}
const saveFilters = (f) => {
  try {
    const out = {}
    Object.keys(f).forEach(k => {
      if (f[k]?.selected instanceof Set) out[k] = { ...f[k], selected: [...f[k].selected] }
      else out[k] = f[k]
    })
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(out))
  } catch {}
}

export function ExcelFilter({ btnRef, columnKey, columnLabel, type, uniqueValues, filter, onChange, onClose, branchNameMap }) {
  const popRef = useRef()
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [search, setSearch] = useState('')
  const [pendingSort, setPendingSort] = useState(filter?.sort || null)
  const [pendingStart, setPendingStart] = useState(filter?.start || '')
  const [pendingEnd, setPendingEnd] = useState(filter?.end || '')
  const [pendingMin, setPendingMin] = useState(filter?.min ?? '')
  const [pendingMax, setPendingMax] = useState(filter?.max ?? '')
  const [pendingSelected, setPendingSelected] = useState(
    filter?.selected instanceof Set ? new Set(filter.selected) : new Set(uniqueValues)
  )
  const [pendingEmpty, setPendingEmpty] = useState(filter?.includeEmpty ?? true)
  const [pendingEnOnly, setPendingEnOnly] = useState(filter?.enOnly ?? false)

  useEffect(() => {
    if (!btnRef?.current) return
    const r = btnRef.current.getBoundingClientRect()
    const pw = 280
    const ph = type === 'date' ? 240 : type === 'number' ? 220 : (columnKey === 'custName' ? 420 : 380)
    let top = r.bottom + 4
    let left = r.left
    if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10
    if (top + ph > window.innerHeight - 10) top = Math.max(8, r.top - ph - 4)
    setPos({ top, left })
  }, [btnRef, type, columnKey])

  useEffect(() => {
    const onClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) &&
          (!btnRef?.current || !btnRef.current.contains(e.target))) onClose()
    }
    const tid = setTimeout(() => document.addEventListener('mousedown', onClick), 50)
    return () => { clearTimeout(tid); document.removeEventListener('mousedown', onClick) }
  }, [])

  const apply = () => {
    if (type === 'date') {
      const next = { sort: pendingSort, start: pendingStart, end: pendingEnd }
      if (columnKey === 'joinDate') next.includeEmpty = pendingEmpty
      onChange(next)
    } else if (type === 'number') {
      onChange({ sort: pendingSort, min: pendingMin, max: pendingMax })
    } else {
      const allSelected = uniqueValues.length > 0 && uniqueValues.every(v => pendingSelected.has(v))
      const next = {
        sort: pendingSort,
        selected: (allSelected && pendingEmpty) ? null : pendingSelected,
        includeEmpty: pendingEmpty,
      }
      if (columnKey === 'custName') next.enOnly = pendingEnOnly
      onChange(next)
    }
    onClose()
  }
  const clearFilter = () => {
    if (type === 'date') onChange({ sort: null, start: '', end: '', ...(columnKey==='joinDate'?{includeEmpty:true}:{}) })
    else if (type === 'number') onChange({ sort: null, min: '', max: '' })
    else onChange({ sort: null, selected: null, includeEmpty: true, ...(columnKey==='custName'?{enOnly:false}:{}) })
    onClose()
  }

  const filteredVals = useMemo(() => {
    if (type === 'date' || type === 'number') return []
    if (!search) return uniqueValues
    const q = search.toLowerCase()
    return uniqueValues.filter(v => {
      const display = (branchNameMap?.[v] || v) + ''
      return display.toLowerCase().includes(q)
    })
  }, [uniqueValues, search, type, branchNameMap])

  const toggleAll = (e) => {
    if (e.target.checked) {
      const next = new Set(pendingSelected)
      filteredVals.forEach(v => next.add(v))
      setPendingSelected(next)
    } else {
      const next = new Set(pendingSelected)
      filteredVals.forEach(v => next.delete(v))
      setPendingSelected(next)
    }
  }
  const toggleOne = (v) => {
    const next = new Set(pendingSelected)
    if (next.has(v)) next.delete(v); else next.add(v)
    setPendingSelected(next)
  }
  const allChecked = filteredVals.length > 0 && filteredVals.every(v => pendingSelected.has(v))

  return createPortal(
    <div ref={popRef} onMouseDown={(e)=>e.stopPropagation()}
      style={{ position:'fixed', top:pos.top, left:pos.left, zIndex:9999, background:'#fff',
               border:`1px solid ${T.border}`, borderRadius:6, boxShadow:'0 6px 20px rgba(0,0,0,0.18)',
               width:280, padding:10, fontFamily:'inherit', boxSizing:'border-box' }}>
      <div style={{fontSize:T.fs.xs, fontWeight:T.fw.bolder, color:T.textSub, marginBottom:8}}>{columnLabel} 필터</div>

      <div style={{display:'flex', gap:4, marginBottom:8}}>
        <button onClick={()=>setPendingSort(pendingSort==='asc'?null:'asc')}
          style={{flex:1, height:26, fontSize:11, border:`1px solid ${pendingSort==='asc'?T.primary:T.border}`,
                  background:pendingSort==='asc'?T.primary+'18':'#fff',
                  color:pendingSort==='asc'?T.primary:T.text, borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>↑ 오름차순</button>
        <button onClick={()=>setPendingSort(pendingSort==='desc'?null:'desc')}
          style={{flex:1, height:26, fontSize:11, border:`1px solid ${pendingSort==='desc'?T.primary:T.border}`,
                  background:pendingSort==='desc'?T.primary+'18':'#fff',
                  color:pendingSort==='desc'?T.primary:T.text, borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>↓ 내림차순</button>
      </div>

      {type === 'date' ? (
        <div style={{display:'flex', flexDirection:'column', gap:6, marginBottom:8}}>
          <label style={{fontSize:11, color:T.textSub}}>시작일</label>
          <input type="date" value={pendingStart} onChange={e=>setPendingStart(e.target.value)}
            style={{height:28, padding:'0 6px', fontSize:11, border:`1px solid ${T.border}`, borderRadius:4, fontFamily:'inherit'}}/>
          <label style={{fontSize:11, color:T.textSub}}>종료일</label>
          <input type="date" value={pendingEnd} onChange={e=>setPendingEnd(e.target.value)}
            style={{height:28, padding:'0 6px', fontSize:11, border:`1px solid ${T.border}`, borderRadius:4, fontFamily:'inherit'}}/>
          {columnKey === 'joinDate' && (
            <label style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:T.textSub,marginTop:4,cursor:'pointer'}}>
              <input type="checkbox" checked={pendingEmpty} onChange={e=>setPendingEmpty(e.target.checked)}/> (등록일 없음 포함)
            </label>
          )}
        </div>
      ) : type === 'number' ? (
        <div style={{display:'flex', flexDirection:'column', gap:6, marginBottom:8}}>
          <label style={{fontSize:11, color:T.textSub}}>최소 금액</label>
          <input type="number" value={pendingMin} onChange={e=>setPendingMin(e.target.value)} placeholder="0"
            style={{height:28, padding:'0 6px', fontSize:11, border:`1px solid ${T.border}`, borderRadius:4, fontFamily:'inherit'}}/>
          <label style={{fontSize:11, color:T.textSub}}>최대 금액</label>
          <input type="number" value={pendingMax} onChange={e=>setPendingMax(e.target.value)} placeholder="제한 없음"
            style={{height:28, padding:'0 6px', fontSize:11, border:`1px solid ${T.border}`, borderRadius:4, fontFamily:'inherit'}}/>
        </div>
      ) : (
        <>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 검색"
            style={{width:'100%', height:26, padding:'0 6px', fontSize:11, border:`1px solid ${T.border}`,
                    borderRadius:4, marginBottom:6, boxSizing:'border-box', fontFamily:'inherit'}}/>
          <div style={{maxHeight:200, overflowY:'auto', border:`1px solid ${T.border}`, borderRadius:4,
                       padding:'2px 0', fontSize:11, marginBottom:8}}>
            <label style={{display:'flex',alignItems:'center',gap:4,padding:'4px 8px',
                           fontWeight:T.fw.bolder, borderBottom:`1px solid ${T.border}40`, cursor:'pointer'}}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll}/> (모두 선택)
            </label>
            {filteredVals.length === 0 && (
              <div style={{padding:'8px 8px',color:T.textMuted,fontStyle:'italic'}}>표시할 항목 없음</div>
            )}
            {filteredVals.map(v => (
              <label key={v} style={{display:'flex',alignItems:'center',gap:4,padding:'3px 8px',cursor:'pointer'}}>
                <input type="checkbox" checked={pendingSelected.has(v)} onChange={()=>toggleOne(v)}/>
                <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap', flex:1}} title={branchNameMap?.[v] || v}>
                  {branchNameMap?.[v] || v}
                </span>
              </label>
            ))}
            <label style={{display:'flex',alignItems:'center',gap:4,padding:'4px 8px',
                           borderTop:`1px solid ${T.border}40`, cursor:'pointer', color:T.textMuted, fontStyle:'italic'}}>
              <input type="checkbox" checked={pendingEmpty} onChange={e=>setPendingEmpty(e.target.checked)}/> (필드 값 없음)
            </label>
          </div>
          {columnKey === 'custName' && (
            <label title="한글 0자 + 영문 2자 이상" style={{display:'flex',alignItems:'center',gap:6,padding:'6px 8px',
                           border:`1px solid ${pendingEnOnly?T.primary:T.border}`,
                           background:pendingEnOnly?T.primary+'18':'#fff',
                           color:pendingEnOnly?T.primary:T.text,
                           fontWeight:T.fw.bolder, fontSize:11, borderRadius:4, cursor:'pointer', marginBottom:8}}>
              <input type="checkbox" checked={pendingEnOnly} onChange={e=>setPendingEnOnly(e.target.checked)}/>
              🌐 외국인 고객만 (한글 0 + 영문 2자+)
            </label>
          )}
        </>
      )}

      <div style={{display:'flex', gap:4}}>
        <button onClick={clearFilter}
          style={{flex:1, height:28, fontSize:11, border:`1px solid ${T.border}`, background:'#fff',
                  borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>초기화</button>
        <button onClick={onClose}
          style={{flex:1, height:28, fontSize:11, border:`1px solid ${T.border}`, background:T.gray100,
                  borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>취소</button>
        <button onClick={apply}
          style={{flex:1, height:28, fontSize:11, border:`1px solid ${T.primary}`, background:T.primary,
                  color:'#fff', fontWeight:T.fw.bolder, borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>확인</button>
      </div>
    </div>,
    document.body
  )
}

export function ColHeader({ label, columnKey, type, uniqueValues, filter, onChange, branchNameMap, alignRight }) {
  const btnRef = useRef()
  const [open, setOpen] = useState(false)
  const isActive =
    (filter?.selected instanceof Set) ||
    (filter?.start || filter?.end) ||
    (filter?.min !== '' && filter?.min !== undefined && filter?.min !== null) ||
    (filter?.max !== '' && filter?.max !== undefined && filter?.max !== null) ||
    filter?.includeEmpty === false ||
    filter?.enOnly === true
  const sortDir = filter?.sort

  return (
    <th style={{padding:'8px', fontSize:T.fs.xs, fontWeight:T.fw.bolder, color:T.text, background:T.gray100,
                borderBottom:`2px solid ${T.border}`, textAlign: alignRight ? 'right' : 'left',
                position:'sticky', top:0, zIndex:2, whiteSpace:'nowrap'}}>
      <div style={{display:'flex',alignItems:'center',gap:4, justifyContent: alignRight ? 'flex-end' : 'flex-start'}}>
        <span>{label}{sortDir ? (sortDir==='asc'?' ↑':' ↓') : ''}</span>
        <button ref={btnRef} onClick={()=>setOpen(v=>!v)}
          style={{padding:'2px 5px', fontSize:9, lineHeight:1,
                  border:`1px solid ${isActive?T.primary:T.border}`,
                  background:isActive?T.primary:'#fff',
                  color:isActive?'#fff':T.textSub,
                  borderRadius:3, cursor:'pointer', fontFamily:'inherit', fontWeight:T.fw.bolder}}>▼</button>
      </div>
      {open && (
        <ExcelFilter btnRef={btnRef} columnKey={columnKey} columnLabel={label} type={type}
          uniqueValues={uniqueValues} filter={filter} onChange={onChange}
          onClose={()=>setOpen(false)} branchNameMap={branchNameMap}/>
      )}
    </th>
  )
}

function SalesGridPage({ data, userBranches = [], role }) {
  if (role !== 'super' && role !== 'owner') {
    return <div style={{padding:60, textAlign:'center', color:T.textMuted, fontSize:T.fs.sm,
                        background:'#fff', border:`1px solid ${T.border}`, borderRadius:8}}>
      <div style={{fontSize:32, marginBottom:12}}>🔒</div>
      <div style={{fontWeight:T.fw.bolder, fontSize:T.fs.md, color:T.text, marginBottom:6}}>접근 권한 없음</div>
      <div>그리드 뷰는 대표 권한 계정에서만 사용할 수 있습니다.</div>
    </div>
  }

  const [sales, setSales] = useState([])
  const [extraCustMap, setExtraCustMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(loadFilters())

  useEffect(() => { saveFilters(filters) }, [filters])

  const dateStart = filters.date.start || back(30)
  const dateEnd = filters.date.end || today()

  // 데이터 로드 — 매출일 + 권한 매장 전체
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const branchClause = userBranches.length > 0 ? `&bid=in.(${userBranches.join(',')})` : ''
    const url = `${SB_URL}/rest/v1/sales?business_id=eq.${_activeBizId}&date=gte.${dateStart}&date=lte.${dateEnd}${branchClause}&order=date.desc,created_at.desc&limit=300&select=*`
    fetch(url, { headers: sbHeaders, cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(async rows => {
        if (cancelled) return
        const mapped = fromDb('sales', Array.isArray(rows) ? rows : [])
        if (mapped.length > 0) {
          const ids = mapped.map(s => s.id).filter(Boolean)
          try {
            const dr = await fetch(`${SB_URL}/rest/v1/sale_details?sale_id=in.(${ids.join(',')})&select=sale_id,service_name`, { headers: sbHeaders })
            if (dr.ok) {
              const drows = await dr.json()
              const detailMap = {}
              ;(drows || []).forEach(d => {
                if (!detailMap[d.sale_id]) detailMap[d.sale_id] = []
                if (d.service_name && !d.service_name.startsWith('[')) detailMap[d.sale_id].push(d.service_name)
              })
              mapped.forEach(s => {
                if (detailMap[s.id]) {
                  const detailNames = [...new Set(detailMap[s.id])].join(' + ')
                  if (detailNames) s.serviceName = detailNames
                }
              })
            }
          } catch {}
          // data.customers에 없는 cust_id 직접 fetch (페이지네이션 100명 한계 보강)
          const localCustIds = new Set((data?.customers || []).map(c => c.id))
          const missingIds = [...new Set(mapped.map(s => s.custId).filter(id => id && !localCustIds.has(id)))]
          if (missingIds.length > 0) {
            try {
              const cr = await fetch(`${SB_URL}/rest/v1/customers?id=in.(${missingIds.join(',')})&select=id,cust_num,join_date,created_at`, { headers: sbHeaders })
              if (cr.ok) {
                const crows = await cr.json()
                const m = {}
                ;(crows || []).forEach(c => {
                  m[c.id] = {
                    custNum: c.cust_num || '',
                    joinDate: c.join_date || (c.created_at ? String(c.created_at).slice(0,10) : ''),
                  }
                })
                if (!cancelled) setExtraCustMap(prev => ({ ...prev, ...m }))
              }
            } catch {}
          }
        }
        if (cancelled) return
        setSales(mapped)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setSales([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [dateStart, dateEnd, userBranches.join(','), data?.customers])

  const enriched = useMemo(() => {
    const localMap = {}
    ;(data?.customers || []).forEach(c => {
      localMap[c.id] = {
        custNum: c.custNum || '',
        joinDate: c.joinDate || (c.createdAt ? String(c.createdAt).slice(0,10) : ''),
      }
    })
    return sales.map(s => {
      const c = (s.custId && (localMap[s.custId] || extraCustMap[s.custId])) || null
      const custNum = s.custNum || c?.custNum || ''
      const joinDate = c?.joinDate || ''
      const br = (data?.branches || []).find(b => b.id === s.bid)
      const brName = br?.short || br?.name || ''
      const amt =  // 정책일 이후 매출은 포인트 제외(현금 미수취)
        (s.svcCash||0)+(s.svcCard||0)+(s.svcTransfer||0)+((s.svcPoint||0)-exclPt(s,s.svcPoint))+
        (s.prodCash||0)+(s.prodCard||0)+(s.prodTransfer||0)+((s.prodPoint||0)-exclPt(s,s.prodPoint))+
        (s.externalPrepaid||0)
      return { ...s, _custNum: custNum, _joinDate: joinDate, _brName: brName, _amount: amt }
    })
  }, [sales, data?.customers, data?.branches, extraCustMap])

  const uniqueByCol = useMemo(() => {
    const u = {
      custNum: new Set(), custName: new Set(), custPhone: new Set(),
      service: new Set(), staff: new Set(), bid: new Set(), memo: new Set()
    }
    enriched.forEach(s => {
      if (s._custNum) u.custNum.add(s._custNum)
      if (s.custName) u.custName.add(s.custName)
      if (s.custPhone) u.custPhone.add(s.custPhone)
      if (s.serviceName) u.service.add(s.serviceName)
      if (s.staffName) u.staff.add(s.staffName)
      if (s.bid) u.bid.add(s.bid)
      if (s.memo) u.memo.add(s.memo)
    })
    return Object.fromEntries(Object.entries(u).map(([k, v]) => {
      const arr = [...v]
      arr.sort((a,b) => String(a).localeCompare(String(b), 'ko'))
      return [k, arr]
    }))
  }, [enriched])

  const branchNameMap = useMemo(() => {
    const m = {}
    ;(data?.branches || []).forEach(b => { m[b.id] = b.short || b.name || b.id })
    return m
  }, [data?.branches])

  const matchSet = (val, f) => {
    if (!f) return true
    const isEmpty = !val || (typeof val === 'string' && !val.trim())
    if (isEmpty) return f.includeEmpty !== false
    if (f.selected instanceof Set) return f.selected.has(val)
    return true
  }

  const filtered = useMemo(() => {
    let rows = enriched.filter(s => {
      // 매출일 — 이미 fetch에서 처리. 추가 클라이언트 필터 없음
      if (filters.joinDate.start && (!s._joinDate || s._joinDate < filters.joinDate.start)) return false
      if (filters.joinDate.end && (!s._joinDate || s._joinDate > filters.joinDate.end)) return false
      if (filters.joinDate.includeEmpty === false && !s._joinDate) return false
      if (!matchSet(s._custNum, filters.custNum)) return false
      if (!matchSet(s.custName, filters.custName)) return false
      if (filters.custName.enOnly) {
        const nm = s.custName || ''
        const koCnt = (nm.match(/[가-힣]/g) || []).length
        const enCnt = (nm.match(/[A-Za-z]/g) || []).length
        if (koCnt > 0 || enCnt < 2) return false
      }
      if (!matchSet(s.custPhone, filters.custPhone)) return false
      if (!matchSet(s.serviceName, filters.service)) return false
      if (!matchSet(s.staffName, filters.staff)) return false
      if (!matchSet(s.memo, filters.memo)) return false
      // 매장: bid 자체로 매칭 (브랜치 ID set)
      if (filters.bid.selected instanceof Set) {
        if (!s.bid) { if (filters.bid.includeEmpty === false) return false }
        else if (!filters.bid.selected.has(s.bid)) return false
      } else if (filters.bid.includeEmpty === false && !s.bid) return false
      // 금액
      if (filters.amount.min !== '' && filters.amount.min != null && s._amount < Number(filters.amount.min)) return false
      if (filters.amount.max !== '' && filters.amount.max != null && s._amount > Number(filters.amount.max)) return false
      return true
    })
    // 정렬
    const sortCol = Object.keys(filters).find(k => filters[k]?.sort)
    if (sortCol) {
      const dir = filters[sortCol].sort === 'asc' ? 1 : -1
      const accessor = {
        date: s => s.date || '', custNum: s => s._custNum || '',
        custName: s => s.custName || '', custPhone: s => s.custPhone || '',
        joinDate: s => s._joinDate || '', service: s => s.serviceName || '',
        staff: s => s.staffName || '', bid: s => s._brName || '',
        amount: s => s._amount || 0, memo: s => s.memo || '',
      }[sortCol]
      if (accessor) {
        rows = [...rows].sort((a, b) => {
          const va = accessor(a), vb = accessor(b)
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
          return String(va).localeCompare(String(vb), 'ko') * dir
        })
      }
    }
    return rows
  }, [enriched, filters])

  const setColFilter = (k, v) => setFilters(prev => {
    const merged = { ...prev[k], ...v }
    let next = { ...prev, [k]: merged }
    if (v.sort) {
      Object.keys(next).forEach(otherK => {
        if (otherK !== k && next[otherK]?.sort) next[otherK] = { ...next[otherK], sort: null }
      })
    }
    return next
  })

  const resetAll = () => setFilters(defaultFilters())

  const fmt = (n) => (Math.round(Number(n) || 0)).toLocaleString()
  const downloadCSV = () => {
    if (filtered.length === 0) { alert('다운로드할 데이터가 없습니다.'); return }
    const header = ['매출일', '고객번호', '고객명', '전화', '고객등록일', '시술', '담당', '매장', '금액', '메모']
    const lines = [header.join(',')]
    filtered.forEach(s => {
      const cells = [
        s.date || '',
        s._custNum,
        (s.custName || '').replace(/,/g, ' '),
        s.custPhone || '',
        s._joinDate,
        (s.serviceName || '').replace(/,/g, ' '),
        (s.staffName || '').replace(/,/g, ' '),
        (s._brName || '').replace(/,/g, ' '),
        s._amount,
        (s.memo || '').replace(/[,\n]/g, ' '),
      ]
      lines.push(cells.join(','))
    })
    const csv = '﻿' + lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `매출_${dateStart}_${dateEnd}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const tdStyle = { padding: '6px 8px', borderBottom: `1px solid ${T.border}40`, fontSize: T.fs.xs,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }

  const cols = [
    { k: 'date',     label: '매출일',     type: 'date' },
    { k: 'custNum',  label: '고객번호',   type: 'set' },
    { k: 'custName', label: '고객명',     type: 'set' },
    { k: 'custPhone',label: '전화',       type: 'set' },
    { k: 'joinDate', label: '고객등록일', type: 'date' },
    { k: 'service',  label: '시술',       type: 'set' },
    { k: 'staff',    label: '담당',       type: 'set' },
    { k: 'bid',      label: '매장',       type: 'set' },
    { k: 'amount',   label: '금액',       type: 'number', alignRight: true },
    { k: 'memo',     label: '메모',       type: 'set' },
  ]

  return <div>
    {/* 컴팩트 툴바 */}
    <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:10, padding:'8px 10px',
                 background:T.gray100, borderRadius:6, border:`1px solid ${T.border}`, fontSize:T.fs.xs}}>
      <span style={{fontWeight:T.fw.bolder, color:T.primary}}>
        {filtered.length}건 / {sales.length}
        {sales.length>=300 && <span title="최대 300건만 로드. 매출일 기간을 좁혀주세요" style={{marginLeft:6,fontSize:11,color:T.danger,fontWeight:T.fw.bolder}}>⚠ 300+</span>}
      </span>
      <span style={{color:T.textMuted, fontSize:11}}>각 컬럼 ▼ 버튼 → 검색·정렬·체크박스 필터</span>
      <span style={{flex:1}}/>
      <button onClick={resetAll}
        style={{height:28, padding:'0 12px', fontSize:11, border:`1px solid ${T.border}`,
                background:'#fff', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>↺ 전체 초기화</button>
      <button onClick={downloadCSV} disabled={filtered.length===0}
        style={{height:28, padding:'0 14px', fontSize:11, fontWeight:T.fw.bolder,
                border:`1px solid ${T.success}`, background:T.success+'18', color:T.success,
                borderRadius:4, cursor:filtered.length?'pointer':'not-allowed',
                opacity:filtered.length?1:.4, fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:4}}><I name="download" size={11}/>Excel (CSV)</button>
    </div>

    {/* 그리드 */}
    <div data-allow-select="true"
      style={{overflow:'auto', maxHeight:'calc(100vh - 200px)', background:'#fff',
              border:`1px solid ${T.border}`, borderRadius:6}}>
      <table data-allow-select="true"
        style={{width:'100%', borderCollapse:'collapse', fontSize:T.fs.xs}}>
        <thead>
          <tr>
            {cols.map(col => (
              <ColHeader key={col.k} label={col.label} columnKey={col.k} type={col.type}
                uniqueValues={uniqueByCol[col.k] || []}
                filter={filters[col.k]}
                onChange={v => setColFilter(col.k, v)}
                branchNameMap={col.k==='bid' ? branchNameMap : null}
                alignRight={col.alignRight}/>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={cols.length} style={{padding:24, textAlign:'center', color:T.textMuted}}>로딩 중...</td></tr>
          ) : filtered.length === 0 ? (
            <tr><td colSpan={cols.length} style={{padding:24, textAlign:'center', color:T.textMuted}}>조건에 맞는 매출 없음</td></tr>
          ) : filtered.map((s, i) => (
            <tr key={s.id || i} style={{background: i%2===0?'#fff':'#fafafa'}}>
              <td style={tdStyle}>{s.date || '-'}</td>
              <td style={{...tdStyle, color: s._custNum ? T.textSub : T.gray400}}>{s._custNum || '-'}</td>
              <td style={{...tdStyle, fontWeight:T.fw.bolder}}>{s.custName || '-'}</td>
              <td style={tdStyle}>{s.custPhone || '-'}</td>
              <td style={{...tdStyle, color: s._joinDate ? T.textMuted : T.danger, fontStyle: s._joinDate ? 'normal' : 'italic'}}>{s._joinDate || '(미등록)'}</td>
              <td style={tdStyle} title={s.serviceName}>{s.serviceName || '-'}</td>
              <td style={tdStyle}>{s.staffName || '-'}</td>
              <td style={tdStyle}>{s._brName || '-'}</td>
              <td style={{...tdStyle, textAlign:'right', fontWeight:T.fw.bolder, color: s._amount>0 ? T.text : T.textMuted}}>{fmt(s._amount)}</td>
              <td style={tdStyle} title={s.memo}>{s.memo ? (s.memo.length>30 ? s.memo.slice(0,30)+'…' : s.memo) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
}

export default SalesGridPage
