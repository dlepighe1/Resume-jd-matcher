import { describe, expect, it } from "vitest";

import { analyzeAtsKeywords } from "@/lib/ats";

describe("keyword coverage", () => {
  it("counts only skills the job description actually asks for", () => {
    const ats = analyzeAtsKeywords(
      "We need Python and Airflow experience.",
      "I know Python, Airflow, Rust, Scala and Kubernetes.",
    )!;

    // Rust/Scala/Kubernetes are on the resume but not in the posting, they are not
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

describe("keyword gap ranking", () => {
  const REQUIREMENTS_JD = `Acme is a wonderful place to work with great people and free lunch.

Requirements:
- 3+ years of Python and SQL for data processing
- Experience building pipelines with Airflow
- Python testing experience is essential
- Familiarity with Docker`;

  const EMPTY_RESUME = "I once used Microsoft Excel for a spreadsheet at a previous employer.";

  it("ranks a skill named twice inside requirements as high priority", () => {
    const result = analyzeAtsKeywords(REQUIREMENTS_JD, EMPTY_RESUME)!;
    const python = result.gaps.find((g) => g.keyword === "python")!;

    expect(python.occurrences).toBeGreaterThanOrEqual(2);
    expect(python.inRequirements).toBe(true);
    expect(python.priority).toBe("high");
  });

  it("ranks a skill named once inside requirements below one named twice", () => {
    const result = analyzeAtsKeywords(REQUIREMENTS_JD, EMPTY_RESUME)!;
    const docker = result.gaps.find((g) => g.keyword === "docker")!;

    expect(docker.inRequirements).toBe(true);
    expect(docker.occurrences).toBe(1);
    expect(docker.priority).toBe("medium");
  });

  it("treats a skill mentioned only in the company blurb as low priority", () => {
    const jd = `We are a Kubernetes shop and proud of it, with a lovely office.

Requirements:
- 3+ years of Python`;
    const result = analyzeAtsKeywords(jd, EMPTY_RESUME)!;
    const k8s = result.gaps.find((g) => g.keyword === "kubernetes")!;

    expect(k8s.inRequirements).toBe(false);
    expect(k8s.occurrences).toBe(1);
    expect(k8s.priority).toBe("low");
  });

  it("returns gaps sorted most prominent first", () => {
    const { gaps } = analyzeAtsKeywords(REQUIREMENTS_JD, EMPTY_RESUME)!;
    const rank = { high: 0, medium: 1, low: 2 } as const;

    for (let i = 1; i < gaps.length; i++) {
      expect(rank[gaps[i - 1].priority]).toBeLessThanOrEqual(rank[gaps[i].priority]);
    }
  });

  it("only ranks skills the resume is actually missing", () => {
    const resume = "I have five years of Python and SQL experience building Airflow pipelines.";
    const result = analyzeAtsKeywords(REQUIREMENTS_JD, resume)!;

    expect(result.gaps.map((g) => g.keyword)).not.toContain("python");
    expect(result.gaps.map((g) => g.keyword)).toEqual(result.missing);
  });

  it("handles a posting with no requirements heading without crashing", () => {
    const jd = "We want someone who knows Python and Docker. That is the whole posting.";
    const result = analyzeAtsKeywords(jd, EMPTY_RESUME)!;

    expect(result.gaps.every((g) => g.inRequirements === false)).toBe(true);
    expect(result.gaps.length).toBeGreaterThan(0);
  });
});
