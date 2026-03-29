// 매일 밤 매출 리포트 텔레그램 발송
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabase = createClient(SB_URL, SB_KEY)

const TG_TOKEN = Deno.env.get("TG_TOKEN") || ""
const TG_CHAT = Deno.env.get("TG_CHAT") || ""

async function sendTelegram(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
  })
}

const fmt = (n: number) => n.toLocaleString("ko-KR")

serve(async (req) => {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const dow = ["일","월","화","수","목","금","토"][new Date().getDay()]

    // 오늘 매출 조회
    const { data: sales } = await supabase
      .from("sales")
      .select("*")
      .eq("date", today)

    // 지점 목록
    const { data: branches } = await supabase
      .from("branches")
      .select("id, name, short")

    const branchMap = Object.fromEntries((branches || []).map(b => [b.id, b]))

    // 지점별 집계
    const byBranch: Record<string, { count: number; svc: number; prod: number; total: number }> = {}
    let grandTotal = 0, grandCount = 0

    for (const s of (sales || [])) {
      const bid = s.bid || "unknown"
      if (!byBranch[bid]) byBranch[bid] = { count: 0, svc: 0, prod: 0, total: 0 }
      const svc = (s.svc_cash||0) + (s.svc_transfer||0) + (s.svc_card||0) + (s.svc_point||0)
      const prod = (s.prod_cash||0) + (s.prod_transfer||0) + (s.prod_card||0) + (s.prod_point||0)
      const total = svc + prod + (s.gift||0)
      byBranch[bid].count++
      byBranch[bid].svc += svc
      byBranch[bid].prod += prod
      byBranch[bid].total += total
      grandTotal += total
      grandCount++
    }

    // 내일 예약 건수
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().slice(0, 10)

    const { count: tomorrowCount } = await supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("date", tomorrowStr)
      .in("status", ["confirmed", "pending", "request"])

    // 텔레그램 메시지 생성
    let msg = `📊 <b>${today} (${dow}) 매출 리포트</b>\n\n`
    msg += `💰 총 매출: <b>${fmt(grandTotal)}원</b> (${grandCount}건)\n\n`

    const sorted = Object.entries(byBranch).sort((a, b) => b[1].total - a[1].total)
    for (const [bid, v] of sorted) {
      const name = branchMap[bid]?.short || bid
      msg += `▪️ ${name}: ${fmt(v.total)}원 (${v.count}건)\n`
    }

    msg += `\n📅 내일 예약: ${tomorrowCount || 0}건`

    await sendTelegram(msg)

    return new Response(JSON.stringify({ sent: true, total: grandTotal, count: grandCount }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
