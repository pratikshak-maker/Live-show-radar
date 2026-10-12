import { ApiError, GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import { readEnv } from "../env";
import { addUsage } from "../lock";
import { errMessage, fail, notConfigured, ok, type Result } from "../result";

/** Per-run budget so one scan can't burn the whole free tier. */
export class GeminiBudget {
  calls = 0;
  quotaExhausted = false;
  constructor(public max: number = readEnv().GEMINI_MAX_CALLS_PER_RUN) {}
  get exhausted(): boolean {
    return this.calls >= this.max;
  }
}

let client: { key: string; ai: GoogleGenAI } | null = null;
function getAi(): GoogleGenAI | null {
  const key = readEnv().GEMINI_API_KEY;
  if (!key) return null;
  if (!client || client.key !== key) client = { key, ai: new GoogleGenAI({ apiKey: key }) };
  return client.ai;
}

export type GroundedSource = {
  uri: string;
  resolvedUrl: string;
  domain: string | null;
  title: string | null;
};

type ErrClass =
  | { kind: "daily_quota" }
  | { kind: "rate_limited"; retryMs: number | null }
  | { kind: "overloaded" }
  | { kind: "other"; message: string; status: number | null };

export function classifyGeminiError(e: unknown): ErrClass {
  const message = errMessage(e);
  const status = e instanceof ApiError ? e.status : null;
  const is429 = status === 429 || /RESOURCE_EXHAUSTED|\b429\b/.test(message);
  if (is429) {
    if (/PerDay|per day|daily/i.test(message)) return { kind: "daily_quota" };
    const m =
      /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message) ??
      /retry in (\d+(?:\.\d+)?)s/i.exec(message);
    return { kind: "rate_limited", retryMs: m ? Math.ceil(Number(m[1]) * 1000) : null };
  }
  // 500/503 "model overloaded / high demand" is transient: retry with backoff.
  if (status === 503 || status === 500 || /UNAVAILABLE|high demand|overloaded/i.test(message)) {
    return { kind: "overloaded" };
  }
  return { kind: "other", message, status };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetries<T>(
  budget: GeminiBudget,
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<Result<{ value: T; latencyMs: number }>> {
  if (!readEnv().GEMINI_API_KEY) return notConfigured("Gemini");
  if (budget.quotaExhausted) return fail("quota_exhausted", "Gemini's daily quota is used up.");
  const backoffs = [1000, 3000];
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    if (budget.exhausted)
      return fail("quota_exhausted", "This run's Gemini call limit was reached.");
    budget.calls++;
    await addUsage("gemini", 1);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const started = Date.now();
    try {
      const value = await call(ctl.signal);
      return ok({ value, latencyMs: Date.now() - started });
    } catch (e) {
      const c = classifyGeminiError(e);
      if (c.kind === "daily_quota") {
        budget.quotaExhausted = true;
        return fail("quota_exhausted", "Gemini's daily quota is used up.");
      }
      if (c.kind === "rate_limited") {
        if (attempt < backoffs.length) {
          await sleep(c.retryMs ?? backoffs[attempt]);
          continue;
        }
        return fail("rate_limited", "Gemini is rate limiting us.", c.retryMs ?? undefined);
      }
      if (c.kind === "overloaded") {
        if (attempt < backoffs.length) {
          await sleep(backoffs[attempt]);
          continue;
        }
        return fail("upstream_error", "Gemini is busy right now. We'll retry on the next check.");
      }
      if (ctl.signal.aborted) return fail("upstream_error", "Gemini timed out.");
      return fail("upstream_error", c.message.slice(0, 300));
    } finally {
      clearTimeout(timer);
    }
  }
  return fail("rate_limited", "Gemini is rate limiting us.");
}

async function resolveRedirect(uri: string): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(uri)) return uri;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch(uri, { method: "GET", redirect: "manual", signal: ctl.signal });
    const loc = res.headers.get("location");
    return loc && /^https?:\/\//.test(loc) ? loc : uri;
  } catch {
    return uri;
  } finally {
    clearTimeout(t);
  }
}

function domainOf(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Pass 1: Google-Search-grounded free text + sources. (Never combined with JSON mode.) */
export async function groundedSearch(
  prompt: string,
  budget: GeminiBudget,
): Promise<Result<{ text: string; sources: GroundedSource[]; latencyMs: number }>> {
  const ai = getAi();
  if (!ai) return notConfigured("Gemini");
  const r = await withRetries(budget, 30_000, (signal) =>
    ai.models.generateContent({
      model: readEnv().GEMINI_MODEL,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }], temperature: 0.2, abortSignal: signal },
    }),
  );
  if (!r.ok) return r;
  const resp = r.data.value;
  const text = (resp.text ?? "").trim();
  const chunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const raw = chunks
    .map((c) => c.web)
    .filter((w): w is NonNullable<typeof w> => Boolean(w?.uri))
    .slice(0, 12);
  const resolved = await Promise.all(raw.map((w) => resolveRedirect(w.uri as string)));
  const seen = new Set<string>();
  const sources: GroundedSource[] = [];
  raw.forEach((w, i) => {
    const url = resolved[i];
    if (seen.has(url)) return;
    seen.add(url);
    sources.push({
      uri: w.uri as string,
      resolvedUrl: url,
      domain: domainOf(url) ?? w.title ?? null,
      title: w.title ?? null,
    });
  });
  return ok({ text, sources, latencyMs: r.data.latencyMs });
}

/** Pass 2: JSON-mode structured output validated with zod; one repair retry. No tools. */
export async function generateJson<S extends z.ZodTypeAny>(
  prompt: string,
  responseSchema: Record<string, unknown>,
  schema: S,
  budget: GeminiBudget,
  opts: { timeoutMs?: number } = {},
): Promise<Result<{ data: z.infer<S>; latencyMs: number }>> {
  const ai = getAi();
  if (!ai) return notConfigured("Gemini");
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let contents = prompt;
  let lastErrors = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await withRetries(budget, timeoutMs, (signal) =>
      ai.models.generateContent({
        model: readEnv().GEMINI_MODEL,
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema as never,
          temperature: 0.1,
          abortSignal: signal,
        },
      }),
    );
    if (!r.ok) return r;
    const text = (r.data.value.text ?? "").trim();
    let json: unknown;
    try {
      json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      lastErrors = "Output was not valid JSON.";
      contents = `${prompt}\n\nYour previous output failed validation with these errors: ${lastErrors} Return corrected JSON only.`;
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return ok({ data: parsed.data, latencyMs: r.data.latencyMs });
    lastErrors = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    contents = `${prompt}\n\nYour previous output failed validation with these errors: ${lastErrors}. Return corrected JSON only.`;
  }
  return fail("invalid_response", `Gemini output failed validation: ${lastErrors}`.slice(0, 300));
}

/** Cheap connectivity probe for check:integrations. */
export async function ping(): Promise<Result<string>> {
  const ai = getAi();
  if (!ai) return notConfigured("Gemini");
  try {
    const r = await ai.models.generateContent({
      model: readEnv().GEMINI_MODEL,
      contents: "Reply with the single word: ok",
    });
    return ok((r.text ?? "").trim().slice(0, 20));
  } catch (e) {
    return fail("upstream_error", errMessage(e).slice(0, 200));
  }
}
