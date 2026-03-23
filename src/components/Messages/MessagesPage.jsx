import { useState, useEffect, useRef } from 'react'
import { T } from '../../lib/constants'
import { supabase, SB_URL, SB_KEY } from '../../lib/supabase'

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

const BR_ACC = {
  'br_4bcauqvrb':'101171979','br_wkqsxj6k1':'102071377',
  'br_l6yzs2pkq':'102507795','br_k57zpkbx1':'101521969',
  'br_lfv2wgdf1':'101522539','br_g768xdu4w':'101517367',
  'br_ybo3rmulv':'101476019','br_xu60omgdf':'101988152'
}

export default function MessagesPage({ data, currentUser, isMaster }) {
  const [convos, setConvos] = useState([])
  const [selConvo, setSelConvo] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef(null)

  const branches = data?.branches || []
  const userBranchIds = isMaster ? branches.map(b=>b.id) : [currentUser?.branch_id].filter(Boolean)
  const accIds = userBranchIds.map(b=>BR_ACC[b]).filter(Boolean)

  // 대화 목록 로드
  const loadConvos = async () => {
    let url = `${SB_URL}/rest/v1/naver_messages?select=account_id,user_id,user_name,direction,message_text,created_at,is_read&order=created_at.desc&limit=500`
    if (accIds.length) url += `&account_id=in.(${accIds.join(',')})`
    const r = await fetch(url, { headers: H })
    const msgs = await r.json()
    if (!Array.isArray(msgs)) { setLoading(false); return }

    // 대화별 최신 메시지 묶기
    const map = {}
    msgs.forEach(m => {
      const key = `${m.account_id}_${m.user_id}`
      if (!map[key]) map[key] = { account_id: m.account_id, user_id: m.user_id, user_name: m.user_name, last_msg: m.message_text, last_time: m.created_at, unread: 0 }
      if (m.direction==='in' && !m.is_read) map[key].unread++
    })
    setConvos(Object.values(map).sort((a,b)=>b.last_time.localeCompare(a.last_time)))
    setLoading(false)
  }

  useEffect(() => {
    loadConvos()
    // Realtime 구독
    const ch = supabase.channel('messages_page')
      .on('postgres_changes', {event:'INSERT',schema:'public',table:'naver_messages'}, loadConvos)
      .on('postgres_changes', {event:'UPDATE',schema:'public',table:'naver_messages'}, loadConvos)
      .subscribe()
    return () => ch.unsubscribe()
  }, [])

  const loadMessages = async (convo) => {
    setSelConvo(convo)
    const r = await fetch(
      `${SB_URL}/rest/v1/naver_messages?account_id=eq.${convo.account_id}&user_id=eq.${convo.user_id}&order=created_at.asc&limit=200`,
      { headers: H }
    )
    const msgs = await r.json()
    setMessages(Array.isArray(msgs) ? msgs : [])
    // 읽음 처리
    await fetch(`${SB_URL}/rest/v1/naver_messages?account_id=eq.${convo.account_id}&user_id=eq.${convo.user_id}&direction=eq.in&is_read=eq.false`,
      { method:'PATCH', headers:{...H,'Content-Type':'application/json','Prefer':'return=minimal'}, body: JSON.stringify({is_read:true}) })
    loadConvos()
    setTimeout(()=>messagesEndRef.current?.scrollIntoView({behavior:'smooth'}), 100)
  }

  const sendMessage = async () => {
    if (!input.trim() || !selConvo) return
    setSending(true)
    try {
      await fetch(`${SB_URL}/rest/v1/send_queue`, {
        method:'POST', headers:{...H,'Content-Type':'application/json','Prefer':'return=minimal'},
        body: JSON.stringify({ account_id: selConvo.account_id, user_id: selConvo.user_id, message: input.trim() })
      })
      setInput('')
      setTimeout(() => loadMessages(selConvo), 1000)
    } finally { setSending(false) }
  }

  const getBranchName = (accId) => {
    const brId = Object.entries(BR_ACC).find(([,a])=>a===accId)?.[0]
    return branches.find(b=>b.id===brId)?.short || accId
  }

  const formatTime = (dt) => {
    const d = new Date(dt)
    const h = d.getHours(), m = d.getMinutes()
    return `${h}:${String(m).padStart(2,'0')}`
  }
  const formatDate = (dt) => {
    const d = new Date(dt)
    return `${d.getMonth()+1}/${d.getDate()}`
  }

  if (selConvo) return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      {/* 채팅 헤더 */}
      <div style={{flexShrink:0,background:T.bgCard,borderBottom:`1px solid ${T.border}`,padding:'10px 12px',display:'flex',alignItems:'center',gap:8}}>
        <button onClick={()=>setSelConvo(null)} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:18}}>‹</button>
        <div style={{flex:1}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>{selConvo.user_name||'고객'}</div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted}}>{getBranchName(selConvo.account_id)}</div>
        </div>
      </div>

      {/* 메시지 목록 */}
      <div style={{flex:1,overflowY:'auto',padding:12,display:'flex',flexDirection:'column',gap:8}}>
        {messages.map((m,i) => {
          const isOut = m.direction==='out'
          return (
            <div key={m.id||i} style={{display:'flex',flexDirection:'column',alignItems:isOut?'flex-end':'flex-start'}}>
              <div style={{maxWidth:'75%',padding:'8px 12px',borderRadius:isOut?`${T.radius.lg}px ${T.radius.lg}px 4px ${T.radius.lg}px`:`${T.radius.lg}px ${T.radius.lg}px ${T.radius.lg}px 4px`,background:isOut?T.primary:T.gray200,color:isOut?'#fff':T.text,fontSize:T.fs.sm,lineHeight:1.5,wordBreak:'break-word'}}>
                {m.message_text || m.text || ''}
              </div>
              {m.translated_text && !isOut && (
                <div style={{maxWidth:'75%',fontSize:T.fs.xs,color:T.textMuted,marginTop:2,padding:'0 4px'}}>{m.translated_text}</div>
              )}
              <div style={{fontSize:9,color:T.textMuted,marginTop:2}}>{formatTime(m.created_at)}</div>
            </div>
          )
        })}
        <div ref={messagesEndRef}/>
      </div>

      {/* 입력창 */}
      <div style={{flexShrink:0,padding:'8px 12px',borderTop:`1px solid ${T.border}`,background:T.bgCard,display:'flex',gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),sendMessage())}
          placeholder="메시지 입력..."
          style={{flex:1,height:40,border:`1px solid ${T.border}`,borderRadius:T.radius.md,padding:'0 12px',fontSize:T.fs.sm,outline:'none'}}/>
        <button onClick={sendMessage} disabled={sending||!input.trim()}
          style={{width:40,height:40,background:T.primary,color:'#fff',border:'none',borderRadius:T.radius.md,cursor:'pointer',opacity:sending||!input.trim()?0.5:1,fontSize:16}}>
          ↑
        </button>
      </div>
    </div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      <div style={{flexShrink:0,padding:'12px 16px',background:T.bgCard,borderBottom:`1px solid ${T.border}`,fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>메시지함</div>
      <div style={{flex:1,overflowY:'auto'}}>
        {loading ? (
          <div style={{padding:40,textAlign:'center',color:T.textMuted}}>로딩중...</div>
        ) : convos.length === 0 ? (
          <div style={{padding:40,textAlign:'center',color:T.textMuted}}>메시지가 없습니다</div>
        ) : convos.map((c,i) => (
          <div key={i} onClick={()=>loadMessages(c)}
            style={{padding:'12px 16px',borderBottom:`1px solid ${T.border}`,background:T.bgCard,display:'flex',gap:10,cursor:'pointer'}}>
            {/* 아바타 */}
            <div style={{width:44,height:44,borderRadius:'50%',background:T.primaryLt,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.primary}}>
              {(c.user_name||'고객').slice(0,2)}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>{c.user_name||'고객'}</span>
                  <span style={{fontSize:T.fs.xs,color:T.textMuted}}>{getBranchName(c.account_id)}</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  {c.unread>0 && <span style={{background:T.danger,color:'#fff',borderRadius:10,padding:'1px 6px',fontSize:10,fontWeight:700}}>{c.unread}</span>}
                  <span style={{fontSize:T.fs.xs,color:T.textMuted}}>{formatDate(c.last_time)}</span>
                </div>
              </div>
              <div style={{fontSize:T.fs.xs,color:T.textSub,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>
                {c.last_msg||''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
