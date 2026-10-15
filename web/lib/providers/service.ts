import { env } from "@/lib/env";
import { AnalyzeError } from "@/lib/errors";

/**
 * Headers for every call to the Python scoring service.
 *
 * Every request the service receives comes from this server, not from the visitor, so
 * its per-address rate limit would otherwise be one budget shared by everyone using the
 * page. The visitor's address is forwarded with a shared secret, and the service trusts
 * the address only when the secret matches (see client_key in service/main.py).
 */
export function serviceHeaders(clientIp: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = env.scoringService.secret;
  if (secret && clientIp) {
    headers["X-Proxy-Secret"] = secret;
    headers["X-Client-IP"] = clientIp;
  }
  return headers;
}

/**
 * How long to keep trying a service that is waking up. It has to stay under the score
 * route's maxDuration (120 s): when the two were equal, Vercel killed the function before
 * this code could report the timeout, and the visitor got a bare 504 with no scores at all.
 * Mutable so tests can shrink it rather than wait it out.
 */
export const serviceRetry = {
  budgetMs: 100_000,
  backoffMs: [2_000, 4_000, 8_000],
};

/** Statuses a sleeping or restarting host answers with before the app is listening. */
const WAKING = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST to the scoring service, retrying while it wakes up.
 *
 * Railway answers 502 while a woken container has not yet bound its port, and the service
 * itself answers 503 while its model is still loading. Both mean "wait", not "broken", so
 * they are retried with backoff until the budget runs out. Any other status is returned
 * for the caller to report. Throws MODEL_SERVICE_UNREACHABLE only when every attempt failed.
 */
export async function postToService(
  path: string,
  body: unknown,
  clientIp: string | undefined,
  label: string,
): Promise<Response> {
  const baseUrl = env.scoringService.url.replace(/\/$/, "");
  const deadline = Date.now() + serviceRetry.budgetMs;

  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    const backoff = serviceRetry.backoffMs[Math.min(attempt, serviceRetry.backoffMs.length - 1)];
    const canRetry = remaining > backoff;

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: serviceHeaders(clientIp),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(remaining, 1_000)),
      });
      if (!WAKING.has(response.status) || deadline - Date.now() <= backoff) return response;
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      if (timedOut || !canRetry) {
        throw new AnalyzeError(
          "MODEL_SERVICE_UNREACHABLE",
          timedOut
            ? `The ${label} did not respond in time. If it has been idle it may still be waking up, try again in a moment.`
            : `Could not reach the ${label} at ${baseUrl}. Is it running?`,
          503,
        );
      }
    }
    await sleep(backoff);
  }
}
