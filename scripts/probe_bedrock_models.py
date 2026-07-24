"""
Probe which Claude models this Bedrock account can actually invoke (a model appearing
in list_foundation_models does NOT mean you have access to it). Tries a tiny 5-token
call per candidate via the classic InvokeModel path and reports OK / FAIL.

    python scripts/probe_bedrock_models.py --region us-east-2

Needs AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY set in the environment and
bedrock:InvokeModel permission. Cost is negligible (a handful of 5-token calls).
Pick the best OK model (Opus > Sonnet > Haiku, newest first) and pass it to
claude_benchmark.py via --model.
"""

import argparse
import anthropic

# Prioritized: best product-representative engine first. Each newer model is tried as a
# cross-region inference profile (us.*) AND as the bare foundation-model id.
CANDIDATES = [
    "us.anthropic.claude-opus-4-7", "anthropic.claude-opus-4-7",
    "us.anthropic.claude-opus-4-6", "anthropic.claude-opus-4-6-v1",
    "us.anthropic.claude-opus-4-5-20251101-v1:0", "anthropic.claude-opus-4-5-20251101-v1:0",
    "us.anthropic.claude-opus-4-1-20250805-v1:0", "anthropic.claude-opus-4-1-20250805-v1:0",
    "us.anthropic.claude-sonnet-5", "anthropic.claude-sonnet-5",
    "us.anthropic.claude-sonnet-4-6", "anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "anthropic.claude-sonnet-4-5-20250929-v1:0",
    "us.anthropic.claude-sonnet-4-20250514-v1:0", "anthropic.claude-sonnet-4-20250514-v1:0",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-haiku-4-5-20251001-v1:0",
    "anthropic.claude-3-haiku-20240307-v1:0",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="us-east-2")
    args = ap.parse_args()

    client = anthropic.AnthropicBedrock(aws_region=args.region)
    working = []
    for model in CANDIDATES:
        try:
            client.messages.create(
                model=model, max_tokens=5,
                messages=[{"role": "user", "content": "hi"}],
            )
            print(f"OK    {model}")
            working.append(model)
        except Exception as e:  # noqa: BLE001 — we want to see every failure reason
            print(f"FAIL  {model}  ->  {str(e)[:120]}")

    print("\nWORKING MODELS (best first):")
    print("\n".join(f"  {m}" for m in working) if working else "  (none)")


if __name__ == "__main__":
    main()
