/**
 * ATS keyword coverage, deterministic, no model involved.
 *
 * This is NOT a worse version of the semantic score; it answers a different question.
 * Applicant tracking systems filter on literal string matches. A resume can be a perfect
 * semantic fit and still be discarded by a keyword filter because it says "orchestration
 * tooling" where the JD says "Airflow". The model can see through that. The ATS cannot,
 * and the ATS is what stands between the candidate and a human reader.
 *
 * So it runs on every analysis, for every engine, and is reported alongside the score.
 *
 * Honest limitation: matching against a curated vocabulary means a skill that isn't in
 * the list is invisible here. That's a deliberate trade, the alternative (treating every
 * capitalised noun as a skill) produces noise like "Acme" and "PTO" as missing keywords.
 */

/** Canonical skill -> the surface forms that mean the same thing. */
const SKILL_ALIASES: Record<string, string[]> = {
  python: [],
  sql: [],
  java: [],
  javascript: ["js"],
  typescript: ["ts"],
  go: ["golang"],
  rust: [],
  scala: [],
  r: [],
  "c++": ["cpp"],
  "c#": ["csharp", ".net", "dotnet"],
  ruby: [],
  php: [],
  swift: [],
  kotlin: [],

  airflow: ["apache airflow"],
  spark: ["apache spark", "pyspark"],
  kafka: ["apache kafka"],
  dbt: [],
  hadoop: [],
  flink: [],
  snowflake: [],
  databricks: [],
  redshift: [],
  bigquery: [],
  etl: ["elt"],

  aws: ["amazon web services"],
  gcp: ["google cloud"],
  azure: [],
  s3: [],
  lambda: [],
  ec2: [],
  kubernetes: ["k8s"],
  docker: ["containerization", "containerisation"],
  terraform: [],
  ansible: [],
  jenkins: [],
  "ci/cd": ["cicd", "continuous integration", "continuous delivery"],

  postgresql: ["postgres"],
  mysql: [],
  mongodb: ["mongo"],
  redis: [],
  elasticsearch: [],
  cassandra: [],
  dynamodb: [],

  pytorch: [],
  tensorflow: [],
  "scikit-learn": ["sklearn", "scikit learn"],
  pandas: [],
  numpy: [],
  keras: [],
  huggingface: ["hugging face"],
  llm: ["large language model", "large language models"],
  nlp: ["natural language processing"],
  "machine learning": ["ml"],
  "deep learning": [],
  "computer vision": [],
  mlops: [],

  statistics: ["statistical"],
  "a/b testing": ["ab testing", "a/b test", "experimentation", "experimental design"],
  "data modeling": ["data modelling"],
  "data warehouse": ["data warehousing"],
  etl_pipeline: ["data pipeline", "data pipelines"],
  visualization: ["visualisation", "tableau", "looker", "power bi"],

  react: ["react.js", "reactjs"],
  nextjs: ["next.js"],
  vue: ["vue.js"],
  angular: [],
  "node.js": ["nodejs", "node"],
  graphql: [],
  rest: ["rest api", "restful"],
  microservices: [],
  html: [],
  css: [],
  tailwind: [],

  git: [],
  agile: ["scrum"],
  linux: ["unix"],
  bash: ["shell scripting"],
  grafana: [],
  prometheus: [],
  datadog: [],
};

/** How prominently the posting asks for a skill the resume does not mention. */
export interface KeywordGap {
  keyword: string;
  /** Times the posting mentions it, counting aliases. */
  occurrences: number;
  /** Whether it appears in or after the requirements section rather than only in the intro. */
  inRequirements: boolean;
  priority: "high" | "medium" | "low";
}

export interface AtsAnalysis {
  /** Percentage of JD keywords literally present in the resume, 0-100. */
  score: number;
  matched: string[];
  missing: string[];
  /** `missing`, ordered most prominent first. */
  gaps: KeywordGap[];
}

/**
 * Section headings that begin the part of a posting where the real requirements live.
 * Mirrors REQUIREMENT_SECTION_PATTERNS in src/text_utils.py, which is what the model was
 * trained under, so the two never disagree about where a posting's requirements start.
 */
const REQUIREMENTS_HEADING =
  /(requirements?|qualifications?|what you.?ll need|must have|responsibilities|what you.?ll do|in this role|you will)/i;

/**
 * Which skills the JD asks for, and which of those literally appear in the resume.
 * Returns null when the JD names no recognisable skills, better to show nothing than a
 * meaningless 0%.
 */
