/**
 * Server-side environment access.
 *
 * Every value is read through a getter, so a missing key throws only when the
 * feature that needs it is actually used. That means you can run the app with
 * just ANTHROPIC_API_KEY set and the Claude provider works, while selecting the
 * OpenRouter provider fails with a message that says exactly what to set — instead
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

  openrouter: {
    get apiKey() {
      return required(
        "OPENROUTER_API_KEY",
        "Create one at https://openrouter.ai/keys and add it to web/.env.local",
      );
    },
    /**
     * Deliberately has no default. OpenRouter's free-tier model slugs are rotated and
     * retired regularly, so any value hardcoded here would silently 404 one day. Pick a
     * current one from https://openrouter.ai/models?q=free and set it explicitly.
     */
    get model() {
      return required(
        "OPENROUTER_MODEL",
        'Pick a current free model from https://openrouter.ai/models?q=free (e.g. a ":free" slug) and set it — free slugs rotate, so there is no safe default.',
      );
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
  },

  supabase: {
    get url() {
      return required("SUPABASE_URL", "Find it in your Supabase project settings > API.");
    },
    /** Service-role key — server-side only. Exposing this to the browser bypasses row-level security. */
    get serviceRoleKey() {
      return required(
        "SUPABASE_SERVICE_ROLE_KEY",
        "Supabase project settings > API > service_role. Server-side only — never expose it to the client.",
      );
    },
  },
} as const;
