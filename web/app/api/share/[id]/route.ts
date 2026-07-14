import { NextResponse } from "next/server";

import { isPersistenceConfigured, publishAnalysis } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Make a stored analysis publicly readable.
 *
 * Deliberately an explicit action rather than a side effect of running an analysis: the
 * row contains someone's resume, and it stays private until they ask for a link.
 *
 * Next 16: route params are a Promise and must be awaited — synchronous access was
 * removed in this major version.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isPersistenceConfigured()) {
    return NextResponse.json(
      { error: "CONFIG_ERROR", message: "Sharing needs Supabase configured." },
      { status: 501 },
    );
  }

  if (!UUID.test(id)) {
    return NextResponse.json({ error: "NOT_FOUND", message: "No such analysis." }, { status: 404 });
  }

  const published = await publishAnalysis(id);
  if (!published) {
    return NextResponse.json({ error: "NOT_FOUND", message: "No such analysis." }, { status: 404 });
  }

  return NextResponse.json({ id, url: `/results/${id}` });
}
