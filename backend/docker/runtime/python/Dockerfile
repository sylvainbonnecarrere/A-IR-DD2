FROM ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c

ENV PATH=/usr/local/bin:$PATH \
    LANG=C.UTF-8

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/sandbox

COPY --from=python:3.12-slim-bookworm@sha256:6dd8b6dab6b3adc7812bab69eca5dbdc1a5cc690ad28306d234ffb4ef8ac9753 /usr/local /usr/local

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        libgdbm6t64 \
        libnsl2 \
        libreadline8 \
        libsqlite3-0 \
        libtirpc3t64 \
        netbase \
        tzdata; \
    rm -rf \
        /usr/local/bin/pip \
        /usr/local/bin/pip3 \
        /usr/local/lib/python3.12/ensurepip \
        /usr/local/lib/python3.12/site-packages/pip \
        /usr/local/lib/python3.12/site-packages/pip-*.dist-info; \
    rm -rf /var/lib/apt/lists/*; \
    useradd --uid 10001 --create-home --home-dir /home/sandbox --shell /usr/sbin/nologin sandbox; \
    mkdir -p /sandbox/workspace /sandbox/output /sandbox/tmp; \
    chown -R sandbox:sandbox /sandbox /home/sandbox; \
    python3 --version

WORKDIR /sandbox/workspace
USER sandbox

CMD ["python3", "--version"]