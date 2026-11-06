// PERFORMANCE LAB coach: reads the signed-in user's last 14 days and streams a Claude reply as plain text.
// Requires the ANTHROPIC_API_KEY secret (Supabase dashboard > Edge Functions > Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MODEL = Deno.env.get("COACH_MODEL") ?? "claude-sonnet-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COACHES: Record<string, { name: string; focus: string }> = {
  strength: { name: "Strength", focus: "You coach strength and hypertrophy training: weekly structure, progressive overload, volume, deloads and exercise choice. Tie advice to the person's logged sessions, RPE and readiness." },
  recovery: { name: "Recovery", focus: "You coach recovery: reading HRV against baseline, resting heart rate drift, session-RPE training load, acute vs chronic load, and when to push or back off." },
  sleep: { name: "Sleep", focus: "You coach sleep: duration against an 8 hour target, night-to-night consistency, quality ratings, and how sleep lines up with HRV and training. Give practical habits." },
  nutrition: { name: "Nutrition", focus: "You coach nutrition: energy intake, protein per day (a common target is about 1.6 g per kg of body weight), meal timing around training, and simple swaps. Use logged meals and weight." },
};

type Turn = { role: "user" | "assistant"; content: string };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json(500, { error: "The coach isn't set up yet: add the ANTHROPIC_API_KEY secret in Supabase." });

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!user) return json(401, { error: "Sign in to talk to a coach." });

  let body: { coach?: string; turns?: Turn[]; today?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Send JSON." }); }
  const coach = COACHES[body.coach ?? ""];
  if (!coach) return json(400, { error: "Unknown coach." });
  const turns = (Array.isArray(body.turns) ? body.turns : [])
    .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-10)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return json(400, { error: "End with a question." });

  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? "") ? body.today! : new Date().toISOString().slice(0, 10);
  const from = new Date(Date.parse(today) - 13 * 864e5).toISOString().slice(0, 10);
  const { data: days, error } = await supabase
    .from("days")
    .select("date,sleep,sleep_q,hrv,rhr,steps,weight,energy,workouts,meals,notes")
    .gte("date", from).lte("date", today).order("date");
  if (error) return json(500, { error: "Couldn't read your log." });

  const rows = (days ?? []).map((d) => {
    const w = (d.workouts ?? []) as { type: string; mins: number; rpe: number }[];
    const m = (d.meals ?? []) as { kcal: number; protein: number }[];
    return {
      date: d.date, sleep_h: d.sleep, sleep_quality_1to5: d.sleep_q, hrv_ms: d.hrv, rhr_bpm: d.rhr,
      steps: d.steps, weight_lb: d.weight, energy_1to5: d.energy,
      sessions: w.map((x) => `${x.type} ${x.mins}min RPE${x.rpe}`),
      load_au: w.reduce((s, x) => s + (x.mins || 0) * (x.rpe || 0), 0),
      kcal: m.reduce((s, x) => s + (x.kcal || 0), 0), protein_g: m.reduce((s, x) => s + (x.protein || 0), 0),
      notes: d.notes || undefined,
    };
  });

  const system = `You are the ${coach.name} coach inside PERFORMANCE LAB, a personal training and recovery log. ${coach.focus}
Use the person's logged data below and cite specific numbers and dates. Be concise: under 170 words unless they ask for a plan. Write plain text; you may use "- " bullets, no markdown headings or bold. You are not a doctor: for pain, injury symptoms or anything clinical, recommend a qualified clinician. Units: HRV is RMSSD in ms, resting HR in bpm, training load is session-RPE (minutes x RPE, arbitrary units). Today is ${today}. Days missing from the list were not logged.

Logged data, oldest first:
${rows.length ? JSON.stringify(rows) : "No days logged yet. Encourage them to log sleep, HRV, resting HR, sessions and meals."}`;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: turns, stream: true }),
  });
  if (!upstream.ok || !upstream.body) {
    console.error("anthropic error", upstream.status, await upstream.text().catch(() => ""));
    return json(502, { error: upstream.status === 429 ? "The coach is busy. Try again in a minute." : "The coach couldn't answer. Try again." });
  }

  // Convert Anthropic's SSE stream into a plain text stream of answer deltas.
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = "";
  const out = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") ctl.enqueue(enc.encode(ev.delta.text));
        } catch { /* keep-alive or partial line */ }
      }
    },
  }));
  return new Response(out, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
});
