import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/share/[id]/route";
import { isPersistenceConfigured, publishAnalysis } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  isPersistenceConfigured: vi.fn(),
  publishAnalysis: vi.fn(),
}));

const VALID_UUID = "3f2a7c1e-9b4d-4e2a-8f11-2c6d5e7a9b30";

function share(id: string) {
  return POST(new Request(`http://localhost/api/share/${id}`, { method: "POST" }), {
    // Next 16: route params arrive as a Promise.
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  // Without this, call history leaks across tests and every not.toHaveBeenCalled()
  // assertion sees the previous test's call.
  vi.clearAllMocks();
  vi.mocked(isPersistenceConfigured).mockReturnValue(true);
  vi.mocked(publishAnalysis).mockResolvedValue(true);
});

describe("POST /api/share/[id]", () => {
  it("publishes a stored analysis and returns its public URL", async () => {
    const response = await share(VALID_UUID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: VALID_UUID,
      url: `/results/${VALID_UUID}`,
    });
    expect(publishAnalysis).toHaveBeenCalledWith(VALID_UUID);
  });

  it("404s an id that isn't a UUID, without touching the database", async () => {
    const response = await share("../../etc/passwd");

    expect(response.status).toBe(404);
    expect(publishAnalysis).not.toHaveBeenCalled();
  });

  it("404s an id that does not exist", async () => {
    vi.mocked(publishAnalysis).mockResolvedValue(false);

    const response = await share(VALID_UUID);

    expect(response.status).toBe(404);
  });

  it("reports sharing as unavailable when Supabase isn't configured", async () => {
    vi.mocked(isPersistenceConfigured).mockReturnValue(false);

    const response = await share(VALID_UUID);

    expect(response.status).toBe(501);
    expect(publishAnalysis).not.toHaveBeenCalled();
  });
});
