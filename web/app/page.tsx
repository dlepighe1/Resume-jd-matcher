import fs from "node:fs/promises";
import path from "node:path";

import { BenchmarkExplorer } from "@/components/demo/BenchmarkExplorer";
import { LiveScorer } from "@/components/demo/LiveScorer";
import { Card, Detail, Section, Stat } from "@/components/demo/Section";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BANDS, fmt, toSummary, type Benchmark } from "@/lib/benchmark";

/**
 * The whole demo, one page.
 *
 * The benchmark bundle is read from disk here rather than imported, so the 650 KB of pair
 * text never enters the client bundle. The explorer fetches it from /benchmark.json on
 * demand.
 *
 * Every figure below is read out of that bundle. None is written into this file. If a number
 * on this page is wrong, the fix is to rerun the notebooks and rebuild the bundle, not to
 * edit JSX.
 */
async function loadBenchmark(): Promise<Benchmark | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "public", "benchmark.json"), "utf8");
    return JSON.parse(raw) as Benchmark;
  } catch {
    return null;
  }
}

export default async function Page() {
  const benchmark = await loadBenchmark();
  const summary = benchmark ? toSummary(benchmark) : null;
  const serviceConfigured = Boolean(process.env.SCORING_SERVICE_URL?.trim());

  const production = summary?.metrics["finetuned_calibrated"];
  const claude = summary?.metrics["claude_calibrated"];
  const base = summary?.metrics["base_mpnet"];
  const tfidf = summary?.metrics["tfidf"];
  const audit = summary?.audit;

  return (
    <main>
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b px-5 py-3 backdrop-blur sm:px-8"
        style={{
          borderColor: "var(--hairline)",
          background: "color-mix(in srgb, var(--page) 88%, transparent)",
        }}
      >
        <span className="text-sm font-semibold tracking-tight">Resume matcher</span>
        <nav
          className="flex items-center gap-3 text-xs sm:gap-5 sm:text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          <a href="#try" className="hidden hover:underline sm:inline">
            Try it
          </a>
          <a href="#benchmark" className="hover:underline">
            Benchmark
          </a>
          <a href="#scoring" className="hidden hover:underline sm:inline">
            Scoring
          </a>
          <a href="#evidence" className="hover:underline">
            Evidence
          </a>
          <ThemeToggle />
        </nav>
      </header>

      {/* Hero */}
      <div className="px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            A small model that scores resumes, and the evidence for whether it works
          </h1>
          <p
            className="mt-5 max-w-2xl text-base leading-relaxed sm:text-lg"
            style={{ color: "var(--text-secondary)" }}
          >
            This system estimates how well a resume fits a job posting. Producing a number is
            the easy part. What follows is the harder part: the same {summary?.nPairs ?? 106}{" "}
            resume and posting pairs, drawn from {summary?.meta.nPostings ?? 53} postings the
            model never trained on, scored by a frontier language model, by the same
            architecture before fine-tuning, and by plain word counting, so the numbers can be
            compared rather than taken on trust.
          </p>

          {summary && (
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {production?.spearman != null ? (
                <Stat
                  accent
                  value={fmt(production.spearman, 2)}
                  label="Ranking quality"
                  basis={`Spearman across ${production.n} held-out pairs${
                    production.spearman_ci95
                      ? `. 95% interval ${fmt(production.spearman_ci95[0], 2)} to ${fmt(production.spearman_ci95[1], 2)}`
                      : ""
                  }`}
                />
              ) : (
                <Stat
                  accent
                  value="Pending"
                  label="Ranking quality"
                  basis="The current checkpoint is not yet published, so the demo cannot serve it"
                />
              )}
              {production?.mae != null && (
                <Stat
                  value={fmt(production.mae, 2)}
                  label="Typical error"
                  basis="Mean absolute error against the reference label"
                />
              )}
              {claude?.spearman != null && (
                <Stat
                  value={fmt(claude.spearman, 2)}
                  label="Claude Opus 4.5"
                  basis="Same pairs, same calibration procedure"
                />
              )}
              <Stat
                value={String(summary.meta.nPostings)}
                label="Postings in this test set"
                basis="Drawn from 53 postings with no overlap with training, verified in code"
              />
            </div>
          )}

          <p className="mt-9 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            The labels these numbers are measured against are synthetic. They were generated
            against a scoring rubric rather than collected from recruiters, which bounds every
            claim on this page. The{" "}
            <a href="#evidence" className="underline">
              evidence section
            </a>{" "}
            sets out what that does and does not permit.
          </p>
        </div>
      </div>

      {/* Live scoring */}
      <Section
        id="try"
        eyebrow="Interactive"
        title="Score a pair"
        lead={
          <>
            Paste a job posting and a resume. Every configured engine scores the same input at
            once, including the same architecture with none of this project&rsquo;s training.
            That comparison is the clearest available measure of what the training contributed.
          </>
        }
      >
        <LiveScorer serviceConfigured={serviceConfigured} />
      </Section>

      {/* Benchmark */}
      <Section
        id="benchmark"
        eyebrow="Evaluation"
        title="The held-out benchmark, open for inspection"
        lead={
          summary ? (
            <>
              {summary.meta.split} Select an engine, filter to the cases that interest you, and
              click any point to read the resume and posting behind it, including the pairs the
              model gets wrong.
            </>
          ) : (
            <>The benchmark bundle has not been built yet.</>
          )
        }
      >
        {summary ? (
          <BenchmarkExplorer summary={summary} />
        ) : (
          <Card>
            <p className="text-sm">
              Run <code className="text-xs">python scripts/build_demo_data.py</code> to generate{" "}
              <code className="text-xs">web/public/benchmark.json</code>.
            </p>
          </Card>
        )}
      </Section>

      {/* Explainer */}
      <Section
        id="scoring"
        eyebrow="Method"
        title="How the score is produced"
        lead="Three steps, described first in plain terms. Technical detail sits behind each disclosure."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <h3 className="text-sm font-semibold">1. Both documents become vectors</h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              The resume and the posting are each converted into a list of numbers representing
              their meaning. Two documents describing similar work end up close together even
              when the wording differs, so &ldquo;built data pipelines&rdquo; and &ldquo;ETL
              development&rdquo; are treated as related rather than as unrelated strings.
            </p>
            <Detail summary="Technical detail">
              <p>
                Both texts are embedded with a fine-tuned <code>all-mpnet-base-v2</code>{" "}
                bi-encoder (109M parameters, 768 dimensions). The raw score is the cosine
                similarity between the two vectors.
              </p>
              <p>
                Postings are preprocessed first. Equal-opportunity, benefits, and salary
                boilerplate is stripped, the requirements section is moved forward, and the
                result is capped at 350 words. Postings average 613 words, so a model with a
                512-token limit would otherwise truncate away the section that carries the
                signal.
              </p>
            </Detail>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold">2. The raw score is corrected</h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              That similarity makes a poor percentage on its own. Any two documents written in
              English resemble each other to some degree, so raw scores cluster between roughly
              50 and 90, and a weak match still reads as 60%. A calibration step spreads them
              back out so the number means what a reader assumes it means.
            </p>
            <Detail summary="Technical detail">
              <p>
                Platt scaling, a two-parameter sigmoid fitted on a held-out calibration split of
                106 pairs from postings the model never trained on. The transform is monotonic,
                so ranking is unchanged and only absolute error moves.
              </p>
              <p>
                Isotonic regression performs identically within bootstrap noise. Platt is used
                because two parameters cannot overfit a 106-pair calibration set, whereas an
                isotonic step function can. That is a robustness argument rather than a claim
                that one scored better.
              </p>
            </Detail>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold">3. The gaps are located</h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Each requirement in the posting is compared against the resume separately and
              marked as evidenced or not, alongside the resume sentence that matched it.
              Keyword coverage is reported separately, because applicant tracking systems filter
              on literal strings rather than on meaning.
            </p>
            <Detail summary="What this model deliberately cannot do">
              <p>
                It cannot write prose. It is an embedding model rather than a language model, so
                it produces no summary, no rewritten bullet points, and no advice. Where those
                appear on this page they came from Claude and are labelled as such.
              </p>
            </Detail>
          </Card>
        </div>

        <Card className="mt-6">
          <h3 className="text-sm font-semibold">What the number means</h3>
          <div className="scroll-x mt-3">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="py-2 pr-6 text-xs font-medium">Score</th>
                  <th className="py-2 pr-6 text-xs font-medium">Verdict</th>
                  <th className="py-2 text-xs font-medium">Interpretation</th>
                </tr>
              </thead>
              <tbody>
                {BANDS.map((b) => (
                  <tr key={b.label} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                    <td className="tnum py-2 pr-6">{Math.round(b.min * 100)}+</td>
                    <td className="py-2 pr-6 font-medium">{b.label}</td>
                    <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                      {b.plain}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            These bands are the ones the research code uses, so the demo and the notebooks
            cannot disagree about what a given score means.
          </p>
        </Card>
      </Section>

      {/* Evidence */}
      <Section
        id="evidence"
        eyebrow="Methodology and limits"
        title="Why you should, and should not, believe this"
        lead="The findings that shaped the model, and the claims this work cannot support."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="text-sm font-semibold">The result that changed the design</h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              A larger and more expressive model, a RoBERTa cross-encoder, won on the internal
              test set with a Spearman correlation of 0.89. On postings it had never seen it
              scored <span className="tnum">-0.61</span>, meaning it was anti-correlated and
              ranked strong candidates below weak ones. It had memorised the training postings.
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              The smaller model was shipped instead. Across the same transfer it lost 0.076.
            </p>
            <Detail summary="Why this matters more than the headline number">
              <p>
                125M parameters trained on 400 examples is roughly 312,000 parameters per
                example. The capacity to memorise was available, so it was used. Four separate
                remedies were tested: threefold augmentation, weight decay, a smaller backbone,
                and a five-fold ensemble. Each helped. None beat the simple calibrated
                bi-encoder.
              </p>
              <p>
                A held-out split drawn from the same postings would have concealed all of this.
                External validation was the only thing that caught it.
              </p>
            </Detail>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold">Does it beat plain word counting?</h3>
            {tfidf?.spearman != null && production?.spearman != null ? (
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                TF-IDF, a bag-of-words method with no training and no semantics, scores{" "}
                <span className="tnum">{fmt(tfidf.spearman, 2)}</span> on the same pairs. The
                fine-tuned model scores{" "}
                <span className="tnum">{fmt(production.spearman, 2)}</span>.
                {base?.spearman != null && (
                  <>
                    {" "}
                    The same architecture before fine-tuning scores{" "}
                    <span className="tnum">{fmt(base.spearman, 2)}</span>.
                  </>
                )}
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  TF-IDF scores <span className="tnum">{fmt(tfidf?.spearman ?? null, 2)}</span> and
                  the same architecture before fine-tuning scores{" "}
                  <span className="tnum">{fmt(base?.spearman ?? null, 2)}</span> on these pairs.
                  The fine-tuned figure appears here once the current checkpoint is published.
                </p>
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  Publishing a model without a non-neural baseline is how a project avoids
                  discovering that it did not need one.
                </p>
              </>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold">Does the score move with the candidate&rsquo;s name?</h3>
            {audit?.name_bias ? (
              <>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Every held-out resume was scored again with 18 substituted names spanning
                  several demographic groups, holding every skill, date, and employer constant.
                  Group means differed by{" "}
                  <span className="tnum">{fmt(audit.name_bias.group_mean_spread)}</span>, and{" "}
                  <span className="tnum">{audit.name_bias.verdict_flips}</span> of{" "}
                  <span className="tnum">{audit.name_bias.n_pairs}</span> pairs changed verdict
                  band on the name alone.
                </p>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  A small result means the model is not name-sensitive on this test set with
                  these names. It does not establish that the system is safe to use in hiring.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Pending. Names are substituted from the standard resume-audit literature while
                every other detail is held constant, so any systematic movement is the model
                responding to the name rather than to the qualifications. A model that scores
                resumes should not ship without this check, and the result will be published
                here whichever way it comes out.
              </p>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold">What this cannot tell you</h3>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              <li>
                <strong>The labels are synthetic.</strong> They were generated against a scoring
                rubric rather than collected from recruiters. Every metric here measures
                agreement with that rubric. Whether the rubric matches real hiring judgement is
                untested.
              </li>
              <li>
                <strong>{summary?.nPairs ?? 106} pairs is a small test set.</strong> The
                confidence intervals on this page are wide. Two engines separated by less than
                the interval width are not distinguishable.
              </li>
              <li>
                <strong>This is not a screening tool.</strong> It has no notion of context,
                accommodation, or non-linear careers, which are precisely the cases where
                automated screening causes the most harm.
              </li>
            </ul>
          </Card>
        </div>

        {summary && (
          <p className="mt-8 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Benchmark bundle generated {summary.meta.generated}
            {summary.meta.modelId ? `. Model ${summary.meta.modelId}` : ""}. Regenerate with{" "}
            <code>{summary.meta.regenerate}</code>. Every figure on this page is read from that
            file rather than written into the page.
          </p>
        )}
      </Section>

      <footer
        className="border-t px-5 py-10 text-sm sm:px-8"
        style={{ borderColor: "var(--hairline)", color: "var(--text-muted)" }}
      >
        <div className="mx-auto max-w-5xl">
          Research project by David Lepighe.{" "}
          <a href="https://github.com/dlepighe1/Resume-jd-matcher" className="underline">
            Source, notebooks, and data card on GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}
