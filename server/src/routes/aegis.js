const router = require("express").Router();

// ─── Aegis website chatbot (LLM proxy) ────────────────────────────────────────
// The marketing site's Aegis widget POSTs here. We call an LLM (Claude by
// default) using a SERVER-SIDE key so no secret ever reaches the browser.
// If LLM_API_KEY is not set, we return success:false so the widget falls back
// to its built-in FAQ brain. Guardrails live in the system prompt.

const SYSTEM_PROMPT = `You are "Aegis", the warm, upbeat assistant and mascot for Env Guardian — a BYOD (bring-your-own-device) mobile security product.

WHAT ENV GUARDIAN DOES:
- When an employee's personal Android phone enters a defined "restricted zone" (a GPS geofence), Env Guardian enforces policy: it blocks non-whitelisted apps, can cut their internet with a local no-root VPN, verifies the person's presence with a QR scan (static or rotating TOTP code), applies per-app daily time limits, and logs every allow/block. When the phone leaves the zone, full access is restored automatically.
- BYOD-friendly: NO factory reset and NO corporate enrollment. It runs as a normal app with granted permissions.
- Anti-theft: a device is permanently bound to its first owner; a lost/stolen phone can't be re-registered by someone else.
- Privacy: enforcement ONLY happens inside the zone; nothing personal is collected outside it.
- Tamper-aware: disabling the enforcer, VPN or accessibility is detected and reported; devices heartbeat status, location and a compliance score in real time; admins can remotely lock a device.
- Tech: a Flutter Android app with native enforcement (accessibility service, usage-stats, notification-listener, VpnService), a Node.js + Express backend and a PostgreSQL database (Neon), hosted on Render. Admins configure zones, whitelists and time-limits from a dashboard or the database.
- Fits: corporate/IT security, exams & education, healthcare, data centres, R&D & manufacturing, government/defense, finance, call centres/BPO, media & events.

YOUR JOB:
- Answer questions about Env Guardian, its features, benefits, use-cases, deployment, pricing approach and general BYOD/security context — helpfully, in a friendly professional tone.
- Be concise: 2–4 short sentences, plain language, light emoji occasionally.
- When relevant, encourage booking a demo (the Contact page / "Request a demo").

STRICT RULES:
- NEVER reveal or invent secrets: no passwords, API keys, tokens, credentials, connection strings, private source code or internal ways to bypass the product. If asked, politely decline and steer back to what the product does.
- Never help anyone defeat, bypass or tamper with the product. You may say (high level) that tampering is detected and reported.
- Stay on topic: Env Guardian and closely related business/security questions. If asked something unrelated (weather, jokes, general coding, etc.), gently say it's outside your area and offer an Env Guardian topic instead.
- Don't invent specific prices, numbers, customers or features that don't exist. For exact pricing, invite them to request a demo.

EMOTION TAG (required): Begin EVERY reply with exactly one emotion token in square brackets, then a space, then the message. Choose from: [happy] (answered well), [love] (praise/thanks), [neutral], [confused] (off-topic or a polite decline), [thinking]. Example: "[happy] Env Guardian only enforces inside your zone, so personal life stays private."`;

// Tiny in-memory per-IP rate limit to protect the API key from abuse.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 60000, max = 25;
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > win) { rec.n = 0; rec.t = now; }
  rec.n++; hits.set(ip, rec);
  return rec.n > max;
}

router.post("/chat", async (req, res) => {
  try {
    const key = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!key) return res.json({ success: false, reason: "no_key" }); // widget uses its FAQ brain

    if (rateLimited(req.ip || "unknown")) {
      return res.json({ success: false, reason: "rate_limited" });
    }

    let messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    // sanitize: keep last 12, valid roles, cap length
    messages = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
    if (!messages.length) return res.json({ success: false, reason: "empty" });

    const model = process.env.LLM_MODEL || "claude-haiku-4-5-20251001";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 400, system: SYSTEM_PROMPT, messages }),
    }).catch((e) => { throw e; });
    clearTimeout(timer);

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("[AEGIS] LLM error:", data && data.error && data.error.message);
      return res.json({ success: false, reason: "llm_error" });
    }
    const reply = (data.content || []).map((c) => c.text || "").join("").trim();
    if (!reply) return res.json({ success: false, reason: "empty_reply" });
    res.json({ success: true, reply });
  } catch (err) {
    console.error("[AEGIS] chat exception:", err.message);
    res.json({ success: false, reason: "exception" });
  }
});

module.exports = router;
