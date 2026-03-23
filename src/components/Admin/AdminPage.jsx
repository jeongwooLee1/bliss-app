import { useState } from 'react'
import { T } from '../../lib/constants'
import { useAuth } from '../../lib/AuthContext'
import BranchSettings from './BranchSettings'
import ServiceSettings from './ServiceSettings'
import WorkerSettings from './WorkerSettings'
import TagSettings from './TagSettings'

const MENU = [
  {section:'사업장 관리', items:[
    {key:'branches', icon:'🏢', label:'지점 관리', desc:'지점 추가·수정·삭제'},
    {key:'workers', icon:'👥', label:'직원 관리', desc:'직원 계정 및 권한 설정'},
    {key:'services', icon:'✂️', label:'시술 상품', desc:'시술 항목 및 가격 설정'},
    {key:'tags', icon:'🏷️', label:'태그 관리', desc:'예약 태그 추가·편집'},
  ]},
  {section:'내 계정', items:[
    {key:'mypage', icon:'👤', label:'마이페이지', desc:'내 계정 정보'},
  ]},
]

export default function AdminPage({ data, setData, currentUser, isMaster, onLogout }) {
  const [tab, setTab] = useState(null)

  if (tab === 'branches') return <BranchSettings data={data} setData={setData} onBack={()=>setTab(null)}/>
  if (tab === 'services') return <ServiceSettings data={data} setData={setData} onBack={()=>setTab(null)}/>
  if (tab === 'workers') return <WorkerSettings data={data} setData={setData} onBack={()=>setTab(null)}/>
  if (tab === 'tags') return <TagSettings data={data} setData={setData} onBack={()=>setTab(null)}/>

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      <div style={{flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:T.bgCard,borderBottom:`1px solid ${T.border}`}}>
        <h2 style={{margin:0,fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.text}}>메뉴</h2>
        <button onClick={onLogout} style={{padding:'6px 12px',borderRadius:T.radius.md,border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:T.fs.xs,color:T.textSub}}>로그아웃</button>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:16}}>
        {/* 현재 사용자 */}
        <div style={{background:T.bgCard,borderRadius:T.radius.lg,padding:16,marginBottom:16,boxShadow:T.shadow.sm}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.text}}>{currentUser?.name||currentUser?.login_id}</div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:2}}>{currentUser?.role} · {currentUser?.branch_id}</div>
        </div>

        {MENU.map(g=>(
          <div key={g.section} style={{marginBottom:20}}>
            <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:8,letterSpacing:.3}}>{g.section}</div>
            <div style={{background:T.bgCard,borderRadius:T.radius.lg,overflow:'hidden',boxShadow:T.shadow.sm}}>
              {g.items.filter(item=>isMaster||item.key==='mypage').map((item,idx,arr)=>(
                <div key={item.key} onClick={()=>setTab(item.key)}
                  style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',cursor:'pointer',borderBottom:idx<arr.length-1?`1px solid ${T.border}`:undefined}}>
                  <div style={{width:40,height:40,borderRadius:10,background:T.primaryHover,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>
                    {item.icon}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.text}}>{item.label}</div>
                    <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:2}}>{item.desc}</div>
                  </div>
                  <div style={{color:T.textMuted,fontSize:16}}>›</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
