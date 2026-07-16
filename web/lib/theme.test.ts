import { describe, it, expect } from "vitest";
import { nextTheme } from "./theme";

describe("nextTheme", () => {
  it("toggles light -> dark", () => { expect(nextTheme("light")).toBe("dark"); });
  it("toggles dark -> light", () => { expect(nextTheme("dark")).toBe("light"); });
});
