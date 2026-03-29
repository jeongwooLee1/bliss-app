// 고객 생일 축하 알림
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabase = createClient(SB_URL, SB_KEY)

serve(async (req) => {
  try {
    const now = new Date()
    const todayMMDD = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

    // 오늘 생일인 고객 조회
    // birthday 컬럼이 "MM-DD" 형식이라고 가정
    const { data: customers } = await supabase
      .from("customers")
      .select("id, name, phone, birthday, bid")
      .eq("birthday", todayMMDD)
      .not("phone", "is", null)
      .not("is_hidden", "eq", true)

    if (!customers?.length) {
      return new Response(JSON.stringify({ birthday_customers: 0, sent: 0 }))
    }

    // 지점별 알림 설정
    const { data: branches } = await supabase
      .from("branches")
      .select("id, name, phone, noti_config")

    const branchMap = Object.fromEntries((branches || []).map(b => [b.id, b]))

    let sent = 0
    for (const cust of customers) {
      if (!cust.phone || cust.phone.length < 10) continue

      const branch = branchMap[cust.bid]
      if (!branch) continue

      // 생일 축하 메시지
      const message = `${cust.name}님, 생일 축하드립니다! 🎂🎉\n하우스왁싱 ${branch.name}에서 특별한 생일 혜택을 준비했어요.\n방문 시 생일 쿠폰을 사용해 보세요! 💝`

      // send_queue에 추가
      await supabase.from("send_queue").insert({
        account_id: cust.bid,
        user_id: cust.phone,
        channel: "alimtalk",
        status: "pending",
        message_text: JSON.stringify({
          noti_key: "birthday",
          phone: cust.phone,
          params: {
            "#{고객명}": cust.name || "",
            "#{매장명}": branch.name || "",
            "#{대표전화번호}": branch.phone || "",
          },
        }),
      })
      sent++
    }

    return new Response(JSON.stringify({ birthday_customers: customers.length, sent }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
