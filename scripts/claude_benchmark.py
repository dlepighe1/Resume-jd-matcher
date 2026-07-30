"""
Benchmark Claude (Opus 4.8) against the fine-tuned MPNet on the SAME 106 held-out
resume/JD pairs, so the resume can quote a defensible "Claude scored X vs the
fine-tuned model's 0.865 Spearman / 0.102 MAE" line.

WHAT THIS DOES
--------------
1. Loads Data/external_test_200_pairs.csv (212 pairs, ground-truth `score` in 0..1).
2. Reproduces the EXACT 106-pair final-test split used to score the fine-tuned
   model (Notebooks/06_production_v3.ipynb):
       ext_cal, ext_test = train_test_split(df, test_size=0.5,
                                            random_state=42, stratify=df["match_type"])
   `ext_test` (the second half) is the 106 held-out pairs. We evaluate Claude on it.
3. Scores each pair with Claude using the SAME system/user prompt and
   schema-constrained structured output the production web app uses
   (web/lib/schema.ts, web/lib/providers/claude.ts), so the number reflects the
   engine exactly as the product runs it. Claude returns matchScore in 0..100; we
   divide by 100 to match the label scale.
4. Computes Spearman + MAE against the ground-truth labels the same way the
   notebook does (scipy.stats.spearmanr; mean absolute error), and prints a
   comparison table vs the fine-tuned model.

HONEST SCOPE
------------
- The label `score` was authored by a human for each pair; Spearman/MAE here measure
  how well Claude's 0..100 judgment ranks/agrees with those labels, the identical
  yardstick used for the fine-tuned model. That makes the two numbers comparable.
- Claude reads the RAW job description (the `jd` column), i.e. what a user pastes into
  the product. The fine-tuned model was evaluated on a lightly cleaned JD. This is the
  honest "product engine" comparison; note the small input difference if you cite it.

REQUIREMENTS
------------
    pip install anthropic pandas scikit-learn scipy
    # add the Bedrock extra if using --bedrock:
    pip install "anthropic[bedrock]"

AUTH
----
First-party Anthropic API (default): the SDK resolves ANTHROPIC_API_KEY or an
`ant auth login` profile automatically. No key is hard-coded here.

Amazon Bedrock (--bedrock): uses the Anthropic Bedrock (Mantle) client, which signs
with standard AWS SigV4 credentials from the environment, set AWS_ACCESS_KEY_ID,
AWS_SECRET_ACCESS_KEY, and (for temporary creds) AWS_SESSION_TOKEN, plus --region.
NOTE: a Bedrock "API key" bearer token (`bedrock-api-key-...`) is NOT AWS SigV4 creds
and will not work here, use IAM access-key credentials.

RUN
---
    # Full run on Opus 4.8 (the product default), 4 parallel workers:
    python scripts/claude_benchmark.py --workers 4

    # Amazon Bedrock (Opus 4.8), us-east-2:
    python scripts/claude_benchmark.py --bedrock --region us-east-2 --workers 4

    # Cheaper/faster sanity check on 8 pairs first:
    python scripts/claude_benchmark.py --limit 8

    # Cheaper full run on Sonnet 5:
    python scripts/claude_benchmark.py --model claude-sonnet-5 --workers 4

Results stream to results/claude_benchmark_predictions.jsonl (resumable, rerun to
resume after an interruption; already-scored ids are skipped) and a final summary is
written to results/claude_benchmark_<model>.json.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import anthropic
import pandas as pd
from scipy.stats import spearmanr
from sklearn.model_selection import train_test_split

# --- Paths ---
REPO = Path(__file__).resolve().parents[1]
CSV_PATH = REPO / "Data" / "external_test_200_pairs.csv"
RESULTS_DIR = REPO / "results"
# Per-split checkpoints (resumable). Test scores keep the original filename so the run you
# already paid for is reused; calibration scores go to their own file.
PRED_PATHS = {
    "test": RESULTS_DIR / "claude_benchmark_predictions.jsonl",
    "cal": RESULTS_DIR / "claude_benchmark_cal_predictions.jsonl",
}

# The shipped fine-tuned model on this same 106-pair final test (Results/results_summary.json).
FINETUNED_SPEARMAN = 0.8645
FINETUNED_MAE = 0.1021

# --- Prompt, ported verbatim from web/lib/schema.ts so the score matches the product ---
SYSTEM_PROMPT = """You are an expert technical recruiter and career coach. You evaluate how well a candidate's resume fits a specific job description, and you give feedback the candidate can act on today.

