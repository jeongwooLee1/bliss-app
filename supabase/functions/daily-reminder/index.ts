// 예약 리마인더 자동 발송
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabase = createClient(SB_URL, SB_KEY)

serve(async (req) => {
  try {
    // 내일 날짜
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().slice(0, 10)
    const dow = ["일","월","화","수","목","금","토"][tomorrow.getDay()]

    // 내일 confirmed 예약 조회 (전화번호 있는 것만)
    const { data: reservations } = await supabase
      .from("reservations")
      .select("id, cust_name, cust_phone, date, time, bid, status")
      .eq("date", tomorrowStr)
      .eq("status", "confirmed")
      .not("cust_phone", "is", null)
      .not("cust_phone", "eq", "")

    if (!reservations?.length) {
      return new Response(JSON.stringify({ sent: 0, msg: "no reservations tomorrow" }))
    }

    // 지점별 알림 설정 조회
    const { data: branches } = await supabase
      .from("branches")
      .select("id, name, short, noti_config, phone")

    const branchMap = Object.fromEntries((branches || []).map(b => [b.id, b]))

    let sent = 0
    for (const res of reservations) {
      if (!res.cust_phone || res.cust_phone.length < 10) continue

      const branch = branchMap[res.bid]
      if (!branch) continue

      // 알림톡 설정 확인
      const notiConfig = typeof branch.noti_config === "string"
        ? JSON.parse(branch.noti_config || "{}")
        : (branch.noti_config || {})

      const reminderNoti = notiConfig.rsv_reminder
      if (!reminderNoti?.on || !reminderNoti?.tplCode) continue

      // send_queue에 추가 (서버가 발송)
      await supabase.from("send_queue").insert({
        account_id: res.bid,
        user_id: res.cust_phone,
        channel: "alimtalk",
        status: "pending",
        message_text: JSON.stringify({
          noti_key: "rsv_reminder",
          phone: res.cust_phone,
          params: {
            "#{사용자명}": branch.name || "",
            "#{날짜}": `${tomorrowStr} (${dow})`,
            "#{시간}": res.time || "",
            "#{작업장소}": branch.name || "",
            "#{대표전화번호}": branch.phone || "",
          },
        }),
      })
      sent++
    }

    return new Response(JSON.stringify({ total: reservations.length, sent }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
