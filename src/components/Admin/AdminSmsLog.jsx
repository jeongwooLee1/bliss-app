import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'

/**
 * 직원 직접 발송 SMS 이력 (sms_send_log).
 * AdminAlimtalkLog는 알림톡 큐(자동) 이력, 이 페이지는 직원이 SendSmsModal로 직접 보낸 이력.
 */

function fmtDt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const m = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${m(d.getMonth() + 1)}-${m(d.getDate())} ${m(d.getHours())}:${m(d.getMinutes())}:${m(d.getSeconds())}`
}

function shortPhone(p) {
  if (!p) return ''
  const d = String(p).replace(/[^0-9]/g, '')
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`
  return p
}

export default function AdminSmsLog({ data, userBranches = [] }) {
  const branches = data?.branches || []
  const allowedBranches = useMemo(
    () => branches.filter(b => userBranches.length === 0 || userBranches.includes(b.id)),
    [branches, userBranches]
  )
  const [filterBid, setFilterBid] = useState('')
  const [days, setDays] = useState(7)
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  const branchById = useMemo(() => {
    const m = {}
    branches.forEach(b => { m[b.id] = b })
    return m
  }, [branches])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const since = new Date(Date.now() - days * 86400000).toISOString()
      const allowedIds = allowedBranches.map(b => b.id)
      let q = `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=500`
      if (filterBid) q += `&branch_id=eq.${filterBid}`
      else if (allowedIds.length > 0) q += `&branch_id=in.(${allowedIds.join(',')})`
      const r = await sb.get('sms_send_log', q)
      setRows(Array.isArray(r) ? r : [])
    } catch (e) {
      console.error('[AdminSmsLog] load:', e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [filterBid, days, allowedBranches])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return rows
    return rows.filter(r =>
      [r.phone, r.message, r.user_key, r.msg_key].some(v => String(v || '').toLowerCase().includes(k))
    )
  }, [rows, keyword])

  const summary = useMemo(() => {
    const ok = filtered.filter(r => String(r.result_code || '') === '200' || String(r.result_code || '') === '100').length
    return { total: filtered.length, ok, fail: filtered.length - ok }
  }, [filtered])

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
        <div>
          <div style={{fontSize:18,fontWeight:800,color:T.text,marginBottom:4}}>📤 직원 SMS 발송 이력</div>
          <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>
            직원이 고객관리에서 직접 발송한 SMS (sms_send_log). 자동 알림톡/케어 SMS는 "알림톡·SMS 전송내역"에서 조회.
          </div>
        </div>
        <button onClick={load} style={{padding:'6px 12px',fontSize:12,border:'1px solid '+T.border,background:'#fff',borderRadius:6,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>↻ 새로고침</button>
      </div>

      {/* 필터 */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12,padding:'10px 12px',background:T.gray100,borderRadius:8}}>
        <select value={filterBid} onChange={e=>setFilterBid(e.target.value)}
          style={{padding:'6px 8px',fontSize:12,border:'1px solid '+T.border,borderRadius:6,fontFamily:'inherit'}}>
          <option value="">전체 지점</option>
          {allowedBranches.map(b => <option key={b.id} value={b.id}>{b.short || b.name}</option>)}
        </select>
        <select value={days} onChange={e=>setDays(Number(e.target.value))}
          style={{padding:'6px 8px',fontSize:12,border:'1px solid '+T.border,borderRadius:6,fontFamily:'inherit'}}>
          <option value={1}>최근 1일</option>
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
        </select>
        <input type="text" value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="번호·메시지·msgKey 검색"
          style={{flex:1,minWidth:160,padding:'6px 10px',fontSize:12,border:'1px solid '+T.border,borderRadius:6,fontFamily:'inherit'}}/>
      </div>

      {/* 통계 */}
      <div style={{display:'flex',gap:14,marginBottom:10,fontSize:T.fs.xxs,color:T.textSub}}>
        <span>총 {summary.total}건</span>
        <span style={{color:'#2E7D32'}}>✅ 성공 {summary.ok}</span>
        {summary.fail>0 && <span style={{color:'#C62828'}}>❌ 실패 {summary.fail}</span>}
      </div>

      {/* 테이블 */}
      {loading ? (
        <div style={{padding:'40px 0',textAlign:'center',color:T.textMuted}}>로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{padding:'40px 0',textAlign:'center',color:T.textMuted,fontSize:T.fs.xs}}>발송 이력 없음</div>
      ) : (
        <div style={{border:'1px solid '+T.border,borderRadius:8,overflow:'auto',maxHeight:'70vh'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead style={{position:'sticky',top:0,background:T.gray100,zIndex:1}}>
              <tr>
                <th style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid '+T.border,whiteSpace:'nowrap'}}>발송시각</th>
                <th style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid '+T.border}}>지점</th>
                <th style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid '+T.border}}>발신번호</th>
                <th style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid '+T.border}}>수신자</th>
                <th style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid '+T.border,maxWidth:300}}>메시지</th>
                <th style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid '+T.border}}>결과</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r,i) => {
                const br = branchById[r.branch_id]
                const code = String(r.result_code || '')
                const isOk = code === '200' || code === '100'
                return (
                  <tr key={r.id ?? i} style={{borderBottom:'1px solid '+T.gray100}}>
                    <td style={{padding:'6px 10px',whiteSpace:'nowrap',fontFamily:'monospace'}}>{fmtDt(r.created_at)}</td>
                    <td style={{padding:'6px 10px',whiteSpace:'nowrap'}}>{br?.short || br?.name || r.branch_id}</td>
                    <td style={{padding:'6px 10px',whiteSpace:'nowrap',fontFamily:'monospace'}}>{r.callback}</td>
                    <td style={{padding:'6px 10px',whiteSpace:'nowrap',fontFamily:'monospace'}}>{shortPhone(r.phone)}</td>
                    <td style={{padding:'6px 10px',maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.message}>{r.message}</td>
                    <td style={{padding:'6px 10px'}}>
                      <span style={{fontSize:11,fontWeight:700,padding:'2px 7px',borderRadius:6,background:isOk?'#E8F5E9':'#FFEBEE',color:isOk?'#2E7D32':'#C62828'}}>
                        {isOk?'성공':'실패'} {code}
                      </span>
                      {r.result_desc && <span style={{marginLeft:6,fontSize:11,color:T.textMuted}}>{r.result_desc}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
