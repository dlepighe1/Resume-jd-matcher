# Scoring service — deployed as a HuggingFace Space (Docker SDK).
#
# This lives at the repo root because HF Spaces looks for a Dockerfile there, and the
# build needs the whole repo: the service imports src/ (preprocessing) and app/ (skill
# gap) rather than duplicating them.
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

COPY --chown=user service/requirements.txt ./service/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r service/requirements.txt

# Only what the service actually needs. Notebooks, Data/, and Results/ are not copied —
# they are research artifacts and would bloat the image for no runtime benefit.
COPY --chown=user src/     ./src/
COPY --chown=user app/     ./app/
COPY --chown=user models/  ./models/
COPY --chown=user service/ ./service/

# Spaces routes public traffic to 7860.
EXPOSE 7860
CMD ["uvicorn", "service.main:app", "--host", "0.0.0.0", "--port", "7860"]
