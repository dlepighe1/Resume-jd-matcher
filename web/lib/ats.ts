/**
 * ATS keyword coverage — deterministic, no model involved.
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
 * the list is invisible here. That's a deliberate trade — the alternative (treating every
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

export interface AtsAnalysis {
  /** Percentage of JD keywords literally present in the resume, 0-100. */
  score: number;
  matched: string[];
  missing: string[];
}

/**
 * Which skills the JD asks for, and which of those literally appear in the resume.
 * Returns null when the JD names no recognisable skills — better to show nothing than a
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
  };
}

/**
 * Whole-term match, so "go" doesn't fire on "going" and "r" doesn't fire on every word
 * containing the letter r — the failure mode that makes naive keyword matchers useless.
 */
function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Skill names contain +, #, /, . — so \b is unreliable at their edges (it would split
  // "c++" and "node.js"). Require an alphanumeric boundary instead: the character on
  // either side must not be a letter or digit.
  //
  // Punctuation MUST count as a boundary, or a skill at the end of a sentence never
  // matches — "Postgres.", "C#.", "Node.js." are all real resume text.
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
