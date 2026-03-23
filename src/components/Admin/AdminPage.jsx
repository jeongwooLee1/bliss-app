import { useState } from 'react'
import { T } from '../../lib/constants'
import Icon from '../common/Icon'
import BranchSettings from './BranchSettings'
import ServiceSettings from './ServiceSettings'
import TagSettings from './TagSettings'
import WorkerSettings from './WorkerSettings'

const MENU = [
  { key:'places',   icon:'settings', label:'예약장소 관리',   desc:'지점 추가·수정·삭제' },
  { key:'workers',  icon:'user',     label:'담당자 관리',     desc:'직원 계정 및 권한 설정' },
  { key:'services', icon:'tag',      label:'시술 상품 관리',  desc:'시술 항목 및 가격 설정' },
  { key:'tags',     icon:'tag',      label:'태그 관리',       desc:'예약 태그 추가·편집' },
]

export default function AdminPage({ data, setData, currentUser, isMaster, onLogout }) {
  const [tab, setTab] = useState(null)

  if (tab === 'places') return <BranchSettings data={data} setData={setData} onBack={()=>setTab(null)}/>
  if (tab === 'workers') return <WorkerSettings data={data} setData={setData} onBack={()=>setTab(null)}/>
  if (tab === 'services') return <ServiceSettings data={data} setData={setData} onBack={()=>setTab(null)}/>
  if (tab === 'tags') return <TagSettings data={data} setData={setData} onBack={()=>setTab(null)}/>

  return (
    <div style={{ padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <h2 style={{ margin:0, fontSize:T.fs.xl, fontWeight:T.fw.black }}>메뉴</h2>
        <button onClick={onLogout} style={{ padding:'6px 14px', borderRadius:T.radius.md, border:`1px solid ${T.border}`, background:'none', cursor:'pointer', fontSize:T.fs.xs, color:T.textSub }}>
          로그아웃
        </button>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {MENU.map(item => (
          <button key={item.key} onClick={()=>isMaster&&setTab(item.key)} style={{
            display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
            background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:T.radius.lg,
            cursor:isMaster?'pointer':'default', textAlign:'left', width:'100%',
            opacity:isMaster?1:0.5,
          }}>
            <div style={{ width:40, height:40, borderRadius:10, background:T.primaryHover, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Icon name={item.icon} size={18} color={T.primary}/>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:T.fs.sm, fontWeight:T.fw.bold, color:T.text }}>{item.label}</div>
              <div style={{ fontSize:T.fs.xs, color:T.textMuted, marginTop:2 }}>{item.desc}</div>
            </div>
            <Icon name="chevRight" size={16} color={T.textMuted}/>
          </button>
        ))}
      </div>

      <div style={{ marginTop:16, padding:'12px 0', borderTop:`1px solid ${T.border}`, fontSize:T.fs.xs, color:T.textMuted, textAlign:'center' }}>
        {currentUser?.name} ({currentUser?.role})
      </div>
    </div>
  )
}
