import { describe, it, expect } from "vitest";
import { NAV_ITEMS, comingSoonHrefs } from "./nav";

describe("nav config", () => {
  it("has the six sidebar tabs in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Dashboard", "Applications", "Resume", "Network", "Outreach", "Settings",
    ]);
  });
  it("has empty coming soon hrefs since all are active", () => {
    expect(comingSoonHrefs()).toEqual([]);
  });
  it("Dashboard is the default tab", () => {
    expect(NAV_ITEMS[0]).toMatchObject({ href: "/dashboard" });
  });
});