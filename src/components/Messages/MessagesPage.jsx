import { useState, useEffect, useRef, useCallback } from 'react'
import { T } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { BUSINESS_ID } from '../../lib/constants'
import Icon from '../common/Icon'

const SB_URL = 'https://dpftlrsuqxqqeouwbfjd.supabase.co'
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnRscnN1cXhxcWVvdXdiZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDU4MjQsImV4cCI6MjA4NzQ4MTgyNH0.iydEkjtPjZ0jXpUUPJben4IWWneDqLomv-HDlcFayE4'
const H = { apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`, 'Content-Type':'application/json' }

const BR_ACC = {
  'br_4bcauqvrb':'101171979','br_wkqsxj6k1':'102071377',
  'br_l6yzs2pkq':'102507795','br_k57zpkbx1':'101521969',
  'br_lfv2wgdf1':'101522539','br_g768xdu4w':'101517367',
  'br_ybo3rmulv':'101476019','br_xu60omgdf':'101988152',
}

export default function MessagesPage({ data, currentUser, isMaster }) {
  const [convos, setConvos] = useState([])   // 대화 목록
  const [selConvo, setSelConvo] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [filterBranch, setFilterBranch] = useState('all')
  const chatEndRef = useRef(null)

  const branches = data?.branches || []
  const userBranches = isMaster ? branches.map(b=>b.id) : [currentUser?.branch_id].filter(Boolean)
  const accIds = userBranches.map(b=>BR_ACC[b]).filter(Boolean)

  // 대화 목록 로드
  const loadConvos = useCallback(async () => {
    let url = `${SB_URL}/rest/v1/naver_messages?select=account_id,user_id,user_name,direction,text,created_at,is_read,translated_text&order=created_at.desc&limit=500`
    if (accIds.length > 0) url += `&account_id=in.(${accIds.join(',')})`

    const res = await fetch(url, { headers: H })
    const rows = await res.json()
    if (!Array.isArray(rows)) return

    // 대화별 최신 메시지로 그룹화
    const map = {}
    rows.forEach(m => {
      const key = `${m.account_id}___${m.user_id}`
      if (!map[key]) map[key] = { ...m, unread:0 }
      if (!m.is_read && m.direction==='in') map[key].unread++
    })
    setConvos(Object.values(map).sort((a,b)=>b.created_at.localeCompare(a.created_at)))
    setLoading(false)
  }, [accIds.join(',')])

  useEffect(() => { loadConvos() }, [loadConvos])

  // Realtime - 새 메시지
  useEffect(() => {
    const ch = supabase.channel('msgs_list')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'naver_messages'},
        () => { loadConvos(); if (selConvo) loadMsgs(selConvo) }
      ).subscribe()
    return () => ch.unsubscribe()
  }, [loadConvos, selConvo])

  const loadMsgs = useCallback(async (convo) => {
    if (!convo) return
    const res = await fetch(
      `${SB_URL}/rest/v1/naver_messages?account_id=eq.${convo.account_id}&user_id=eq.${convo.user_id}&order=created_at.asc&limit=200`,
      { headers: H }
    )
    const rows = await res.json()
    if (Array.isArray(rows)) {
      setMsgs(rows)
      // 읽음 처리
      await fetch(
        `${SB_URL}/rest/v1/naver_messages?account_id=eq.${convo.account_id}&user_id=eq.${convo.user_id}&is_read=eq.false&direction=eq.in`,
        { method:'PATCH', headers:{...H,Prefer:'return=minimal'}, body:JSON.stringify({is_read:true}) }
      )
      setConvos(prev=>prev.map(c=>
        c.account_id===convo.account_id&&c.user_id===convo.user_id ? {...c,unread:0} : c
      ))
    }
  }, [])

  useEffect(() => {
    if (selConvo) {
      loadMsgs(selConvo)
      setTimeout(()=>chatEndRef.current?.scrollIntoView({behavior:'smooth'}),100)
    }
  }, [selConvo, loadMsgs])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({behavior:'smooth'})
  }, [msgs])

  const sendMsg = async () => {
    if (!inputText.trim() || !selConvo || sending) return
    setSending(true)
    try {
      await fetch(`${SB_URL}/rest/v1/send_queue`, {
        method:'POST', headers:{...H,Prefer:'return=minimal'},
        body: JSON.stringify({
          account_id: selConvo.account_id,
          user_id: selConvo.user_id,
          text: inputText.trim(),
          status: 'pending',
        })
      })
      setInputText('')
    } finally { setSending(false) }
  }

  const getBranchName = (accId) => {
    const brId = Object.entries(BR_ACC).find(([,acc])=>acc===accId)?.[0]
    return branches.find(b=>b.id===brId)?.short || accId
  }

  const fmtTime = (dt) => {
    const d = new Date(dt)
    const now = new Date()
    const diffDays = Math.floor((now-d)/(1000*60*60*24))
    if (diffDays===0) return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    if (diffDays===1) return '어제'
    if (diffDays<7) return `${diffDays}일전`
    return `${d.getMonth()+1}/${d.getDate()}`
  }

  // 채팅 화면
  if (selConvo) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100dvh' }}>
        {/* 헤더 */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:T.bgCard, borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
          <button onClick={()=>setSelConvo(null)} style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}>
            <Icon name="chevLeft" size={20} color={T.text}/>
          </button>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:T.fs.sm, fontWeight:T.fw.bold }}>{selConvo.user_name||'고객'}</div>
            <div style={{ fontSize:T.fs.xxs, color:T.textMuted }}>{getBranchName(selConvo.account_id)}</div>
          </div>
        </div>

        {/* 메시지 목록 */}
        <div style={{ flex:1, overflowY:'auto', padding:'12px 12px 8px', display:'flex', flexDirection:'column', gap:8 }}>
          {msgs.map((m,i) => {
            const isOut = m.direction==='out'
            return (
              <div key={i} style={{ display:'flex', justifyContent:isOut?'flex-end':'flex-start' }}>
                <div style={{
                  maxWidth:'78%', padding:'8px 12px',
                  borderRadius: isOut ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isOut ? T.primary : T.bgCard,
                  color: isOut ? '#fff' : T.text,
                  fontSize:T.fs.sm, lineHeight:1.5,
                  boxShadow: T.shadow.sm,
                  border: isOut ? 'none' : `1px solid ${T.border}`,
                }}>
                  <div>{m.text}</div>
                  {m.translated_text && !isOut && (
                    <div style={{ marginTop:4, paddingTop:4, borderTop:`1px solid ${T.border}`, fontSize:T.fs.xxs, color:T.textMuted }}>
                      번역: {m.translated_text}
                    </div>
                  )}
                  <div style={{ fontSize:9, color:isOut?'rgba(255,255,255,0.7)':T.textMuted, marginTop:3, textAlign:isOut?'right':'left' }}>
                    {fmtTime(m.created_at)}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={chatEndRef}/>
        </div>

        {/* 입력창 */}
        <div style={{ padding:'8px 12px', background:T.bgCard, borderTop:`1px solid ${T.border}`, flexShrink:0, paddingBottom:'calc(8px + env(safe-area-inset-bottom))' }}>
          <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
            <textarea
              value={inputText} onChange={e=>setInputText(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg()} }}
              placeholder="메시지 입력..." rows={1}
              style={{ flex:1, border:`1px solid ${T.border}`, borderRadius:T.radius.md, padding:'8px 12px', fontSize:T.fs.sm, outline:'none', resize:'none', maxHeight:100, overflowY:'auto' }}
            />
            <button onClick={sendMsg} disabled={!inputText.trim()||sending} style={{
              width:40, height:40, borderRadius:'50%', background:T.primary, border:'none',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              opacity:(!inputText.trim()||sending)?0.5:1,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 대화 목록
  const filteredConvos = convos.filter(c =>
    filterBranch === 'all' || BR_ACC[filterBranch] === c.account_id
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh' }}>
      <div style={{ padding:'10px 12px', background:T.bgCard, borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <span style={{ fontSize:T.fs.lg, fontWeight:T.fw.bolder }}>메시지함</span>
          <span style={{ fontSize:T.fs.xxs, color:T.textMuted }}>{convos.filter(c=>c.unread>0).length}개 미읽</span>
        </div>
        {isMaster && (
          <div style={{ display:'flex', gap:6, overflowX:'auto' }}>
            <button onClick={()=>setFilterBranch('all')} style={filterBtnStyle(filterBranch==='all',T)}>전체</button>
            {branches.map(b=>(
              <button key={b.id} onClick={()=>setFilterBranch(b.id)} style={{
                ...filterBtnStyle(filterBranch===b.id,T),
                borderColor:filterBranch===b.id?b.color:T.border,
                background:filterBranch===b.id?b.color+'22':T.bgCard,
                color:filterBranch===b.id?b.color:T.textSub,
              }}>{b.short||b.name}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex:1, overflowY:'auto' }}>
        {loading ? (
          <div style={{ padding:40, textAlign:'center', color:T.textMuted }}>로딩중...</div>
        ) : filteredConvos.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:T.textMuted, fontSize:T.fs.sm }}>메시지가 없습니다</div>
        ) : filteredConvos.map((c,i) => {
          const brName = getBranchName(c.account_id)
          const initials = (c.user_name||'고객').slice(0,2)
          const hasUnread = c.unread > 0
          return (
            <div key={i} onClick={()=>setSelConvo(c)} style={{
              display:'flex', gap:12, padding:'12px 14px',
              borderBottom:`1px solid ${T.border}`, cursor:'pointer',
              background: hasUnread ? T.primaryHover : T.bgCard,
            }}>
              {/* 아바타 */}
              <div style={{ width:46, height:46, borderRadius:'50%', background:T.primaryLt, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ fontSize:T.fs.sm, fontWeight:T.fw.bolder, color:T.primary }}>{initials}</span>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:T.fs.sm, fontWeight:hasUnread?T.fw.bolder:T.fw.medium }}>
                    {c.user_name||'고객'} · {brName}
                  </span>
                  <span style={{ fontSize:T.fs.xxs, color:T.textMuted, flexShrink:0 }}>{fmtTime(c.created_at)}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:T.fs.xs, color:T.textSub, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                    {c.direction==='out'?'나: ':''}{c.text||''}
                  </span>
                  {c.unread > 0 && (
                    <span style={{ width:18, height:18, borderRadius:'50%', background:T.danger, color:'#fff', fontSize:10, fontWeight:T.fw.bolder, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginLeft:6 }}>
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const filterBtnStyle = (active,T) => ({
  padding:'3px 10px', borderRadius:T.radius.full, flexShrink:0,
  border:`1px solid ${active?T.primary:T.border}`,
  background:active?T.primaryLt:T.bgCard, color:active?T.primary:T.textSub,
  fontSize:T.fs.xxs, fontWeight:T.fw.bold, cursor:'pointer',
})
