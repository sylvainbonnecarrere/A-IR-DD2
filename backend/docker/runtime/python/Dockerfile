FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/sandbox

RUN useradd --uid 10001 --create-home --home-dir /home/sandbox --shell /usr/sbin/nologin sandbox \
    && mkdir -p /sandbox/workspace /sandbox/output /sandbox/tmp \
    && chown -R sandbox:sandbox /sandbox /home/sandbox

WORKDIR /sandbox/workspace
USER sandbox

CMD ["python3", "--version"]