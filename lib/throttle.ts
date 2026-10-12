/** Serialises calls so that at least `minIntervalMs` passes between starts (per-instance). */
export function createThrottle(minIntervalMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  return function throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = Math.max(0, last + minIntervalMs - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

/** Tiny TTL + size-bounded LRU cache. */
export class LruCache<V> {
  private map = new Map<string, { value: V; expires: number }>();
  constructor(
    private max = 200,
    private ttlMs = 10 * 60_000,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10_000, ...rest } = init;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}
