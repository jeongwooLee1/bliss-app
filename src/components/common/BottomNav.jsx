import { T } from '../../lib/constants'

const ICONS = {
  timeline: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  reservations: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>,
  messages: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  schedule: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  admin: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
}

export default function BottomNav({ page, setPage, isMaster, unreadCount=0 }) {
  const items = [
    {id:'timeline', label:'타임라인'},
    {id:'reservations', label:'예약목록'},
    {id:'messages', label:'메시지함', badge: unreadCount},
    ...(isMaster?[{id:'schedule',label:'근무표'}]:[]),
    {id:'admin', label:'메뉴'},
  ]

  return (
    <nav style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:T.bgCard,borderTop:`1px solid ${T.border}`,display:'flex',zIndex:100,paddingBottom:'env(safe-area-inset-bottom)'}}>
      {items.map(item=>{
        const active=page===item.id
        return (
          <button key={item.id} onClick={()=>setPage(item.id)}
            style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'8px 0',border:'none',background:'none',cursor:'pointer',color:active?T.primary:T.gray500}}>
            <div style={{position:'relative',width:24,height:24,display:'flex',alignItems:'center',justifyContent:'center'}}>
              {ICONS[item.id]}
              {item.badge>0 && page!==item.id && (
                <span style={{position:'absolute',top:-4,right:-6,background:T.danger,color:'#fff',borderRadius:10,padding:'1px 5px',fontSize:9,fontWeight:700,minWidth:16,textAlign:'center'}}>
                  {item.badge>99?'99+':item.badge}
                </span>
              )}
            </div>
            <span style={{fontSize:10,fontWeight:active?T.fw.bolder:T.fw.medium,marginTop:2}}>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
