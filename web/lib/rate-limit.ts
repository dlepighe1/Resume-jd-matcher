/**
 * Fixed-window per-IP rate limiting.
 *
 * An unmetered LLM endpoint on a public URL, with your API key behind it, is how you
 * get a surprise bill. This is the cheap guard.
 *
 * HONEST LIMITATION: the counters live in process memory. On Vercel that means the
 * limit is per serverless instance, not global — someone determined enough to spray
 * requests across cold starts can exceed it. It stops casual abuse and accidental
 * loops, which is the realistic threat for a portfolio project. For a hard guarantee,
 * swap the Map for Upstash Redis (`@upstash/ratelimit`); the call site below does not
 * change, only this file does.
 */

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 10;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the window resets. Only meaningful when allowed is false. */
  retryAfter: number;
}

export function checkRateLimit(key: string, limit = requestsPerMinute()): RateLimitVerdict {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    sweep(now);
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

function requestsPerMinute(): number {
  const configured = Number(process.env.RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LIMIT;
}

/** Drop expired windows so the Map doesn't grow without bound on a long-lived instance. */
function sweep(now: number) {
  if (windows.size < 1000) return;
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
}

/**
 * Identify the caller. On Vercel, x-forwarded-for is set by the platform edge and its
 * FIRST entry is the real client — trusting the last entry would let a caller spoof
 * their identity by sending their own header.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Test seam — the module-level Map would otherwise leak state between tests. */
export function resetRateLimits() {
  windows.clear();
}
