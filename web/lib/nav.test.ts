import { describe, it, expect } from "vitest";
import { NAV_ITEMS, comingSoonHrefs } from "./nav";

describe("nav config", () => {
  it("has the four Phase-1 tabs in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Matcher", "Applications", "Network", "Outreach",
    ]);
  });
  it("marks Network and Outreach as coming soon", () => {
    expect(comingSoonHrefs()).toEqual(["/network", "/outreach"]);
  });
  it("Matcher is the default tab", () => {
    expect(NAV_ITEMS[0]).toMatchObject({ href: "/matcher", comingSoon: false });
  });
});
