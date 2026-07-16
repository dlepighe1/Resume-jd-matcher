import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/waitlist/route";
import { isPersistenceConfigured, joinWaitlist } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  isPersistenceConfigured: vi.fn(),
  joinWaitlist: vi.fn(),
}));

function notify(body: unknown) {
  return POST(
    new Request("http://localhost/api/waitlist", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

function notifyRaw(rawBody: string) {
  return POST(
    new Request("http://localhost/api/waitlist", {
      method: "POST",
      body: rawBody,
    }),
  );
}

beforeEach(() => {
  // Without this, call history leaks across tests and every not.toHaveBeenCalled()
  // assertion sees the previous test's call.
  vi.clearAllMocks();
  vi.mocked(isPersistenceConfigured).mockReturnValue(true);
  vi.mocked(joinWaitlist).mockResolvedValue(true);
});

describe("POST /api/waitlist", () => {
  it("rejects an invalid email", async () => {
    const response = await notify({ email: "not-an-email", feature: "network" });

    expect(response.status).toBe(400);
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("rejects an unknown feature value", async () => {
    const response = await notify({ email: "person@example.com", feature: "bogus" });

    expect(response.status).toBe(400);
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("rejects a body that is not valid JSON", async () => {
    const response = await notifyRaw("this is not json {");

    expect(response.status).toBe(400);
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("normalizes the email — trims whitespace and lowercases — before inserting", async () => {
    const response = await notify({ email: "  Person@Example.COM ", feature: "network" });

    expect(response.status).toBe(200);
    expect(joinWaitlist).toHaveBeenCalledWith({ email: "person@example.com", feature: "network" });
  });

  it("accepts a valid signup and inserts it", async () => {
    const response = await notify({ email: "person@example.com", feature: "network" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(joinWaitlist).toHaveBeenCalledWith({ email: "person@example.com", feature: "network" });
  });

  it("reports the waitlist as unavailable when Supabase isn't configured", async () => {
    vi.mocked(isPersistenceConfigured).mockReturnValue(false);

    const response = await notify({ email: "person@example.com", feature: "network" });

    expect(response.status).toBe(501);
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("500s when the insert fails", async () => {
    vi.mocked(joinWaitlist).mockResolvedValue(false);

    const response = await notify({ email: "person@example.com", feature: "network" });

    expect(response.status).toBe(500);
  });
});
