// send_queue INSERT 시 즉시 발송
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabase = createClient(SB_URL, SB_KEY)

serve(async (req) => {
  try {
    const { record } = await req.json()
    if (!record || record.status !== "pending") {
      return new Response("skip", { status: 200 })
    }

    const { id, channel, account_id, user_id, message_text } = record

    // 채널별 발송
    if (channel === "naver") {
      // 네이버톡톡 API 발송 — 서버(bliss_naver.py)에서 처리
      // Edge Function에서는 네이버톡 API 직접 호출 불가 (세션 필요)
      return new Response("naver: delegated to server")
    }

    if (channel === "instagram") {
      // Instagram DM 발송
      const { data: biz } = await supabase
        .from("businesses")
        .select("settings")
        .eq("id", "biz_khvurgshb")
        .single()

      const settings = JSON.parse(biz?.settings || "{}")
      const igTokens = settings.ig_tokens || {}
      const igToken = igTokens[account_id] || settings.ig_token || ""

      if (!igToken) {
        await supabase.from("send_queue").update({ status: "error" }).eq("id", id)
        return new Response("no ig token", { status: 200 })
      }

      const resp = await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${igToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: user_id }, message: { text: message_text } }),
      })

      if (resp.ok) {
        await supabase.from("send_queue").update({ status: "sent" }).eq("id", id)
        await supabase.from("naver_messages").insert({
          account_id, user_id, channel: "instagram",
          event_type: "send", message_type: "text",
          message_text, direction: "out", is_read: true,
        })
        return new Response("instagram: sent")
      } else {
        await supabase.from("send_queue").update({ status: "error" }).eq("id", id)
        return new Response(`instagram: error ${resp.status}`)
      }
    }

    if (channel === "whatsapp") {
      const { data: biz } = await supabase
        .from("businesses")
        .select("settings")
        .eq("id", "biz_khvurgshb")
        .single()

      const settings = JSON.parse(biz?.settings || "{}")
      const waToken = settings.wa_token || ""
      const waPhoneId = settings.wa_phone_number_id || ""

      if (!waToken || !waPhoneId) {
        await supabase.from("send_queue").update({ status: "error" }).eq("id", id)
        return new Response("no wa token")
      }

      const resp = await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: user_id,
          type: "text",
          text: { body: message_text },
        }),
      })

      if (resp.ok) {
        await supabase.from("send_queue").update({ status: "sent" }).eq("id", id)
        await supabase.from("naver_messages").insert({
          account_id, user_id, channel: "whatsapp",
          event_type: "send", message_type: "text",
          message_text, direction: "out", is_read: true,
        })
        return new Response("whatsapp: sent")
      } else {
        await supabase.from("send_queue").update({ status: "error" }).eq("id", id)
        return new Response(`whatsapp: error ${resp.status}`)
      }
    }

    return new Response("unknown channel")
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
