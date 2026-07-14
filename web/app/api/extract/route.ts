import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Server-side PDF text extraction.
 *
 * Server-side on purpose: shipping a PDF parser to every visitor would cost every page
 * load a few hundred KB for a feature most people never use.
 *
 * The extracted text is returned to the client and dropped into the textarea so the user
 * can SEE and FIX it before analyzing. Silent extraction is how two-column resume layouts
 * turn into interleaved garbage and the user never finds out why their score was 31.
 *
 * unpdf (not pdf-parse) because it's built for serverless: no native bindings, no
 * filesystem access, no debug-mode test-file read at import time.
 */
export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many uploads. Slow down a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let file: File | null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: "Expected a multipart form upload." },
      { status: 400 },
    );
  }

  if (!file) {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: "No file was uploaded." },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "TOO_LARGE", message: "That PDF is larger than 5 MB." },
      { status: 413 },
    );
  }

  // Trust the bytes, not the filename or the browser-supplied MIME type: both are
  // attacker-controlled. A real PDF starts with %PDF-.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf =
    bytes.length > 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d; // -

  if (!isPdf) {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: "That file is not a PDF." },
      { status: 400 },
    );
  }

  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const extracted = await extractText(pdf, { mergePages: true });
    text = normalize(
      Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text,
    );
  } catch {
    return NextResponse.json(
      {
        error: "EXTRACTION_FAILED",
        message: "Could not read text from that PDF. If it is a scan, paste the text instead.",
      },
      { status: 422 },
    );
  }

  if (text.length < 100) {
    // Almost certainly a scanned image with no text layer. Say so — an empty textarea
    // with no explanation is the worst possible outcome here.
    return NextResponse.json(
      {
        error: "NO_TEXT_LAYER",
        message:
          "That PDF has no extractable text — it is probably a scan or an image export. Paste the resume text instead.",
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ text, words: text.split(/\s+/).filter(Boolean).length });
}

/** PDF extraction leaves ragged whitespace and hyphenated line breaks. */
function normalize(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/-\n(\w)/g, "$1") // re-join words split across a line break
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
