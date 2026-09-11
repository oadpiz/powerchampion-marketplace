# Private customer/admin service for powerchampion.ai.
# Reached only by the website container over the Compose network; it publishes
# no ports and has no Traefik route.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY server/requirements.txt server/requirements.txt
RUN pip install -r server/requirements.txt

COPY server/ server/

RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin portal \
    && mkdir -p /data \
    && chown portal:portal /data \
    && chmod 700 /data

USER portal
ENV PC_PORTAL_DB=/data/portal.sqlite3
EXPOSE 3020

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3020/api/portal/health', timeout=3)"]

CMD ["python", "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "3020"]
