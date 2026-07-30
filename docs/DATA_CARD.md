# Data card: ResumeAI resume and job-description matching

Every dataset in `Data/`, how it was made, and what it does not support. The short version:
**the job descriptions are real, the resumes and the match scores are not.** That single fact
bounds every claim this project makes, so it is stated first rather than buried in a
limitations section.

---

## 1. Files

| File | Pairs | Unique JDs | Unique resumes | Role |
|---|---|---|---|---|
| `resume_jd_training_500.csv` | 500 | 150 | 500 | Training set for notebooks 01–04 |
| `resume_jd_training_800.csv` | 815 | 255 | 815 | Training set for notebook 05 (production). Superset of the 500 file: 500 `original` rows + 315 `expansion` rows |
| `external_test_200_pairs.csv` | 212 | 53 | 212 | Held-out evaluation. **Zero JD overlap with either training file**, asserted in notebook 05 cell 2, not assumed |

The 800 file being a strict superset of the 500 file is what makes notebooks 01–04 and 05
comparable: the difference between them is added data, not different data.

---

## 2. Provenance

### Job descriptions, real

Scraped from ~1,150 public LinkedIn job postings, then curated down to 255 (training) + 53
(external) unique postings spanning 14 industries and 4 seniority levels. Company names are
replaced with `[Company]` in some postings. Text is otherwise as posted, including the
boilerplate (EEO statements, benefits blocks, salary ranges) that `smart_truncate_jd`
exists to strip.

Postings average **613 words** (range 232–1,703). That length is the reason preprocessing
matters: a 512-token model sees roughly the first 380 words, and in a typical posting the
requirements section starts after that.

### Resumes, synthetic

Generated to pair against those real postings across a controlled grid of seniority levels
and match qualities, then hand-reviewed. Names, contact details, employers, and dates are
fabricated. Resumes average **200 words** (range 70–421).

Names in the generated resumes are demographically varied by construction (the set includes
e.g. Amara Cruz, Omar Lee, Tariq Volkov, Priya Lee, Kenji Anderson, Tomoko Garcia). This was
a generation choice rather than a validated debiasing measure. Notebook 06 tests whether
the trained model is name-sensitive instead of assuming that diverse training names
prevented the problem.

### Match scores, synthetic, rubric-derived

