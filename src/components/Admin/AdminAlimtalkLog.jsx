import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'

/**
 * 알림톡/SMS 전송 내역 조회.
 * alimtalk_queue: 알림톡(channel='alimtalk') + SMS(channel='sms') 모두 같은 큐에 적재됨.
 * 필터: 지점 / 채널 / 상태 / 종류 / 기간(최근 N일)
 */

const NOTI_LABELS = {
  rsv_confirm: '예약확정',
  rsv_change: '예약변경',
  rsv_cancel: '예약취소',
  rsv_1day: '하루전 리마인드',
  rsv_today: '당일 리마인드',
  rsv_aftercare: '사후관리',
  tkt_charge: '선불권 충전',
  tkt_pay: '선불권 사용',
  pkg_charge: '패키지 구매',
  pkg_pay: '패키지 사용',
  annual_reg: '연간권 등록',
  pt_earn: '포인트 적립',
  pt_use: '포인트 사용',
  tkt_exp_1m: '선불권 만기 1개월',
  tkt_exp_1w: '선불권 만기 1주',
  pkg_exp_1m: '패키지 만기 1개월',
  pkg_exp_1w: '패키지 만기 1주',
  after_5d: '시술후 5일',
  after_10d: '시술후 10일',
  after_21d: '시술후 21일',
  after_35d: '시술후 35일',
  after_53d: '시술후 53일',
}

const STATUS_BADGE = {
  done:    { bg: '#E8F5E9', fg: '#2E7D32', label: '성공' },
  pending: { bg: '#FFF8E1', fg: '#F57F17', label: '대기' },
  failed:  { bg: '#FFEBEE', fg: '#C62828', label: '실패' },
}

const CHANNEL_LABEL = {
  alimtalk: { fg: '#FEE500', text: '카카오 알림톡', bg: '#3C1E1E' },
  sms:      { fg: '#1976D2', text: 'SMS', bg: '#E3F2FD' },
}

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

function resultSummary(row) {
  const r = row.result
  if (!r || typeof r !== 'object') return ''
  if (row.status === 'done') return r.message || '성공'
  if (r.skipped) return `skip: ${r.skipped}`
  if (r.message) return `${r.code != null ? `[${r.code}] ` : ''}${r.message}`
  return JSON.stringify(r).slice(0, 200)
}

