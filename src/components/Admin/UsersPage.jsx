import React, { useState } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { toDb } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'

const uid = genId;

const DataTable = ({ children, maxH, card=true, style={}, className="" }) => (
  <div
    className={`${card ? "card " : ""}tw${className ? " "+className : ""}`}
    style={{
      overflowX: "auto",
      overflowY: maxH ? "auto" : "visible",
      maxHeight: maxH,
      ...style,
    }}
  >
    <table>{children}</table>
  </div>
);

const Btn = ({ children, variant="primary", size="md", disabled, onClick, style={} }) => {
  const bg = variant==="primary"?"#7c7cc8":variant==="danger"?"#e05555":variant==="ghost"?"transparent":"#f0f0f0";
  const color = variant==="ghost"?"#7c7cc8":variant==="secondary"?"#333":"#fff";
  const border = variant==="ghost"?"1px solid #ddd":"none";
  const pad = size==="sm"?"4px 10px":size==="lg"?"10px 20px":"7px 14px";
  return <button onClick={onClick} disabled={disabled} style={{background:bg,color,border,borderRadius:8,padding:pad,fontSize:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,...style}}>{children}</button>;
};

function UsersPage({ data, setData, bizId }) {
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(null);
  const users = data.users || [];
  const regBranches = (data.branchSettings || data.branches || []).filter(b => b.useYn !== false);

  const startAdd = () => { setEditId("new"); setForm({ name:"", loginId:"", pw:"", role:"staff", branches:[], viewBranches:[] }); };
  const startEdit = (u) => { setEditId(u.id); setForm({ ...u, viewBranches: u.viewBranches||[] }); };
  const save = (finalForm) => {
    const f = finalForm || form;
    if (!f.name || !f.loginId || !f.pw) { alert("이름, 아이디, 비밀번호를 모두 입력하세요."); return; }
    if (f.role === "staff" && (!f.branches || f.branches.length === 0)) { alert("직원은 담당 지점을 1개 이상 선택하세요."); return; }
    const userData = { ...f, viewBranches: f.viewBranches||[], businessId: bizId };
    setData(prev => {
      const us = [...(prev.users || [])];
      if (editId === "new") {
        const newUser = { ...userData, id: "acc_" + uid() };
        us.push(newUser);
        sb.insert("app_users", toDb("app_users", newUser)).catch(console.error);
      } else {
        const idx = us.findIndex(u => u.id === editId);
        if (idx >= 0) { us[idx] = { ...userData }; sb.update("app_users", editId, toDb("app_users", userData)).catch(console.error); }
      }
      return { ...prev, users: us };
    });
    setEditId(null); setForm(null);
  };
  const remove = (id) => {
    setData(prev => ({ ...prev, users: (prev.users || []).filter(u => u.id !== id) }));
    sb.del("app_users", id).catch(console.error);
  };

  return <div>
    <h2 className="page-title">사용자 관리</h2>
    <div style={{display:"flex",gap:T.sp.sm,marginBottom:12}}>
      <Btn variant="primary" onClick={startAdd}><I name="plus" size={12}/> 사용자 추가</Btn>
      <span style={{fontSize:T.fs.sm,color:T.textSub,display:"flex",alignItems:"center"}}>{users.length}개 계정</span>
    </div>
    <DataTable card><thead><tr>
        <th>이름</th><th>아이디</th><th>비밀번호</th><th>유형</th><th>담당 지점</th><th>열람 지점</th><th>관리</th>
      </tr></thead><tbody>
        {users.map(u => {
          if (editId === u.id && form) return <UserEditRow key={u.id} init={form} regBranches={regBranches} allBranches={data.branches||[]} onSave={save} onCancel={()=>{setEditId(null);setForm(null)}} isNew={false}/>;
          const roleLabel = u.role==="owner" ? "대표" : "직원";
          const roleBg = u.role==="owner" ? "#7c7cc815" : T.bg;
          const roleClr = u.role==="owner" ? T.primary : T.gray600;
          return <tr key={u.id}>
            <td style={{fontWeight:T.fw.bold}}>{u.name}</td>
            <td style={{color:T.primary}}>{u.loginId||u.login_id}</td>
            <td style={{color:T.textMuted}}>{"•".repeat((u.pw||u.password||"").length)}</td>
            <td><span style={{fontSize:T.fs.xs,padding:"2px 8px",borderRadius:T.radius.lg,background:roleBg,color:roleClr,fontWeight:T.fw.bold}}>{roleLabel}</span></td>
            <td style={{fontSize:T.fs.xxs,color:T.gray700}}>{u.role==="owner"?"전체 지점":(u.branches||[]).map(bid=>(data.branches||[]).find(b=>b.id===bid)?.short).filter(Boolean).join(", ")}</td>
            <td style={{fontSize:T.fs.xxs,color:T.info}}>{u.role==="owner"?"-":(u.viewBranches||[]).map(bid=>(data.branches||[]).find(b=>b.id===bid)?.short).filter(Boolean).join(", ")||"-"}</td>
            <td style={{display:"flex",gap:T.sp.xs}}>
              <Btn variant="secondary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>startEdit(u)}>수정</Btn>
              <Btn variant="danger" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>remove(u.id)}>삭제</Btn>
            </td>
          </tr>;
        })}
        {editId === "new" && form && <UserEditRow key="new" init={form} regBranches={regBranches} allBranches={data.branches||[]} onSave={save} onCancel={()=>{setEditId(null);setForm(null)}} isNew={true}/>}
      </tbody></DataTable>
    <div style={{marginTop:16,padding:12,background:T.bg,borderRadius:T.radius.md,fontSize:T.fs.xxs,color:T.textSub,lineHeight:1.8}}>
      <b>권한 안내</b><br/>
      · 대표: 전 지점 예약/매출 조회·편집, 사용자·관리설정 접근<br/>
      · 직원: 담당 지점 예약/매출 조회·편집, 열람 지점 타임라인 읽기 전용
    </div>
  </div>;
}