**This is the project's binding limitation.** Each pair carries a 0–1 score assigned against a
five-band rubric, plus a free-text `reasoning` field recording the rationale
(e.g. *"Some transferable skills present but significant gaps in core requirements. Resume
shows adjacent experience that could transfer with upskilling. Ambiguous match."*).

Scores were generated to the rubric and hand-curated. They are **not** recruiter judgments,
not interview outcomes, and not hiring decisions.

---

## 3. Label schema

| `match_type` | Score range | Train n | Ext n | Meaning |
|---|---|---|---|---|
| `strong` | 0.801 – 0.948 | 206 | 53 | Meets essentially all core requirements with direct evidence |
| `good` | 0.601 – 0.800 | 200 | 27 | Meets most core requirements; gaps are secondary |
| `partial` | 0.351 – 0.599 | 163 | 26 | Meets some core requirements; at least one significant gap |
| `hard_negative` | 0.151 to 0.348 | 141 | 53 | **Keyword-dense but wrong role.** The discriminating case |
| `weak` | 0.051 – 0.200 | 105 | 53 | Different role, different domain, or level mismatch |

The bands are **disjoint by construction**: no `good` pair scores below any `partial` pair.
This makes the labels cleaner than reality. A real recruiter panel would disagree in the
boundary regions, so a model that ranks perfectly here has not been tested against genuine
label ambiguity.

### Hard-negative subtypes

Only the training files carry `hard_neg_subtype`; the external set does not.

| Subtype | n | What it tests |
|---|---|---|
| `impressive_irrelevant` | 30 | Strong candidate in the wrong field. Does the model reward prestige over fit? |
| `keyword_overlap` | 22 | Shared vocabulary, different role (QA-automation Python vs backend Python) |
| `wrong_specialization` | 19 | Right field, wrong sub-discipline |

These are the pairs a keyword matcher fails on, and they are why the project uses semantic
similarity at all.

---

## 4. Composition

**Industries (14, both sets):** Cybersecurity · Data Science/ML/AI · Design/UX/Creative ·
DevOps/Infrastructure · Education/EdTech · Finance/Banking · Healthcare/Biotech ·
Human Resources · Legal/Compliance · Manufacturing/Operations · Marketing/Growth ·
Product Management · Sales/Business Development · Software Engineering/Tech

**Seniority, training:** mid 292 · senior 238 · lead 145 · entry 140 (JD level)
**Seniority, external:** mid 56 · senior 56 · lead 52 · entry 48

**External set structure:** exactly **4 candidate resumes per posting**, 53 postings. This is
deliberate: it makes precision@1 ("did the system put the right candidate on top?")
well-defined, against a 25% random baseline.

The external set is intentionally harder than training: `hard_negative` and `weak` are 50% of
it (106/212) versus 30% of training, and it includes career changers, overqualified
candidates, and keyword-stuffed mismatches.

---

## 5. Splits

| Split | Size | Used for |
|---|---|---|
| Training | 85% of the training file | Model fitting |
| Validation | 15% of the training file | Epoch monitoring; isotonic calibration in notebooks 02–03 |
| External calibration | 106 (half the external set) | Fitting Platt/isotonic calibrators, notebook 05 |
| **External final test** | **106** | **Every reported headline number** |

All splits are stratified by `match_type` at `random_state=42`. The external split seed is
fixed independently of the training seed, so all three training seeds in notebook 05 are
evaluated on identical test pairs.

Notebooks 01–04 report an **internal** test set drawn from the same postings used for
training. Those numbers are diagnostic only. Notebook 03 exists specifically to show how far
they can mislead (a cross-encoder at 0.89 internal scored −0.61 external).

---

## 6. What this data does not support

1. **Any claim about real hiring outcomes.** The labels encode a rubric. Whether that rubric
   tracks recruiter judgment is untested, and it is the largest open question in the project.
   Every metric in this repo measures fidelity to the rubric.

2. **Any claim of fairness in deployment.** Notebook 06 runs a name-substitution sensitivity
   audit, which tests one specific failure mode on one test set with one set of proxy names.
   A clean result there means "not name-sensitive under this test", not "safe for hiring
   decisions". That claim needs real outcome data, a defined use context, and review by
   people who did not build the model.

3. **Narrow confidence.** 106 final-test pairs produce wide intervals. Notebook 05 reports
   bootstrap 95% CIs for this reason. Differences smaller than the interval width are noise. That includes the Platt versus isotonic gap, which is why that comparison is settled by a bootstrap rather than by whichever number happens to be lower.

4. **Per-industry guarantees.** 14 industries across 106 test pairs is ~7–8 pairs each. Those
   breakdowns are directional.

5. **Generalization beyond US English white-collar roles.** All postings are US LinkedIn,
   English-language, office-based. Nothing here says anything about trades, hourly work,
   non-US markets, or other languages.

6. **Resume-format robustness.** Every resume is clean plain text with consistent section
   headers. Real resumes arrive as two-column PDFs, tables, and scans. Extraction quality is
   an untested upstream dependency.

---

## 7. Intended and unintended use

**Intended:** research into calibrated semantic matching; a portfolio demonstration of
external validation and honest model comparison; candidate-facing self-assessment ("where are
my gaps against this posting?").

**Not intended:** automated screening, ranking, or rejection of real applicants. The model
produces a similarity score against a synthetic rubric. It has no notion of context,
accommodation, non-linear career paths, or anything a resume does not literally state, and
those are exactly the cases where automated screening does the most harm.

---

## 8. Provenance and licensing caveats

Job-description text was scraped from public LinkedIn postings. It is included here for
research reproducibility. The text remains the property of the posting organizations; it is
not offered under this repository's license, and redistribution for commercial use is not
granted. Resumes and scores are synthetic and carry no personal data.

If you are reusing this data, re-derive the JD corpus from your own source rather than
treating this copy as licensed.

---

## 9. Roadmap

- **Recruiter-labeled gold set.** The single highest-value addition. Even 200 pairs with 3
  independent raters would give an inter-annotator agreement figure and let every current
  metric be re-expressed against human judgment.
- **Label-ambiguity band.** Deliberately include boundary pairs where raters disagree, and
  measure whether the model's uncertainty tracks theirs.
- **Real resume text** with permission, to test extraction and formatting robustness.
- **Non-US and non-English postings.**

*Last updated: 2026-07-27 · counts verified directly from the CSVs in `Data/`*
