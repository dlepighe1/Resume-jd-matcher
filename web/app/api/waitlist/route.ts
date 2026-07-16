import { NextResponse } from "next/server";
import { z } from "zod";

import { isPersistenceConfigured, joinWaitlist } from "@/lib/db";

const requestSchema = z.object({
  // Trim + lowercase BEFORE validating, so " Person@Example.COM " both passes email
  // validation and is stored in a single canonical form (future dedupe can't be defeated
  // by casing or stray whitespace). Bounded at 254 — the RFC 5321 practical maximum — so
  // this public, unauthenticated, unmetered write can't be used to stuff huge rows.
  email: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.email().max(254),
  ),
  feature: z.enum(["network", "outreach", "general"]),
});

/**
 * Capture a "notify me" signup from the landing page for a feature that hasn't shipped
 * yet. Public and unauthenticated on purpose — it runs before a visitor has any reason to
 * sign in.
 */
export async function POST(request: Request) {
  if (!isPersistenceConfigured()) {
    return NextResponse.json(
      { error: "CONFIG_ERROR", message: "The waitlist needs Supabase configured." },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: `${issue.path.join(".") || "body"}: ${issue.message}` },
      { status: 400 },
    );
  }

  const saved = await joinWaitlist(parsed.data);
  if (!saved) {
    return NextResponse.json(
      { error: "PERSISTENCE_ERROR", message: "Could not save your signup. Try again in a moment." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