// Separate top-level component — won't re-create on parent re-render
function UserEditRow({ init, regBranches, allBranches, onSave, onCancel, isNew }) {
  const [f, setF] = useState({...init});
  const set = (k, v) => setF(p => ({...p, [k]: v}));

  const MultiSelect = ({selected, onChange, color=T.primary}) => {
    const [open, setOpen] = useState(false);
    const toggle = (bid) => { onChange(selected.includes(bid) ? selected.filter(x=>x!==bid) : [...selected, bid]); };
    const label = selected.length === 0 ? "선택" : regBranches.filter(b=>selected.includes(b.id)).map(b=>b.short||b.name).join(", ");
    return <div style={{position:"relative"}}>
      <div onClick={()=>setOpen(!open)} className="inp" style={{width:140,cursor:"pointer",fontSize:T.fs.xxs,display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:30}}>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:selected.length?T.text:T.gray500}}>{label}</span>
        <span style={{fontSize:T.fs.nano,color:T.gray500}}>{open?<I name="chevU" size={12}/>:<I name="chevD" size={12}/>}</span>
      </div>
      {open && <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.bgCard,border:"1px solid #d0d0d0",borderRadius:T.radius.sm,zIndex:50,maxHeight:160,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,.1)"}}>
        {regBranches.map(b => {
          const on = selected.includes(b.id);
          return <div key={b.id} onClick={()=>toggle(b.id)} style={{padding:"6px 10px",fontSize:T.fs.xxs,cursor:"pointer",display:"flex",alignItems:"center",gap:6,background:on?color+"10":"transparent"}}>
            <div style={{width:14,height:14,borderRadius:T.radius.sm,border:`1.5px solid ${on?color:T.gray400}`,background:on?color:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {on && <span style={{color:T.bgCard,fontSize:T.fs.nano,fontWeight:T.fw.bolder}}><I name="check" size={10}/></span>}
            </div>
            <span style={{color:on?color:T.gray700}}>{b.short||b.name}</span>
          </div>;
        })}
      </div>}
    </div>;
  };

  return <tr style={{background:T.primaryHover}}>
    <td><input className="inp" style={{width:80}} placeholder={isNew?"이름":""} value={f.name} onChange={e=>set("name",e.target.value)}/></td>
    <td><input className="inp" style={{width:80}} placeholder={isNew?"아이디":""} value={f.loginId} onChange={e=>set("loginId",e.target.value)}/></td>
    <td><input className="inp" style={{width:80}} placeholder={isNew?"비밀번호":""} value={f.pw} onChange={e=>set("pw",e.target.value)}/></td>
    <td><select className="inp" style={{width:80}} value={f.role} onChange={e=>set("role",e.target.value)}>
      <option value="owner">대표</option><option value="staff">직원</option>
    </select></td>
    <td>{f.role==="owner" ? <span style={{fontSize:T.fs.xxs,color:T.primary}}>전체 지점</span> :
      <MultiSelect selected={f.branches||[]} onChange={v=>set("branches",v)} color={T.primary}/>}</td>
    <td>{f.role==="owner" ? <span style={{fontSize:T.fs.xxs,color:T.gray500}}>-</span> :
      <MultiSelect selected={f.viewBranches||[]} onChange={v=>set("viewBranches",v)} color={T.info}/>}</td>
    <td style={{display:"flex",gap:T.sp.xs}}>
      <Btn variant="primary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>onSave(f.role==="owner"?{...f,branches:allBranches.map(b=>b.id)}:f)}>{isNew?"추가":"저장"}</Btn>
      <Btn variant="secondary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={onCancel}>취소</Btn>
    </td>
  </tr>;
}

export default UsersPage
