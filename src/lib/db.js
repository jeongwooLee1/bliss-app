// DB utilities (원본 index.html L49~149 그대로)

export const DBMAP = {
  reservations:{business_id:"businessId",room_id:"roomId",cust_id:"custId",cust_name:"custName",cust_phone:"custPhone",cust_gender:"custGender",staff_id:"staffId",service_id:"serviceId",end_time:"endTime",is_schedule:"isSchedule",is_new_cust:"isNewCust",selected_tags:"selectedTags",selected_services:"selectedServices",repeat_group_id:"repeatSourceId",repeat_until:"repeatUntil",reservation_id:"reservationId",updated_at:"_ua",source:"source",request_msg:"requestMsg",owner_comment:"ownerComment",is_prepaid:"isPrepaid",npay_method:"npayMethod",total_price:"totalPrice",visit_count:"visitCount",no_show_count:"noShowCount",is_scraping_done:"isScrapingDone",naver_reg_dt:"naverRegDt",naver_confirmed_dt:"naverConfirmedDt",naver_cancelled_dt:"naverCancelledDt",prev_reservation_id:"prevReservationId",visitor_name:"visitorName",visitor_phone:"visitorPhone",chat_channel:"chatChannel",chat_account_id:"chatAccountId",chat_user_id:"chatUserId",cust_email:"custEmail",external_prepaid:"externalPrepaid",external_platform:"externalPlatform",schedule_log:"scheduleLog"},
  sales:{business_id:"businessId",cust_id:"custId",cust_name:"custName",cust_phone:"custPhone",cust_gender:"custGender",cust_num:"custNum",staff_id:"staffId",staff_name:"staffName",service_id:"serviceId",service_name:"serviceName",product_id:"productId",product_name:"productName",svc_cash:"svcCash",svc_transfer:"svcTransfer",svc_card:"svcCard",svc_point:"svcPoint",svc_comped:"svcComped",prod_cash:"prodCash",prod_transfer:"prodTransfer",prod_card:"prodCard",prod_point:"prodPoint",prod_comped:"prodComped",order_num:"orderNum",reservation_id:"reservationId",external_prepaid:"externalPrepaid",external_platform:"externalPlatform"},
  customers:{business_id:"businessId",last_visit:"lastVisit",cust_num:"custNum",cust_num2:"custNum2",phone2:"phone2",is_hidden:"isHidden",created_at:"createdAt",join_date:"joinDate",sms_consent:"smsConsent",email:"email",sns_accounts:"snsAccounts",cancel_penalty_count:"cancelPenaltyCount",no_show_count:"noShowCount"},
  service_tags:{business_id:"businessId",schedule_yn:"scheduleYn",use_yn:"useYn"},
  services:{business_id:"businessId",price_f:"priceF",price_m:"priceM",member_price_f:"memberPriceF",member_price_m:"memberPriceM",is_package:"isPackage",pkg_count:"pkgCount",pkg_price_f:"pkgPriceF",pkg_price_m:"pkgPriceM",badge_text:"badgeText",badge_color:"badgeColor",badge_bg:"badgeBg",promo_config:"promoConfig",is_active:"isActive",grants_member_price:"grantsMemberPrice",price_tiers:"priceTiers"},
  app_users:{business_id:"businessId",login_id:"loginId",branch_ids:"branches",password:"pw",view_branch_ids:"viewBranches"},
  branches:{business_id:"businessId",use_yn:"useYn",naver_email:"naverEmail",naver_biz_id:"naverBizId",naver_col_count:"naverColCount",noti_config:"notiConfig",staff_col_count:"staffColCount",naver_account_id:"naverAccountId",instagram_account_id:"instagramAccountId",whatsapp_account_id:"whatsappAccountId",booking_notice:"bookingNotice",alt_phone:"altPhone",timeline_settings:"timelineSettings"},
  reservation_sources:{business_id:"businessId",use_yn:"useYn"},
};

