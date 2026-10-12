import { NextResponse } from "next/server";
import type { z } from "zod";

export function apiError(code: string, message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message }, ...extra }, { status });
}

export const dbMissing = () =>
  apiError("db_not_configured", "The database isn't connected yet. See /setup.", 503);

export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      res: apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid request body"),
    };
  }
  return { ok: true, data: parsed.data };
}

export function parseQuery<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; res: NextResponse } {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false,
      res: apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid query"),
    };
  }
  return { ok: true, data: parsed.data };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
