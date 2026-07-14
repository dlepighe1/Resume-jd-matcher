# Scoring service

Serves the fine-tuned MPNet + Platt calibrator over HTTP. Next.js calls it via
`SCORING_SERVICE_URL`; it cannot run on Vercel because the model is ~420 MB of PyTorch
weights, far past the serverless function limit.

It imports `src/text_utils.py` and `app/explain.py` from the repo rather than
reimplementing them, so the scores it serves are the same ones the research notebooks
measured.

## Run locally

```bash
pip install -r service/requirements.txt
uvicorn service.main:app --reload --port 8000    # from the repo root
```

```bash
curl localhost:8000/health
curl -X POST localhost:8000/score -H 'Content-Type: application/json' \
  -d '{"resume": "...", "jd": "..."}'
```

## Endpoints

| | |
|---|---|
| `GET /health` | `{status, model_id, calibrator, fine_tuned}` — check `fine_tuned` before trusting a score |
| `POST /score` | `{resume, jd}` → `{score, raw_cosine, calibrator, model_id, requirements[], coverage}` |

`score` is 0–1 and **calibrated** only when a calibrator is loaded. Both fields are
reported so the caller can tell the difference instead of assuming.

## Model resolution

1. `models/mpnet-resume-matcher/` — a local checkpoint from `python src/train.py`
2. `MODEL_ID` on the HuggingFace Hub (default `dlepighe1/resume-jd-matcher-mpnet`)
3. **Base `all-mpnet-base-v2`**, with the calibrator dropped and `fine_tuned: false`

Step 3 matters: the calibrators map the *fine-tuned* model's cosine distribution.
Applying one to base MPNet would produce confident, well-formatted nonsense — so the
service drops it and says so, rather than serving a number that looks trustworthy and
isn't.

## Deploy to a HuggingFace Space

1. Create a Space with the **Docker** SDK.
2. Push this repo to it. The root `Dockerfile` builds the service and listens on 7860.
3. Set `SCORING_SERVICE_URL` in Vercel to the Space URL.

Free Spaces sleep when idle, so the first request after a quiet period pays a cold start
(container wake + weight load). The web app's fine-tuned provider allows 120s for this
and surfaces `MODEL_SERVICE_UNREACHABLE` rather than a generic spinner-that-never-ends.

## A note on TLS

`service/main.py` calls `truststore.inject_into_ssl()` before anything touches
huggingface_hub. Behind a TLS-inspecting proxy, Python's bundled CA store cannot verify
`huggingface.co`; every download fails with `CERTIFICATE_VERIFY_FAILED`, which then
closes hf_hub's shared HTTP client so even the *cached* fallback load dies with a
misleading `Cannot send a request, as the client has been closed`. It is a no-op on
Linux, so it stays in for the container too.

## Tests

```bash
pytest service/
```

Fully offline — the model is dependency-injected and replaced with a stub encoder whose
vectors are hand-chosen, so no test downloads weights or hits the Hub.