// ─── 시스템 보호 태그/경로 (삭제 불가 디폴트) ─────────────────────────────────
// ── 시스템 태그/경로 이름 (ID 대신 이름으로 식별 → DB 재생성/변경에 안전) ──
const SYSTEM_TAG_NAME_NEW_CUST = "신규";
const SYSTEM_TAG_NAME_PREPAID  = "예약금완료";
const SYSTEM_SRC_NAME_NAVER    = "네이버";

// 런타임에 데이터 로드 후 resolveSystemIds()로 채워지는 변수
export let NEW_CUST_TAG_ID_GLOBAL = null;
export let PREPAID_TAG_ID = null;
export let NAVER_SRC_ID = null;
export let SYSTEM_TAG_IDS = [];  // 삭제/보호 대상 시스템 태그 ID 목록
export let SYSTEM_SRC_IDS = [];  // 삭제/보호 대상 시스템 경로 ID 목록

export function resolveSystemIds(tags, sources) {
  try {
    const tagList = Array.isArray(tags) ? tags : [];
    const srcList = Array.isArray(sources) ? sources : [];
    const newCustTag = tagList.find(t => t.name === SYSTEM_TAG_NAME_NEW_CUST && t.scheduleYn !== "Y");
    const prepaidTag = tagList.find(t => t.name === SYSTEM_TAG_NAME_PREPAID  && t.scheduleYn !== "Y");
    const naverSrc   = srcList.find(s => s.name === SYSTEM_SRC_NAME_NAVER);
    NEW_CUST_TAG_ID_GLOBAL = newCustTag?.id || null;
    PREPAID_TAG_ID         = prepaidTag?.id || null;
    NAVER_SRC_ID           = naverSrc?.id   || null;
    SYSTEM_TAG_IDS = [NEW_CUST_TAG_ID_GLOBAL, PREPAID_TAG_ID].filter(Boolean);
    SYSTEM_SRC_IDS = [NAVER_SRC_ID].filter(Boolean);
  } catch(e) {
    console.error("[Bliss] resolveSystemIds 오류:", e);
    SYSTEM_TAG_IDS = []; SYSTEM_SRC_IDS = [];
  }
}

export function fromDb(table,rows){const m=DBMAP[table];if(!m)return rows;return rows.map(row=>{const r={};for(const[k,v]of Object.entries(row)){if(k==="created_at"){r.createdAt=v;continue;}const mk=m[k]||k;r[mk]=v;} 
  // Parse JSON string arrays for app_users
  if(table==="app_users"){try{if(typeof r.branches==="string")r.branches=JSON.parse(r.branches);}catch(e){r.branches=[];}try{if(typeof r.viewBranches==="string")r.viewBranches=JSON.parse(r.viewBranches);}catch(e){r.viewBranches=[];}if(!Array.isArray(r.branches))r.branches=[];if(!Array.isArray(r.viewBranches))r.viewBranches=[];}
  // Parse JSON string arrays for reservations
  if(table==="reservations"){try{if(typeof r.selectedTags==="string")r.selectedTags=JSON.parse(r.selectedTags);}catch(e){r.selectedTags=[];}if(!Array.isArray(r.selectedTags))r.selectedTags=[];try{if(typeof r.selectedServices==="string")r.selectedServices=JSON.parse(r.selectedServices);}catch(e){r.selectedServices=[];}if(!Array.isArray(r.selectedServices))r.selectedServices=[];
    // Auto-detect gender from naver memo (옵션: 여) or 남))
    if(!r.custGender && r.memo){const ml=r.memo.toLowerCase();if(/여\)/.test(r.memo))r.custGender="F";else if(/남\)/.test(r.memo))r.custGender="M";}
    // naverCancelledDt 있으면 자동으로 naver_cancelled 상태
    if(r.naverCancelledDt && r.status !== "naver_cancelled" && r.status !== "naver_changed") r.status = "naver_cancelled";
  }
  // Convert booleans to Y/N for service_tags
  if(table==="service_tags"){r.scheduleYn=(r.scheduleYn===true||r.scheduleYn==="Y")?"Y":"N";r.useYn=r.useYn!==false;}
  return r;});}
