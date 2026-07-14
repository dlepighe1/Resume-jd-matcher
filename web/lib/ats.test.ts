import { describe, expect, it } from "vitest";

import { analyzeAtsKeywords } from "@/lib/ats";

describe("keyword coverage", () => {
  it("counts only skills the job description actually asks for", () => {
    const ats = analyzeAtsKeywords(
      "We need Python and Airflow experience.",
      "I know Python, Airflow, Rust, Scala and Kubernetes.",
    )!;

    // Rust/Scala/Kubernetes are on the resume but not in the posting — they are not
    // credit, and they are not gaps. They simply aren't relevant to this job.
    expect(ats.matched.sort()).toEqual(["airflow", "python"]);
    expect(ats.missing).toEqual([]);
    expect(ats.score).toBe(100);
  });

  it("flags a keyword the posting wants and the resume never says", () => {
    const ats = analyzeAtsKeywords(
      "Requires Python, Airflow and Kubernetes at scale.",
      "Five years of Python and Airflow pipelines.",
    )!;

    expect(ats.missing).toEqual(["kubernetes"]);
    expect(ats.score).toBe(67); // 2 of 3
  });

  it("resolves aliases to the same skill", () => {
    // The whole point: a resume saying "k8s" satisfies a JD saying "Kubernetes", and an
    // ATS that can't see that is why good candidates get filtered out.
    const ats = analyzeAtsKeywords(
      "Kubernetes and PostgreSQL and machine learning required.",
      "Ran k8s clusters against Postgres. Strong ML background.",
    )!;

    expect(ats.missing).toEqual([]);
    expect(ats.score).toBe(100);
  });

  it("does not match a skill inside a longer word", () => {
    // "go" must not fire on "going", and "r" must not fire on every word containing r.
    // This is the failure mode that makes naive keyword matchers worthless.
    const ats = analyzeAtsKeywords(
      "We are looking for Go and R experience.",
      "I am going to be great. I organize repositories regularly.",
    )!;

    expect(ats.matched).toEqual([]);
    expect(ats.missing.sort()).toEqual(["go", "r"]);
  });

  it("matches skills whose names contain punctuation", () => {
    const ats = analyzeAtsKeywords(
      "Needs C++, C#, CI/CD and Node.js.",
      "Built services in C++ and C#. Owned CI/CD. Wrote Node.js APIs.",
    )!;

    expect(ats.missing).toEqual([]);
  });

  it("matches a plural on the resume against a singular in the posting", () => {
    // Caught live: the resume said "ETL pipelines", the posting said "pipeline", and the
    // keyword was reported as absent. A trailing "s" must not defeat a match.
    const ats = analyzeAtsKeywords(
      "You will own the data pipeline and the data warehouse.",
      "Built ETL pipelines and data warehouses at scale.",
    )!;

    expect(ats.missing).toEqual([]);
  });

  it("does not pluralise short or symbolic skills into false matches", () => {
    // "go" + s would start matching "gos"; "r" + s would match "rs". Worse than the bug
    // it fixes, so pluralisation is restricted to alphabetic terms of 4+ characters.
    const ats = analyzeAtsKeywords("Go and R required.", "I use gos and rs daily.")!;

    expect(ats.matched).toEqual([]);
  });

  it("returns null when the posting names no recognisable skills", () => {
    // Better to show nothing than a meaningless 0%.
    expect(
      analyzeAtsKeywords(
        "We are a fast-paced team looking for a self-starter with great energy.",
        "I am a self-starter.",
      ),
    ).toBeNull();
  });

  it("is case insensitive in both directions", () => {
    const ats = analyzeAtsKeywords("PYTHON and sql required", "python and SQL")!;

    expect(ats.score).toBe(100);
  });
});
