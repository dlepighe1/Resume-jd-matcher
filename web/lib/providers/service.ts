import { env } from "@/lib/env";

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