// Valid DB columns per table (to filter out extra JS fields)
export const DB_COLS={
  reservations:["id","business_id","bid","room_id","cust_id","cust_name","cust_phone","cust_gender","cust_email","staff_id","service_id","date","time","dur","end_time","status","memo","type","is_schedule","is_new_cust","selected_tags","selected_services","repeat","repeat_until","repeat_group_id","reservation_id","updated_at","source","request_msg","owner_comment","is_prepaid","npay_method","total_price","visit_count","no_show_count","is_scraping_done","naver_reg_dt","naver_confirmed_dt","naver_cancelled_dt","visitor_name","visitor_phone","external_prepaid","external_platform","schedule_log"],
  sales:["id","business_id","bid","cust_id","cust_name","cust_phone","cust_gender","cust_num","staff_id","staff_name","date","service_id","service_name","product_id","product_name","svc_cash","svc_transfer","svc_card","svc_point","svc_comped","prod_cash","prod_transfer","prod_card","prod_point","prod_comped","gift","order_num","memo","reservation_id","external_prepaid","external_platform"],
  customers:["id","business_id","bid","name","name2","phone","phone2","gender","visits","last_visit","memo","cust_num","cust_num2","is_hidden","created_at","email","join_date","sms_consent","sns_accounts","cancel_penalty_count","no_show_count"],
  service_tags:["id","business_id","name","dur","schedule_yn","color","use_yn","sort"],
  services:["id","business_id","cat","name","dur","price_f","price_m","member_price_f","member_price_m","note","sort","is_package","pkg_count","pkg_price_f","pkg_price_m","badge_text","badge_color","badge_bg","promo_config","is_active","grants_member_price"],
  app_users:["id","business_id","login_id","password","name","role","branch_ids","view_branch_ids"],
  reservation_sources:["id","business_id","name","color","sort","use_yn"],
};
// Global active business context - auto-injected into DB writes
export let _activeBizId = null;
export const setActiveBiz = (bizId) => { _activeBizId = bizId; };

// Excel utility (uses SheetJS/XLSX global)
const XL = {
  download(rows, filename, sheetName="Sheet1", headers) {
    if(typeof XLSX==="undefined"){alert("SheetJS 로드 중...");return;}
    let ws;
    if(rows.length===0 && headers){
      ws=XLSX.utils.aoa_to_sheet([headers]);
    } else {
      ws=XLSX.utils.json_to_sheet(rows);
    }
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,sheetName); XLSX.writeFile(wb,filename);
  },
  readFile(file) {
    return new Promise((resolve) => {
      const reader=new FileReader();
      reader.onload=ev=>{const wb=XLSX.read(ev.target.result,{type:"array"});resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));};
      reader.readAsArrayBuffer(file);
    });
  }
};

export function toDb(table,obj){const m=DBMAP[table];if(!m){const r={...obj};delete r.created_at;return r;}const rev={};for(const[k,v]of Object.entries(m))rev[v]=k;const r={};for(const[k,v]of Object.entries(obj)){if(k==="created_at"||k==="_ua")continue;r[rev[k]||k]=v;}
  // reservations: reservation_id가 없으면 DB에 보내지 않음 (NULLS NOT DISTINCT unique 충돌 방지)
  if(table==="reservations" && !r.reservation_id) delete r.reservation_id;
  // Stringify arrays for app_users
  if(table==="app_users"){if(Array.isArray(r.branch_ids))r.branch_ids=JSON.stringify(r.branch_ids);if(Array.isArray(r.view_branch_ids))r.view_branch_ids=JSON.stringify(r.view_branch_ids);}
  const cols=DB_COLS[table];if(cols){const f={};for(const c of cols)if(r[c]!==undefined)f[c]=r[c];
  // Auto-inject business_id if active and column exists
  if(_activeBizId && cols.includes("business_id") && !f.business_id) f.business_id=_activeBizId;
  if(table==="reservations"||table==="sales") console.log(`toDb(${table}) final keys:`,Object.keys(f).join(","));
  return f;}return r;}
