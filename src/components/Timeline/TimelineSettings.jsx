import React from 'react'
import { createPortal } from 'react-dom'
import { T, STATUS_CLR_DEFAULT, STATUS_KEYS, STATUS_LABEL } from '../../lib/constants'
import I from '../common/I'
import ColorField from '../common/ColorField'

function EyeDrop({ onPick, size=26 }) {
  const pick = async () => {
    if (!window.EyeDropper) return;
    try { const r = await new window.EyeDropper().open(); onPick(r.sRGBHex); } catch(e) {}
  };
  if (!window.EyeDropper) return null;
  return <button onClick={pick} style={{width:size,height:size,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}} title="색상 추출"><I name="eyedropper" size={13} color={T.gray600}/></button>;
}

function TimelineSettings({
  showSettings, setShowSettings,
  isMaster, accessibleBids, userBranches, expanded, toggleExpand,
  viewBids, toggleView, allBranchList,
  rowH, setRowH, colW, setColW, blockFs, setBlockFs, blockOp, setBlockOp,
  startHour, setStartHour, endHour, setEndHour,
  timeUnit, setTimeUnit,
  statusClr, setStatusClr,
  salesHighlight = { min: 0, color: "#FFD700", svcIds: [], catIds: [] }, setSalesHighlight,
  tlSharedKeys = {}, setTlSharedKey,
  data,
}) {
  const renderShareCheck = (k) => (setTlSharedKey && isMaster) ? (
    <label key={`sc-${k}`} title="전 지점 공통 적용" style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:9,color:tlSharedKeys[k]?T.primary:T.gray500,cursor:"pointer",marginLeft:4,padding:"0 4px",borderRadius:4,background:tlSharedKeys[k]?T.primaryLt:"transparent",border:`1px solid ${tlSharedKeys[k]?T.primary:T.border}`,flexShrink:0,fontWeight:tlSharedKeys[k]?700:500}}>
      <input type="checkbox" checked={!!tlSharedKeys[k]} onChange={e=>setTlSharedKey(k, e.target.checked)} style={{accentColor:T.primary,width:10,height:10,margin:0}}/>
      🌐
    </label>
  ) : null;

  const [hlSvcOpen, setHlSvcOpen] = React.useState(false);

  // 화면 너비 반응형 — 반드시 early return 위에 위치 (hooks rules)
  const [winW, setWinW] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 모바일 컴팩트 모드용 — 활성 stepper / 색상 항목 선택 (드롭다운 + 우측 컨트롤 패턴)
  const [activeStepperK, setActiveStepperK] = React.useState('rh');
  const [activeColorK, setActiveColorK] = React.useState(STATUS_KEYS[0]);

  const closeWithAnim = React.useCallback(() => {
    const p = document.querySelector('[data-settings-panel]');
    const o = document.querySelector('[data-settings-ov]');
    if (p) { p.style.transition = 'transform .3s ease-out'; p.style.transform = 'translateY(100%)'; }
    if (o) { o.style.transition = 'opacity .3s'; o.style.opacity = '0'; }
    setTimeout(() => setShowSettings(false), 300);
  }, [setShowSettings]);

  React.useEffect(() => {
    if (!showSettings) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeWithAnim(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings, closeWithAnim]);

  if (!showSettings) return null;

  const handleTouchStart = e => {
    const el = e.currentTarget;
    el.dataset.sy = e.touches[0].clientY;
    el.dataset.dragging = "1";
    el.style.transition = "none";
  };
  const handleTouchMove = e => {
    const el = e.currentTarget;
    if (el.dataset.dragging !== "1") return;
    const dy = Math.max(0, e.touches[0].clientY - Number(el.dataset.sy||0));
    el.style.transform = `translateY(${dy}px)`;
    const ov = el.previousElementSibling;
    if (ov) ov.style.opacity = Math.max(0, 1 - dy / 300);
  };
  const handleTouchEnd = e => {
    const el = e.currentTarget;
    el.dataset.dragging = "0";
    const dy = e.changedTouches[0].clientY - Number(el.dataset.sy||0);
    if (dy > 80) {
      el.style.transition = "transform .3s cubic-bezier(.4,0,1,1)";
      el.style.transform = `translateY(${el.offsetHeight}px)`;
      const ov = el.previousElementSibling;
      if (ov) { ov.style.transition = "opacity .3s"; ov.style.opacity = "0"; }
      setTimeout(() => setShowSettings(false), 300);
    } else {
      el.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";
      el.style.transform = "translateY(0)";
      const ov = el.previousElementSibling;
      if (ov) { ov.style.transition = "opacity .25s"; ov.style.opacity = "1"; }
    }
  };

  // 시술/카테고리 데이터 (강조 시술 체크용)
  const _excludedCatNames = new Set(['쿠폰', '포인트']);
  const allCats = (data?.categories || []).filter(c => !_excludedCatNames.has(c.name)).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const allSvcs = (data?.services || []).filter(s => s.isActive !== false).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const svcIds = Array.isArray(salesHighlight.svcIds) ? salesHighlight.svcIds : [];
  const catIds = Array.isArray(salesHighlight.catIds) ? salesHighlight.catIds : [];
  const hlCount = svcIds.length;

  const toggleSvc = (sid) => {
    const next = svcIds.includes(sid) ? svcIds.filter(x=>x!==sid) : [...svcIds, sid];
    const svc = allSvcs.find(s => s.id === sid);
    let nextCats = catIds;
    if (svc) {
      const inCat = allSvcs.filter(s => s.cat === svc.cat).map(s => s.id);
      const allChecked = inCat.every(id => next.includes(id));
      nextCats = allChecked
        ? [...new Set([...catIds, svc.cat])]
        : catIds.filter(c => c !== svc.cat);
    }
    setSalesHighlight({ svcIds: next, catIds: nextCats });
  };
  const toggleCat = (cid) => {
    const inCat = allSvcs.filter(s => s.cat === cid).map(s => s.id);
    const allChecked = inCat.every(id => svcIds.includes(id));
    if (allChecked) {
      setSalesHighlight({ svcIds: svcIds.filter(id => !inCat.includes(id)), catIds: catIds.filter(c => c !== cid) });
    } else {
      setSalesHighlight({ svcIds: [...new Set([...svcIds, ...inCat])], catIds: [...new Set([...catIds, cid])] });
    }
  };

  const cardStyle = { background:T.gray100, borderRadius:T.radius.md, padding:"8px 12px", border:"1px solid "+T.border };
  const lblStyle = { fontSize:T.fs.sm, color:T.gray700, fontWeight:T.fw.bold, display:"inline-flex", alignItems:"center", whiteSpace:"nowrap" };
  const colStyle = { display:"flex", flexDirection:"column", gap:6, minWidth:0 };
  const isNarrow = winW < 640;
  const isVeryNarrow = winW < 380; // 매우 좁은 화면 (작은 폰)

  const stepperCards = [
    {label:"줄간격",k:"rh",val:rowH,dec:()=>setRowH(h=>Math.max(6,h-2)),inc:()=>setRowH(h=>Math.min(30,h+2))},
    {label:"열너비",k:"cw",val:colW,dec:()=>setColW(w=>Math.max(80,w-20)),inc:()=>setColW(w=>Math.min(300,w+20))},
    {label:"글자",k:"fs",val:blockFs,dec:()=>setBlockFs(f=>Math.max(6,f-1)),inc:()=>setBlockFs(f=>Math.min(16,f+1))},
    {label:"불투명도",k:"op",val:blockOp,suffix:"%",dec:()=>setBlockOp(o=>Math.max(10,o-10)),inc:()=>setBlockOp(o=>Math.min(100,o+10))},
    {label:"시작",k:"sh",val:startHour,suffix:"시",dec:()=>setStartHour(h=>Math.max(0,h-1)),inc:()=>setStartHour(h=>Math.min(endHour-1,h+1))},
    {label:"종료",k:"eh",val:endHour,suffix:"시",dec:()=>setEndHour(h=>Math.max(startHour+1,h-1)),inc:()=>setEndHour(h=>Math.min(24,h+1))},
  ];

  return createPortal(<>
    <div style={{position:"fixed",inset:0,width:"100vw",height:"100vh",zIndex:99,background:"rgba(0,0,0,.3)",animation:"ovFadeIn .25s"}} onClick={closeWithAnim} data-settings-ov/>
    <div
      data-settings-panel
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{position:"fixed",bottom:0,left:0,right:0,width:"100vw",boxSizing:"border-box",
      background:T.bgCard,borderRadius:"16px 16px 0 0",padding:"12px 16px calc(16px + 56px + env(safe-area-inset-bottom))",boxShadow:"0 -8px 32px rgba(0,0,0,.15)",zIndex:100,
      maxHeight: isNarrow ? "38vh" : "75vh", overflowY:"auto",overflowX:"hidden",animation:"bottomSheet .4s cubic-bezier(.22,1,.36,1)",willChange:"transform"}}>
      <div style={{width:36,height:4,borderRadius:T.radius.sm,background:T.gray300,margin:"0 auto 8px",cursor:"grab"}}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8}}>
        <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}><I name="settings" size={14}/> 타임라인 설정</div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {isMaster && <div style={{fontSize:9,color:T.textMuted}}>🌐 = 전 지점 공통 적용</div>}
          <button onClick={closeWithAnim} title="닫기 (ESC)"
            style={{width:28,height:28,border:"none",background:T.gray100,borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,color:T.gray600,fontSize:16,lineHeight:1,fontFamily:"inherit",fontWeight:600}}>×</button>
        </div>
      </div>

      {/* 가로 2단 그리드 (모바일에서는 1단으로 stack) */}
      <div style={{display:"grid",gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap:10}}>

        {/* ━━━ 좌측 단 ━━━ */}
        <div style={colStyle}>
          {/* 지점 보기 토글 - staff만 */}
          {!isMaster && accessibleBids.length > userBranches.length && (
            <div style={{...cardStyle,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.gray700}}>타 지점 보기</div>
                <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:2}}>{expanded ? "전 지점 표시 중" : "내 지점만"}</div>
              </div>
              <div onClick={toggleExpand} style={{width:42,height:24,borderRadius:12,background:expanded?T.primary:T.gray300,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                <div style={{position:"absolute",top:3,left:expanded?21:3,width:18,height:18,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,.2)",transition:"left .2s"}}/>
              </div>
            </div>
          )}

          {/* 지점별 표시 — 모바일에선 가로 스크롤 한 줄, PC는 wrap */}
          {allBranchList && allBranchList.length > 1 && (
            <div style={{...cardStyle,display:"flex",alignItems:"center",gap:8,flexWrap:isNarrow?"nowrap":"wrap",minWidth:0}}>
              <span style={{...lblStyle,flexShrink:0}}>지점</span>
              <div style={{display:"flex",flexWrap:isNarrow?"nowrap":"wrap",gap:5,overflowX:isNarrow?"auto":"visible",minWidth:0,WebkitOverflowScrolling:"touch"}}>
                {allBranchList.filter(b => isMaster || accessibleBids.includes(b.id)).map(b => {
                  const on = (viewBids||[]).includes(b.id);
                  return <button key={b.id} onClick={()=>toggleView(b.id)}
                    style={{padding:"4px 10px",fontSize:T.fs.sm,border:"1px solid "+(on?T.primary:"#ddd"),borderRadius:T.radius.md,
                      background:on?T.primary:T.bgCard,color:on?"#fff":T.gray600,fontWeight:on?700:400,cursor:"pointer",transition:"all .15s",flexShrink:0,whiteSpace:"nowrap"}}>
                    {(b.short||b.name||"").replace(/하우스왁싱\s*/,"")}
                  </button>;
                })}
              </div>
            </div>
          )}

          {/* 6 stepper 항목 — 모바일(<640): 드롭다운 1개 + 우측 조절 (컴팩트) / PC: 2열 그리드 */}
          {isNarrow ? (() => {
            const r = stepperCards.find(s => s.k === activeStepperK) || stepperCards[0];
            return (
              <div style={{...cardStyle,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                <select value={activeStepperK} onChange={e => setActiveStepperK(e.target.value)}
                  style={{flex:1,minWidth:0,padding:"6px 8px",fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.gray700,border:"1px solid "+T.border,borderRadius:T.radius.md,background:T.bgCard,fontFamily:"inherit"}}>
                  {stepperCards.map(s => <option key={s.k} value={s.k}>{s.label}</option>)}
                </select>
                <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                  <button onClick={r.dec} style={{width:30,height:30,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}><I name="minus" size={14} color={T.gray700}/></button>
                  <span style={{fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bolder,minWidth:42,textAlign:"center"}}>{r.val}{r.suffix||""}</span>
                  <button onClick={r.inc} style={{width:30,height:30,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}><I name="plus" size={14} color={T.gray700}/></button>
                </div>
              </div>
            );
          })() : (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {stepperCards.map(r => (
                <div key={r.label} style={{...cardStyle,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <span style={lblStyle}>{r.label}{renderShareCheck(r.k)}</span>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <button onClick={r.dec} style={{width:26,height:26,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}><I name="minus" size={14} color={T.gray700}/></button>
                    <span style={{fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bolder,minWidth:36,textAlign:"center"}}>{r.val}{r.suffix||""}</span>
                    <button onClick={r.inc} style={{width:26,height:26,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}><I name="plus" size={14} color={T.gray700}/></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 시간단위 — 모바일에선 드롭다운, PC는 라디오 버튼 */}
          <div style={{...cardStyle,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <span style={lblStyle}>시간단위{renderShareCheck("tu")}</span>
            {isNarrow ? (
              <select value={timeUnit} onChange={e=>setTimeUnit(Number(e.target.value))}
                style={{padding:"6px 8px",fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.primary,border:"1px solid "+T.border,borderRadius:T.radius.md,background:T.bgCard,fontFamily:"inherit",minWidth:70}}>
                {[5,10,15,30,60].map(u => <option key={u} value={u}>{u}분</option>)}
              </select>
            ) : (
              <div style={{display:"flex",gap:4}}>
                {[5,10,15,30,60].map(u=><button key={u} onClick={()=>setTimeUnit(u)}
                  style={{padding:"4px 10px",fontSize:T.fs.sm,border:"1px solid #ddd",borderRadius:T.radius.md,background:timeUnit===u?T.primary:T.bgCard,
                    color:timeUnit===u?T.bgCard:T.gray600,fontWeight:timeUnit===u?700:400,cursor:"pointer"}}>{u}분</button>)}
              </div>
            )}
          </div>
        </div>

        {/* ━━━ 우측 단 ━━━ */}
        <div style={colStyle}>
          {/* 매출 강조 — 2줄: (1)매출 라벨+금액+OR+시술 / (2)색+모드+끄기 */}
          {setSalesHighlight && <div style={cardStyle}>
            <div style={{display:"flex",alignItems:"center",gap:isNarrow?4:8,flexWrap:"wrap"}}>
              <span style={lblStyle}>매출 강조{renderShareCheck("hl")}</span>
              <span style={{fontSize:T.fs.xs,color:T.textMuted}}>≥</span>
              <input type="number" min={0} step={10000} value={salesHighlight.min||0}
                onChange={e=>setSalesHighlight({min: Math.max(0, Number(e.target.value)||0)})}
                style={{width:isNarrow?80:100,padding:"4px 6px",fontSize:T.fs.xs,border:"1px solid #ddd",borderRadius:T.radius.md,fontFamily:"inherit",textAlign:"right"}}/>
              <span style={{fontSize:T.fs.xs,color:T.textMuted}}>원</span>
              <span style={{fontSize:9,fontWeight:T.fw.bolder,color:T.primary,padding:"2px 6px",background:T.primaryLt,borderRadius:T.radius.sm,letterSpacing:.5}}>OR</span>
              <button onClick={()=>setHlSvcOpen(o=>!o)}
                style={{padding:"3px 8px",fontSize:T.fs.xs,border:"1px solid "+(hlCount>0?T.primary:"#ddd"),borderRadius:T.radius.md,
                  background:hlCount>0?T.primaryLt:T.bgCard,color:hlCount>0?T.primary:T.gray600,fontWeight:hlCount>0?700:500,cursor:"pointer",fontFamily:"inherit"}}>
                시술 {hlSvcOpen?"▲":"▼"}{hlCount>0 ? `(${hlCount})` : ""}
              </button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6,flexWrap:"wrap"}}>
              <ColorField value={salesHighlight.color||"#FFD700"}
                onChange={c=>setSalesHighlight({color: c})}
                swatchStyle={{width:32,height:26,border:"1px solid #ddd",borderRadius:T.radius.md}}/>
              <EyeDrop onPick={c=>setSalesHighlight({color:c})} size={26}/>
              {[{k:"border",label:"테두리"},{k:"fill",label:"채우기"}].map(opt => {
                const on = (salesHighlight.mode || "border") === opt.k;
                return <button key={opt.k} onClick={()=>setSalesHighlight({mode: opt.k})}
                  style={{padding:"3px 8px",fontSize:T.fs.xs,border:"1px solid "+(on?T.primary:"#ddd"),borderRadius:T.radius.md,
                    background:on?T.primary:T.bgCard,color:on?"#fff":T.gray600,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit"}}>{opt.label}</button>;
              })}
              {(salesHighlight.min > 0 || hlCount > 0) && <button onClick={()=>setSalesHighlight({min:0, svcIds:[], catIds:[]})}
                style={{padding:"3px 8px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.md,background:T.bgCard,color:T.gray600,cursor:"pointer",fontFamily:"inherit"}}>끄기</button>}
            </div>
            {hlSvcOpen && <div style={{marginTop:8,padding:"8px 10px",background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md,maxHeight:240,overflowY:"auto"}}>
              {allCats.length === 0 ? <div style={{fontSize:T.fs.xs,color:T.textMuted,textAlign:"center",padding:8}}>카테고리 없음</div>
                : allCats.map(c => {
                  const inCat = allSvcs.filter(s => s.cat === c.id);
                  const checkedInCat = inCat.filter(s => svcIds.includes(s.id)).length;
                  const catChecked = inCat.length > 0 && checkedInCat === inCat.length;
                  const partial = checkedInCat > 0 && checkedInCat < inCat.length;
                  return <div key={c.id} style={{marginBottom:6}}>
                    <label style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.gray700}}>
                      <input type="checkbox" checked={catChecked} ref={el=>{ if(el) el.indeterminate = partial; }}
                        onChange={()=>toggleCat(c.id)} style={{accentColor:T.primary,width:13,height:13,margin:0}}/>
                      {c.name} <span style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:400}}>({checkedInCat}/{inCat.length})</span>
                    </label>
                    {inCat.length > 0 && <div style={{display:"flex",flexWrap:"wrap",gap:"2px 10px",paddingLeft:20,marginTop:3}}>
                      {inCat.map(s => <label key={s.id} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:T.fs.xs,color:T.gray600}}>
                        <input type="checkbox" checked={svcIds.includes(s.id)} onChange={()=>toggleSvc(s.id)} style={{accentColor:T.primary,width:12,height:12,margin:0}}/>
                        {s.name}
                      </label>)}
                    </div>}
                  </div>;
                })}
            </div>}
          </div>}

          {/* 예약상태 색상 — 모바일(<640): 드롭다운 1개 + 우측 색상 / PC: 2열 그리드 */}
          <div style={cardStyle}>
            <div style={{...lblStyle,marginBottom:8}}>예약상태 색상{renderShareCheck("sc")}</div>
            {isNarrow ? (() => {
              const k = activeColorK;
              return (
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <select value={activeColorK} onChange={e => setActiveColorK(e.target.value)}
                    style={{flex:1,minWidth:0,padding:"6px 8px",fontSize:T.fs.sm,fontWeight:T.fw.bold,color:statusClr[k]||STATUS_CLR_DEFAULT[k],border:"1px solid "+T.border,borderRadius:T.radius.md,background:T.bgCard,fontFamily:"inherit"}}>
                    {STATUS_KEYS.map(sk => <option key={sk} value={sk}>{STATUS_LABEL[sk]}</option>)}
                  </select>
                  <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                    <ColorField value={statusClr[k]||STATUS_CLR_DEFAULT[k]} onChange={c=>setStatusClr(k,c)}
                      swatchStyle={{width:42,height:32,border:"1px solid #ddd",borderRadius:T.radius.md}}/>
                    <EyeDrop onPick={c=>setStatusClr(k,c)} size={32}/>
                  </div>
                </div>
              );
            })() : (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {STATUS_KEYS.map(k=><div key={k} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,padding:"4px 8px",background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md}}>
                  <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:statusClr[k]}}>{STATUS_LABEL[k]}</span>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <ColorField value={statusClr[k]||STATUS_CLR_DEFAULT[k]} onChange={c=>setStatusClr(k,c)}
                      swatchStyle={{width:34,height:28,border:"1px solid #ddd",borderRadius:T.radius.md}}/>
                    <EyeDrop onPick={c=>setStatusClr(k,c)} size={28}/>
                  </div>
                </div>)}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  </>, document.body);
}

export default TimelineSettings
