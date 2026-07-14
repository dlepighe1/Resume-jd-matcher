/** Every failure the analyze route can surface, with the HTTP status it maps to.
 *  Distinct codes so the client can react differently — a cold model service is a
 *  "wait a moment" and a refusal is a dead end, and the UI should not conflate them. */
export type ErrorCode =
  | "INVALID_REQUEST"
  | "TOO_SHORT"
  | "RATE_LIMITED"
  | "REFUSED"
  | "INVALID_OUTPUT"
  | "PROVIDER_ERROR"
  | "MODEL_SERVICE_UNREACHABLE"
  | "CONFIG_ERROR";

export class AnalyzeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    /** Seconds to wait, echoed from an upstream 429. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "AnalyzeError";
  }
}
