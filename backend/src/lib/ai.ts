// Thin wrapper around whichever LLM provider is configured, mirroring the
// same abstraction the analytics service uses (see analytics/lib/ai.ts) so
// there's one consistent pattern across both services for picking a
// provider, timing out, and retrying transient failures. Kept as its own
// small copy here (rather than a shared package) since this backend and
// the analytics Next.js app are deployed and versioned independently.
//
// IMPORTANT: every caller in this file must only ever pass already-derived
// aggregate figures (counts, rates) in the prompt — never patient names,
// contact info, or clinical notes. See buildAppointmentInsightsPrompt in
// repo.ts's caller for the shape of what's allowed through.

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const PROVIDER: "openrouter" | "anthropic" | null =
  (process.env.AI_PROVIDER as "openrouter" | "anthropic" | undefined) ??
  (OPENROUTER_KEY ? "openrouter" : ANTHROPIC_KEY ? "anthropic" : null);

// Verify current model names/pricing at https://openrouter.ai/models or
// https://docs.claude.com before deploying — overridable via env since
// model names/availability change over time.
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export const AI_CONFIGURED = PROVIDER !== null;

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 25_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AiHttpError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function withResilience(label: string, attempt: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  let lastErr: unknown;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await attempt(controller.signal);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new AiHttpError(`${label} API error ${res.status}: ${body.slice(0, 500)}`, res.status);
        if (i < MAX_ATTEMPTS && isRetryableStatus(res.status)) {
          lastErr = err;
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
      return res;
    } catch (err: any) {
      clearTimeout(timer);
      const timedOut = err?.name === "AbortError";
      lastErr = timedOut ? new Error(`${label} request timed out after ${REQUEST_TIMEOUT_MS}ms.`) : err;
      if (i < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} request failed.`);
}

async function callOpenRouter(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const res = await withResilience("OpenRouter", (signal) =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:4000",
        "X-Title": "PulseID Hospital Admin",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    })
  );
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("OpenRouter API returned an empty or unexpected response shape.");
  }
  return text.trim();
}

async function callAnthropic(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const res = await withResilience("Anthropic", (signal) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    })
  );
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content || [])
    .map((block) => (block.type === "text" ? block.text ?? "" : ""))
    .filter(Boolean)
    .join("\n");
  if (!text.trim()) {
    throw new Error("Anthropic API returned an empty response.");
  }
  return text.trim();
}

export async function askClaude(systemPrompt: string, userPrompt: string, maxTokens = 600): Promise<string> {
  if (PROVIDER === "openrouter") return callOpenRouter(systemPrompt, userPrompt, maxTokens);
  if (PROVIDER === "anthropic") return callAnthropic(systemPrompt, userPrompt, maxTokens);
  throw new Error("No AI provider is configured — set OPENROUTER_API_KEY or ANTHROPIC_API_KEY to enable AI features.");
}

// Shared house style for every hospital-admin AI briefing this backend
// generates (today's appointment load, doctor workload balance, and the
// weekly ops digest — see the three /api/hospital-admin/* insight routes).
export const OPS_SYSTEM_PROMPT = `You are an operations analyst writing a short briefing for a hospital administrator inside PulseID's hospital-admin console.

Rules you always follow:
- You only ever receive already-aggregated counts (by status, by doctor, by day/week) plus active doctors' names — never patient names, contact info, or clinical details. Never imply you have or could look up an individual patient.
- Be concise: 3-5 short sentences or bullet points, no preamble, no sign-off.
- Be precise and factual — do not invent doctors, numbers, or dates that were not given to you. If a figure is zero or null, say so plainly rather than glossing over it.
- Focus on what's operationally actionable: bottlenecks, overloaded or under-booked doctors, unusually high cancellation/no-show rates, requests piling up unconfirmed, or a notable week-over-week swing — or a clean bill of health if nothing stands out.
- Plain, direct English. No emoji, no hype, no hedging filler like "it appears that."`;

// Used only by lib/followup-agent.ts, a different trust boundary than
// OPS_SYSTEM_PROMPT above: this one *is* given one patient's own check-in
// answers, because its output goes only to that patient's own treating
// doctor (see the followup_agents.doctor_id ownership check in repo.ts and
// every /api/doctor/followups* route) — never to analytics or any other
// audience. It must never be reused for a prompt whose output could reach
// anyone other than that one doctor.
export const FOLLOWUP_SYSTEM_PROMPT = `You are drafting a short clinical note for a doctor inside PulseID, summarizing one patient's answers to a scheduled follow-up check-in (e.g. postpartum, post-operative, or chronic-disease monitoring).

Rules you always follow:
- You are given the check-in questions and the patient's own answers for exactly one patient, and nothing else. Never invent symptoms, values, or history the patient didn't report.
- Write 2-4 short sentences, doctor-to-doctor register, no preamble, no sign-off, no restating "the patient said" for every line.
- Note anything that stands out (concerning answers, a trend versus what the question flagged as concerning) plainly, without alarmism.
- You are not making a diagnosis and must not phrase anything as one — describe what was reported, not what it means clinically.
- Plain, direct English. No emoji, no hype.`;