How to score (0-100). Anchor to these bands and be willing to use the whole range, a compressed score that calls everything a 70 is useless to the candidate:
  85-100  Strong match. Meets essentially all core requirements with direct, demonstrated evidence.
  70-84   Good match. Meets most core requirements; gaps are secondary or learnable on the job.
  50-69   Partial match. Meets some core requirements; at least one significant gap.
  30-49   Weak match. Adjacent experience but misses the core of the role.
  0-29    Not a match. Different role, different domain, or entry-level against a senior posting.

Weight the JD's stated requirements far above its "nice to have" and culture sections. Judge demonstrated experience, not keyword presence: a resume that lists "Kubernetes" in a skills blob with no supporting experience is not a Kubernetes match. Conversely, do not penalize a candidate for lacking a keyword when the experience is clearly evidenced in different words.

Rules you must not break:
- Never invent experience the resume does not contain. Every strength and matched skill must be traceable to specific resume text.
- suggestedBullets must be rewrites grounded in experience the resume ALREADY shows, reframed to speak to this job. They are not aspirational bullets, and the candidate must be able to say them in an interview without lying.
- Be specific and concrete. "Improve your resume" is not feedback. "Your Airflow work is buried under 'Other tools', lead with it, the JD names it twice" is feedback.
- Missing skills are the most useful part of your output. Be honest about them even when the overall score is high."""


def user_prompt(job_description: str, resume_text: str) -> str:
    return (
        "Score this candidate against this job.\n\n"
        "--- JOB DESCRIPTION ---\n"
        f"{job_description}\n\n"
        "--- RESUME ---\n"
        f"{resume_text}"
    )


# Mirrors analysisSchema in web/lib/schema.ts. No numeric bounds on matchScore
# (structured outputs don't support them); we clamp to 0..100 in code, like the app.
ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "matchScore": {"type": "integer"},
        "summary": {"type": "string"},
        "matchedSkills": {"type": "array", "items": {"type": "string"}},
        "missingSkills": {"type": "array", "items": {"type": "string"}},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "suggestedBullets": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "matchScore",
        "summary",
        "matchedSkills",
        "missingSkills",
        "strengths",
        "suggestedBullets",
    ],
    "additionalProperties": False,
}


def load_split(split: str) -> pd.DataFrame:
    """Return the exact 106-pair calibration ('cal') or final-test ('test') split (seed 42)."""
    if not CSV_PATH.exists():
        sys.exit(f"Could not find {CSV_PATH}")
    df = pd.read_csv(CSV_PATH)
    for col in ("resume", "jd", "score", "match_type"):
        if col not in df.columns:
            sys.exit(f"Expected column '{col}' in {CSV_PATH.name}; found {list(df.columns)}")
    # Identical to Notebooks/06_production_v3.ipynb: cal = first half, test = second half.
    ext_cal, ext_test = train_test_split(
        df, test_size=0.5, random_state=42, stratify=df["match_type"]
    )
    return (ext_cal if split == "cal" else ext_test).reset_index(drop=True)


JSON_ONLY_SUFFIX = (
    "\n\nRespond with ONLY a JSON object, no prose, no markdown fences, matching exactly:\n"
    '{"matchScore": <integer 0-100>, "summary": "<2-4 sentences>", '
    '"matchedSkills": [<strings>], "missingSkills": [<strings>], '
    '"strengths": [<strings>], "suggestedBullets": [<strings>]}'
)

# Fallback ladder, the modern API surface first, then progressively simpler for older
# models / older Bedrock API versions (Opus 4.5 here rejects `effort`; some reject
# output_config entirely). Whichever tier the endpoint accepts still yields a matchScore.
_TIERS = ("modern", "structured", "plain")


def _call(client, model: str, effort: str, row: pd.Series, tier: str):
    content = user_prompt(str(row["jd"]), str(row["resume"]))
    kwargs = dict(model=model, max_tokens=8192, system=SYSTEM_PROMPT)
    if tier == "modern":
        kwargs["thinking"] = {"type": "adaptive"}
        kwargs["output_config"] = {
            "effort": effort,
            "format": {"type": "json_schema", "schema": ANALYSIS_SCHEMA},
        }
    elif tier == "structured":
        kwargs["output_config"] = {"format": {"type": "json_schema", "schema": ANALYSIS_SCHEMA}}
    else:  # plain, no server-side JSON constraint; ask for JSON in the prompt
        content += JSON_ONLY_SUFFIX
    kwargs["messages"] = [{"role": "user", "content": content}]
    return client.messages.create(**kwargs)


def _extract_score(text: str) -> int:
    try:
        return int(json.loads(text)["matchScore"])
    except Exception:  # noqa: BLE001, fall back to a regex if the body isn't clean JSON
        m = re.search(r'"?matchScore"?\s*[:=]\s*(\d{1,3})', text)
        if not m:
            raise
        return int(m.group(1))


def score_one(client, model: str, effort: str, row: pd.Series) -> dict:
    """Call Claude for one pair, degrading through simpler API surfaces for older models."""
    resp, used_tier, last_err = None, None, None
    for tier in _TIERS:
        try:
            resp = _call(client, model, effort, row, tier)
            used_tier = tier
            break
        except anthropic.BadRequestError as e:
            last_err = e  # this surface isn't accepted, try a simpler one
            continue
        except anthropic.APIError as e:
            return {"id": _row_id(row), "error": f"{type(e).__name__}: {e}"}
    if resp is None:
        return {"id": _row_id(row), "error": f"all tiers rejected: {last_err}"}

    if resp.stop_reason == "refusal":
        return {"id": _row_id(row), "error": "refusal"}
    if resp.stop_reason == "max_tokens":
        return {"id": _row_id(row), "error": "max_tokens (truncated before JSON)"}

    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        return {"id": _row_id(row), "error": f"no text block (stop_reason={resp.stop_reason})"}
    try:
        raw = _extract_score(text)
    except (json.JSONDecodeError, KeyError, ValueError, TypeError) as e:
        return {"id": _row_id(row), "error": f"parse: {type(e).__name__}: {e}"}

    score_100 = max(0, min(100, raw))
    return {
        "id": _row_id(row),
        "claude_score": score_100,          # 0..100 as Claude returned it (clamped)
        "claude_pred": score_100 / 100.0,   # 0..1, comparable to the label
        "label": float(row["score"]),
        "match_type": row.get("match_type"),
        "tier": used_tier,
    }


def _row_id(row: pd.Series):
    return int(row["id"]) if "id" in row and pd.notna(row["id"]) else int(row.name)


def load_checkpoint(pred_path) -> dict[int, dict]:
    done: dict[int, dict] = {}
    if pred_path.exists():
        for line in pred_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if "error" not in rec:  # re-attempt previously-errored ids on rerun
                done[rec["id"]] = rec
    return done


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=None,
                    help="Model id. Default: claude-opus-4-8 (first-party) or "
                         "anthropic.claude-opus-4-8 (--bedrock). Use claude-sonnet-5 for a cheaper run. "
                         "On Bedrock, if the account needs a cross-region inference profile, pass e.g. "
                         "us.anthropic.claude-opus-4-8.")
    ap.add_argument("--bedrock", action="store_true",
                    help="Call Claude via Amazon Bedrock (classic InvokeModel path + AWS SigV4 env creds).")
    ap.add_argument("--mantle", action="store_true",
                    help="With --bedrock, use the newer Mantle endpoint instead of classic InvokeModel. "
                         "Mantle uses a different model catalog; default (classic) matches the IDs from "
                         "`aws bedrock list-foundation-models`.")
    ap.add_argument("--region", default="us-east-2", help="AWS region for --bedrock (default: us-east-2).")
    ap.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"],
                    help="output_config.effort (default: medium, matching the app).")
    ap.add_argument("--workers", type=int, default=4, help="Parallel API calls (default: 4). Use 1 on rate-limited Bedrock accounts.")
    ap.add_argument("--sleep", type=float, default=0.0, help="Seconds to pause after each call (throttle for low rate limits, e.g. 5).")
    ap.add_argument("--split", default="test", choices=["test", "cal"],
                    help="Which held-out half to score: 'test' (106 final-test pairs, default) or "
                         "'cal' (106 calibration pairs, score these to fit a calibrator).")
    ap.add_argument("--limit", type=int, default=0, help="Score only the first N pairs (0 = all 106).")
    args = ap.parse_args()

    if args.model is None:
        args.model = "anthropic.claude-opus-4-8" if args.bedrock else "claude-opus-4-8"

    RESULTS_DIR.mkdir(exist_ok=True)
    pred_path = PRED_PATHS[args.split]
    test = load_split(args.split)
    if args.limit:
        test = test.head(args.limit)

    print(f"{args.split.upper()} pairs: {len(test)}")
    print("match_type distribution:")
    print(test["match_type"].value_counts().to_string())

    done = load_checkpoint(pred_path)
    todo = [row for _, row in test.iterrows() if _row_id(row) not in done]
    print(f"\nAlready scored: {len(done)} | To score now: {len(todo)} | model={args.model} effort={args.effort}")
    if not todo:
        print("Nothing to score (all cached). Computing metrics from checkpoint.")

    if args.bedrock:
        # High max_retries lets the SDK ride out Bedrock's low RPM limits with exponential
        # backoff.
        if args.mantle:
            client = anthropic.AnthropicBedrockMantle(aws_region=args.region, max_retries=10)
        else:
            # Classic bedrock-runtime InvokeModel path; recognizes the IDs from
            # list_foundation_models (e.g. us.anthropic.claude-opus-4-8) and needs
            # bedrock:InvokeModel.
            client = anthropic.AnthropicBedrock(aws_region=args.region, max_retries=10)
    else:
        client = anthropic.Anthropic()
    write_lock = threading.Lock()
    results: list[dict] = list(done.values())

    def run(row: pd.Series) -> dict:
        rec = score_one(client, args.model, args.effort, row)
        with write_lock, pred_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
        tag = rec.get("error") or f"{rec['claude_score']}/100 (label {rec['label']:.2f})"
        print(f"  id={rec['id']}: {tag}")
        if args.sleep:
            time.sleep(args.sleep)
        return rec

    if todo:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(run, row) for row in todo]
            for fut in as_completed(futures):
                results.append(fut.result())

    scored = [r for r in results if "claude_pred" in r]
    errored = [r for r in results if "error" in r]
    if len(scored) < 3:
        sys.exit(f"\nOnly {len(scored)} pairs scored successfully, cannot compute metrics. "
                 f"Errors: {[e.get('error') for e in errored][:5]}")

    preds = [r["claude_pred"] for r in scored]
    labels = [r["label"] for r in scored]
    spearman, _ = spearmanr(labels, preds)
    mae = sum(abs(p - t) for p, t in zip(preds, labels)) / len(scored)

    summary = {
        "model": args.model,
        "effort": args.effort,
        "n_scored": len(scored),
        "n_errored": len(errored),
        "claude": {"spearman": round(float(spearman), 4), "mae": round(mae, 4)},
        "finetuned_mpnet": {"spearman": FINETUNED_SPEARMAN, "mae": FINETUNED_MAE},
        "split": args.split,
        "note": "Same 106-pair external split (stratified, seed 42) used for the fine-tuned "
                "model. Claude read the raw JD as the product does.",
    }
    safe_model = re.sub(r"[^A-Za-z0-9._-]", "_", args.model)  # ':' and '/' are illegal in filenames
    out_path = RESULTS_DIR / f"claude_benchmark_{safe_model}_{args.split}.json"
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n" + "=" * 60)
    print(f"RESULTS on {len(scored)} held-out pairs" + (f" ({len(errored)} errored)" if errored else ""))
    print("=" * 60)
    print(f"  {args.model:<28} Spearman={spearman:.4f}  MAE={mae:.4f}")
    print(f"  {'Fine-tuned MPNet (shipped)':<28} Spearman={FINETUNED_SPEARMAN:.4f}  MAE={FINETUNED_MAE:.4f}")
    print(f"\nSaved: {out_path.relative_to(REPO)}")
    print(f"Per-pair predictions: {pred_path.relative_to(REPO)}")


if __name__ == "__main__":
    main()
