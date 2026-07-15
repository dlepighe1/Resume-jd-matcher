import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));

import { getUserIdOrNull, requireUserId, UnauthorizedError } from "./auth";

beforeEach(() => authMock.mockReset());

describe("getUserIdOrNull", () => {
  it("returns the userId when signed in", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });
    expect(await getUserIdOrNull()).toBe("user_123");
  });
  it("returns null when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });
    expect(await getUserIdOrNull()).toBeNull();
  });
});

describe("requireUserId", () => {
  it("returns the userId when signed in", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });
    expect(await requireUserId()).toBe("user_123");
  });
  it("throws UnauthorizedError when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });
    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