export function analyzeAtsKeywords(jobDescription: string, resumeText: string): AtsAnalysis | null {
  const jd = jobDescription.toLowerCase();
  const resume = resumeText.toLowerCase();

  const matched: string[] = [];
  const missing: string[] = [];

  for (const [skill, aliases] of Object.entries(SKILL_ALIASES)) {
    const surfaceForms = [skill.replace(/_/g, " "), ...aliases];

    const jdWantsIt = surfaceForms.some((form) => containsTerm(jd, form));
    if (!jdWantsIt) continue;

    const label = skill.replace(/_/g, " ");
    if (surfaceForms.some((form) => containsTerm(resume, form))) matched.push(label);
    else missing.push(label);
  }

  const total = matched.length + missing.length;
  if (total === 0) return null;

  return {
    score: Math.round((matched.length / total) * 100),
    matched,
    missing,
    gaps: rankGaps(jobDescription, missing),
  };
}

/**
 * Order the missing skills by how prominently the posting asks for them.
 *
 * Prominence is measured from the posting alone: how many times a skill is named, and
 * whether it appears in the requirements section rather than only in the company blurb. Both
 * are deterministic and inspectable, which is the point. This is emphatically **not** a
 * prediction of how much the match score would rise if the skill were added. Producing such
 * a number without measuring it would be the kind of confident invention this project exists
 * to argue against, and measuring it properly would mean re-scoring the resume once per
 * candidate keyword.
 *
 * A posting that names Airflow twice inside its requirements is telling you something a
 * posting that mentions it once under "nice to have" is not.
 */
function rankGaps(jobDescription: string, missing: string[]): KeywordGap[] {
  const jd = jobDescription.toLowerCase();
  const headingMatch = REQUIREMENTS_HEADING.exec(jd);
  const requirementsFrom = headingMatch ? headingMatch.index : null;
  const requirementsText = requirementsFrom === null ? "" : jd.slice(requirementsFrom);

  return missing
    .map((keyword) => {
      const canonical = keyword.replace(/ /g, "_");
      const surfaceForms = [keyword, ...(SKILL_ALIASES[canonical] ?? SKILL_ALIASES[keyword] ?? [])];

      const occurrences = surfaceForms.reduce((sum, form) => sum + countTerm(jd, form), 0);
      const inRequirements =
        requirementsFrom !== null && surfaceForms.some((form) => containsTerm(requirementsText, form));

      const priority: KeywordGap["priority"] =
        inRequirements && occurrences >= 2 ? "high" : inRequirements || occurrences >= 2 ? "medium" : "low";

      return { keyword, occurrences, inRequirements, priority };
    })
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
      if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences;
      return a.keyword.localeCompare(b.keyword);
    });
}

/** Occurrences of a term under the same boundary rules `containsTerm` uses. */
function countTerm(haystack: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pluralizable = /^[a-z ]{4,}$/i.test(term);
  const suffix = pluralizable ? "s?" : "";
  const matches = haystack.match(new RegExp(`(^|[^a-z0-9])${escaped}${suffix}([^a-z0-9]|$)`, "gi"));
  return matches ? matches.length : 0;
}

/**
 * Whole-term match, so "go" doesn't fire on "going" and "r" doesn't fire on every word
 * containing the letter r, the failure mode that makes naive keyword matchers useless.
 */
function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Skill names contain +, #, /, ., so \b is unreliable at their edges (it would split
  // "c++" and "node.js"). Require an alphanumeric boundary instead: the character on
  // either side must not be a letter or digit.
  //
  // Punctuation MUST count as a boundary, or a skill at the end of a sentence never
  // matches. "Postgres.", "C#.", "Node.js." are all real resume text.
  //
  // This still blocks the failure mode that makes naive matchers useless: "go" inside
  // "going" and "sql" inside "postgresql" are both rejected, because the adjacent
  // character is a letter.
  //
  // Allow an optional trailing "s" so a resume saying "ETL pipelines" satisfies a posting
  // saying "pipeline". Restricted to alphabetic terms of 4+ characters: applying it to
  // "r" or "go" would start matching "rs" and "gos", which is worse than the problem.
  const pluralizable = /^[a-z ]{4,}$/i.test(term);
  const suffix = pluralizable ? "s?" : "";

  return new RegExp(`(^|[^a-z0-9])${escaped}${suffix}([^a-z0-9]|$)`, "i").test(haystack);
}
