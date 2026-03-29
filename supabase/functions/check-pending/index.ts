// pending 예약 자동 재확인 — pg_cron 30분마다 호출
// 활성화: EDGE_FUNCTIONS.md 참고
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabase = createClient(SB_URL, SB_KEY)

// 네이버 비즈 ID 매핑
const BID_BIZ: Record<string, string> = {
  "br_4bcauqvrb": "801331",
  "br_wkqsxj6k1": "893498",
  "br_l6yzs2pkq": "1191498",
  "br_k57zpkbx1": "1524562",
  "br_lfv2wgdf1": "1524622",
  "br_g768xdu4w": "1524667",
  "br_ybo3rmulv": "1524690",
  "br_xu60omgdf": "801331",
}

serve(async (req) => {
  try {
    const today = new Date().toISOString().slice(0, 10)

    // pending/request 상태 네이버 예약 조회 (오늘 이후)
    const { data: pendingRes } = await supabase
      .from("reservations")
      .select("id, reservation_id, bid, status, date, cust_name")
      .in("status", ["pending", "request"])
      .eq("source", "naver")
      .gte("date", today)
      .not("reservation_id", "is", null)

    if (!pendingRes?.length) {
      return new Response(JSON.stringify({ checked: 0, updated: 0 }))
    }

    let updated = 0
    for (const res of pendingRes) {
      const bizId = BID_BIZ[res.bid]
      if (!bizId || !res.reservation_id) continue

      // 네이버 API 세션은 서버(bliss_naver.py)에서만 접근 가능
      // 여기서는 DB 상태만 체크: 2시간 이상 pending이면 확인 필요 플래그
      const createdAt = new Date(res.date + "T00:00:00")
      const now = new Date()
      const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)

      if (hoursDiff > 2) {
        // memo에 확인 필요 표시
        await supabase
          .from("reservations")
          .update({ memo: `[자동확인] pending ${Math.floor(hoursDiff)}시간 경과` })
          .eq("id", res.id)
          .is("memo", null) // memo가 비어있을 때만
        updated++
      }
    }

    return new Response(JSON.stringify({ checked: pendingRes.length, updated }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
