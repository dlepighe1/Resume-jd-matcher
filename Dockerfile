# Scoring service image. Deployed on Railway (railway.toml), and still runs unchanged as a
# HuggingFace Space (Docker SDK), which also looks for a Dockerfile at the repo root.
#
# It lives at the repo root because the build needs the whole repo: the service imports
# src/ (preprocessing) and app/ (skill gap) rather than duplicating them.
#
# Build locally:  docker build -t resumeai-scorer .
#                 docker run -p 8000:7860 resumeai-scorer

FROM python:3.11-slim

# Non-root: HF Spaces runs as uid 1000, and the HF cache must be writable by it.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    HF_HOME=/home/user/.cache/huggingface \
    PYTHONUNBUFFERED=1

WORKDIR $HOME/app

# CPU torch first, from PyTorch's own index. The default PyPI wheel for Linux bundles the
# CUDA runtime, gigabytes of GPU libraries this CPU-only container would never load. The
# +cpu build satisfies the torch==2.7.1 pin below, so pip leaves it in place.
COPY --chown=user service/requirements.txt ./service/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r service/requirements.txt

# Bake both models into the image. Otherwise every container start downloads ~420 MB of
# fine-tuned weights before it can answer, and the first /baseline call downloads base
# MPNet on top of that. Loading through SentenceTransformer, not a raw snapshot download,
# fills the cache at exactly the paths service/main.py will look in.
ARG MODEL_ID=dlepighe1/resume-jd-matcher-mpnet
ENV MODEL_ID=$MODEL_ID
RUN python -c "from sentence_transformers import SentenceTransformer as S; \
S('$MODEL_ID'); S('all-mpnet-base-v2')"

# Only what the service actually needs. Notebooks, Data/, and Results/ are not copied.
# They are research artifacts and would bloat the image for no runtime benefit.
COPY --chown=user src/     ./src/
COPY --chown=user app/     ./app/
COPY --chown=user models/  ./models/
COPY --chown=user service/ ./service/

# Railway injects PORT; Spaces routes to 7860 and sets nothing. exec so uvicorn receives
# the platform's SIGTERM directly and shuts down cleanly on redeploy.
EXPOSE 7860
CMD ["sh", "-c", "exec uvicorn service.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
