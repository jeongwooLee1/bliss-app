// 전역 rt_pings 디스패처 — 보안 RLS 잠금으로 직접 Realtime이 막힌 테이블들의 실시간을 신호 테이블 경유로 복구.
// 잠긴 테이블(reservations/schedule_data/messages/bank_deposits/team_chat_messages/app_users/ai_change_requests)은
// anon Realtime이 x-bliss-session 헤더를 못 실어 이벤트가 0건. 대신 PII 없는 rt_pings(anon 읽기 허용)를
// 디바이스당 '단일' Realtime 채널로 구독 → 신호 수신 시 등록된 콜백을 호출 → 콜백이 토큰 인증으로 실제 데이터 재조회.
// 단일 채널이라 연결 풀 부하가 기존(테이블별 8~10채널)보다 오히려 낮음.
//
// 사용: const off = onRtPing("messages", () => load());  // 등록, off()로 해제
//       AppShell에서 initRtPings(window._sbClient, bizId) 1회 호출.

let _ch = null;
let _biz = null;
const _subs = {}; // { table: Set<fn(pingRow)> }

export function initRtPings(client, bizId) {
  if (!client || !bizId) return;
  if (_ch && _biz === bizId) return;                 // 이미 같은 biz로 구독 중
  if (_ch) { try { client.removeChannel(_ch); } catch (e) {} _ch = null; }
  _biz = bizId;
  try {
    _ch = client.channel("rt_pings_global")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "rt_pings", filter: "business_id=eq." + bizId },
        (p) => {
          const row = p && p.new;
          if (!row || !row.tbl) return;
          const set = _subs[row.tbl];
          if (!set) return;
          set.forEach((fn) => { try { fn(row); } catch (e) {} });
        })
      .subscribe((status) => { if (status === "SUBSCRIBED") console.log("[RT] ✓ 실시간 신호 채널 연결"); });
  } catch (e) {}
}

// table 변경 신호 시 fn(pingRow) 호출. pingRow = { tbl, ref, business_id, created_at }.
export function onRtPing(table, fn) {
  if (!table || typeof fn !== "function") return () => {};
  if (!_subs[table]) _subs[table] = new Set();
  _subs[table].add(fn);
  return () => { try { _subs[table] && _subs[table].delete(fn); } catch (e) {} };
}

// 버스트 합침용 디바운스 헬퍼 (콜백에서 선택 사용)
export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
