/**
 * 노쇼 자동 처리
 * pg_cron으로 매 시간 호출 — 예약 시간 + 30분 경과한 confirmed 예약 → no_show 처리
 *
 * 활성화: Supabase Dashboard → SQL Editor:
 * SELECT cron.schedule('noshow-check', '0 * * * *',
 *   $$SELECT net.http_post('https://dpftlrsuqxqqeouwbfjd.supabase.co/functions/v1/noshow-check', '{}', '{"Authorization":"Bearer <ANON_KEY>"}')$$
 * );
 *
 * 주의: 이 기능은 자동으로 no_show를 처리하므로,
 * 시술 중이거나 늦게 도착한 고객이 잘못 노쇼 처리될 수 있음.
 * 활성화 전 운영팀 확인 필요.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabase = createClient(SB_URL, SB_KEY)

serve(async (req) => {
  try {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const currentMinutes = now.getHours() * 60 + now.getMinutes()

    // 오늘 confirmed 예약 중 시간이 30분 이상 지난 것
    const { data: reservations } = await supabase
      .from("reservations")
      .select("id, time, cust_name, bid, status")
      .eq("date", today)
      .eq("status", "confirmed")

    if (!reservations?.length) {
      return new Response(JSON.stringify({ checked: 0, noshow: 0 }))
    }

    let noshow = 0
    for (const res of reservations) {
      if (!res.time) continue
      const [h, m] = res.time.split(":").map(Number)
      const resMinutes = h * 60 + m
      const diff = currentMinutes - resMinutes

      // 예약 시간 + 30분 경과 & 아직 진행(status=confirmed)이면 → no_show 후보
      // 단, 실제로는 시술 중일 수 있으므로 status가 "진행" 상태가 아닌 것만
      if (diff >= 30 && diff < 120) { // 30분~2시간 경과
        // memo에 노쇼 후보 표시 (자동 처리하지 않고 알림만)
        await supabase
          .from("reservations")
          .update({
            memo: `[노쇼확인필요] ${res.time} 예약, ${diff}분 경과`,
          })
          .eq("id", res.id)
          .is("memo", null) // memo 비어있을 때만

        noshow++
      }
    }

    return new Response(JSON.stringify({ checked: reservations.length, flagged: noshow }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
