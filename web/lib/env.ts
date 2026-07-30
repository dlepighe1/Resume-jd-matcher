/**
 * Server-side environment access.
 *
 * Every value is read through a getter, so a missing key throws only when the
 * feature that needs it is actually used. That means you can run the app with
 * just ANTHROPIC_API_KEY set and the Claude provider works, while selecting the
 * OpenRouter provider fails with a message that says exactly what to set, instead
 * of the whole app refusing to boot because one optional key is absent.
 *
 * Never import this from a client component: it reads secrets.
 */

export class MissingEnvError extends Error {
  constructor(name: string, hint: string) {
    super(`Missing required environment variable ${name}. ${hint}`);
    this.name = "MissingEnvError";
  }
}

function required(name: string, hint: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new MissingEnvError(name, hint);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  anthropic: {
    get apiKey() {
      return required(
        "ANTHROPIC_API_KEY",
        "Create one at https://console.anthropic.com/settings/keys and add it to web/.env.local",
      );
    },
    /** Opus 4.8 is the default. Set ANTHROPIC_MODEL=claude-sonnet-5 for ~3x cheaper inference. */
    get model() {
      return optional("ANTHROPIC_MODEL", "claude-opus-4-8");
    },
  },

  scoringService: {
    /** The FastAPI service hosting the fine-tuned MPNet + Platt calibrator. */
    get url() {
      return required(
        "SCORING_SERVICE_URL",
        "Point this at the Python scoring service (http://localhost:8000 locally, or your HuggingFace Space URL).",
      );
    },
    /** Whether the service is configured at all. The demo degrades to the precomputed
     *  benchmark rather than erroring when it isn't. */
    get isConfigured() {
      return Boolean(process.env.SCORING_SERVICE_URL?.trim());
    },
  },
} as const;

/** Claude is optional in the demo: without a key the live comparison simply omits it
 *  and says so, rather than failing the whole request. */
export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