export default function AdminAlimtalkLog({ data, userBranches }) {
  const branches = useMemo(() => {
    const all = data?.branches || []
    if (Array.isArray(userBranches) && userBranches.length > 0) {
      return all.filter(b => userBranches.includes(b.id))
    }
    return all
  }, [data?.branches, userBranches])

  const branchMap = useMemo(() => {
    const m = {}
    ;(data?.branches || []).forEach(b => { m[b.id] = b.name || b.id })
    return m
  }, [data?.branches])

  const [days, setDays] = useState(7)
  const [branchFilter, setBranchFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [keyFilter, setKeyFilter] = useState('')
  const [search, setSearch] = useState('') // phone or noti_key partial
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const since = new Date(Date.now() - days * 86400000).toISOString()
      let q = `&created_at=gte.${since}&order=id.desc&limit=500`
      if (branchFilter) q += `&branch_id=eq.${branchFilter}`
      else if (branches.length > 0) {
        const ids = branches.map(b => b.id).join(',')
        q += `&branch_id=in.(${ids})`
      }
      if (channelFilter) q += `&channel=eq.${channelFilter}`
      if (statusFilter) q += `&status=eq.${statusFilter}`
      if (keyFilter) q += `&noti_key=eq.${keyFilter}`
      const r = await sb.get('alimtalk_queue', q)
      setRows(Array.isArray(r) ? r : [])
    } catch (e) {
      console.error('[alimtalk-log] load', e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [days, branchFilter, channelFilter, statusFilter, keyFilter, branches])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const s = search.trim().toLowerCase()
    return rows.filter(r => {
      const phone = (r.phone || '').toLowerCase()
      const key = (r.noti_key || '').toLowerCase()
      const params = JSON.stringify(r.params || {}).toLowerCase()
      return phone.includes(s) || key.includes(s) || params.includes(s)
    })
  }, [rows, search])

  const stats = useMemo(() => {
    const total = filtered.length
    const done = filtered.filter(r => r.status === 'done').length
    const failed = filtered.filter(r => r.status === 'failed').length
    const pending = filtered.filter(r => r.status === 'pending').length
    return { total, done, failed, pending }
  }, [filtered])

  // 사용 중인 noti_key 목록 (드롭다운용)
  const keyOptions = useMemo(() => {
    const set = new Set()
    rows.forEach(r => r.noti_key && set.add(r.noti_key))
    return Array.from(set).sort()
  }, [rows])

  return (
    <div style={{ padding: T.sp.md, maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: T.fs.lg, fontWeight: T.fw.black, color: T.text }}>📨 알림톡·SMS 전송 내역</h3>
        <button onClick={load} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: T.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          {loading ? '로딩…' : '🔄 새로고침'}
        </button>
      </div>

      {/* 필터 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, padding: 10, background: T.gray100, borderRadius: 8 }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          style={{ padding: '6px 10px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 4 }}>
          <option value={1}>최근 1일</option>
          <option value={3}>최근 3일</option>
          <option value={7}>최근 7일</option>
          <option value={14}>최근 14일</option>
          <option value={30}>최근 30일</option>
        </select>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 4, minWidth: 120 }}>
          <option value="">전체 지점</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 4 }}>
          <option value="">전체 채널</option>
          <option value="alimtalk">알림톡</option>
          <option value="sms">SMS</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 4 }}>
          <option value="">전체 상태</option>
          <option value="done">성공</option>
          <option value="failed">실패</option>
          <option value="pending">대기</option>
        </select>
        <select value={keyFilter} onChange={e => setKeyFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 4, minWidth: 140 }}>
          <option value="">전체 종류</option>
          {keyOptions.map(k => <option key={k} value={k}>{NOTI_LABELS[k] || k}</option>)}
        </select>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="전화번호·내용 검색"
          style={{ flex: 1, minWidth: 140, padding: '6px 10px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 4 }} />
      </div>

      {/* 통계 */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 13 }}>
        <span><b>총</b> {stats.total}</span>
        <span style={{ color: '#2E7D32' }}>✅ 성공 {stats.done}</span>
        <span style={{ color: '#C62828' }}>❌ 실패 {stats.failed}</span>
        <span style={{ color: '#F57F17' }}>⏳ 대기 {stats.pending}</span>
        {stats.total > 0 && <span style={{ color: T.textSub }}>(성공률 {Math.round(stats.done / stats.total * 100)}%)</span>}
      </div>

      {/* 표 */}
      <div style={{ overflow: 'auto', border: '1px solid ' + T.border, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: T.gray100, position: 'sticky', top: 0 }}>
            <tr>
              <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap', minWidth: 140 }}>일시</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>지점</th>
              <th style={{ padding: '8px 6px', textAlign: 'center', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>채널</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>종류</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>수신자</th>
              <th style={{ padding: '8px 6px', textAlign: 'center', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>상태</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: '1px solid ' + T.border }}>결과 / 메시지</th>
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: T.textMuted }}>로딩 중…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: T.textMuted }}>조건에 맞는 내역이 없습니다.</td></tr>
            )}
            {filtered.map(r => {
              const sb_ = STATUS_BADGE[r.status] || { bg: '#EEE', fg: '#666', label: r.status || '?' }
              const ch = r.channel || 'alimtalk'
              const chConf = CHANNEL_LABEL[ch] || { bg: '#EEE', fg: '#666', text: ch }
              const isOpen = openId === r.id
              return (
                <React.Fragment key={r.id}>
                  <tr onClick={() => setOpenId(isOpen ? null : r.id)} style={{ cursor: 'pointer', background: isOpen ? T.primaryHover : 'transparent' }}>
                    <td style={{ padding: '6px', borderBottom: '1px solid ' + T.border, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDt(r.created_at)}</td>
                    <td style={{ padding: '6px', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>{branchMap[r.branch_id] || r.branch_id || '-'}</td>
                    <td style={{ padding: '6px', borderBottom: '1px solid ' + T.border, textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 700, borderRadius: 10, color: chConf.fg, background: chConf.bg }}>{chConf.text}</span>
                    </td>
                    <td style={{ padding: '6px', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>{NOTI_LABELS[r.noti_key] || r.noti_key}</td>
                    <td style={{ padding: '6px', borderBottom: '1px solid ' + T.border, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{shortPhone(r.phone)}</td>
                    <td style={{ padding: '6px', borderBottom: '1px solid ' + T.border, textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 700, borderRadius: 10, color: sb_.fg, background: sb_.bg }}>{sb_.label}</span>
                    </td>
                    <td style={{ padding: '6px', borderBottom: '1px solid ' + T.border, color: r.status === 'failed' ? T.danger : T.textSub, fontSize: 11, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resultSummary(r)}</td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={7} style={{ padding: '10px 14px', background: T.gray100, borderBottom: '1px solid ' + T.border }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 11 }}>
                        <div>
                          <div style={{ fontWeight: 800, marginBottom: 6, color: T.textSub }}>params</div>
                          <pre style={{ margin: 0, background: '#fff', padding: 8, borderRadius: 4, border: '1px solid ' + T.border, maxHeight: 200, overflow: 'auto', fontSize: 10 }}>{JSON.stringify(r.params || {}, null, 2)}</pre>
                        </div>
                        <div>
                          <div style={{ fontWeight: 800, marginBottom: 6, color: T.textSub }}>result</div>
                          <pre style={{ margin: 0, background: '#fff', padding: 8, borderRadius: 4, border: '1px solid ' + T.border, maxHeight: 200, overflow: 'auto', fontSize: 10 }}>{JSON.stringify(r.result || {}, null, 2)}</pre>
                        </div>
                      </div>
                      {r.processed_at && <div style={{ marginTop: 8, fontSize: 11, color: T.textSub }}>처리 시각: {fmtDt(r.processed_at)}</div>}
                    </td></tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 500 && (
        <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted, textAlign: 'center' }}>
          ※ 최대 500건까지 표시. 기간을 좁혀서 다시 조회해주세요.
        </div>
      )}
    </div>
  )
}
