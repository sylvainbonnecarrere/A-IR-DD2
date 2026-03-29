FROM python:3.12-slim-bookworm@sha256:31c0807da611e2e377a2e9b566ad4eb038ac5a5838cbbbe6f2262259b5dc77a0 AS python_runtime_builder

# Run-only image: keep Python runtime, remove package installation tooling.
# Python dependencies must be prepared via the dedicated provisioning path.

RUN set -eux; \
    python3 --version; \
    pip3 --version; \
    rm -rf \
        /usr/local/bin/pip \
        /usr/local/bin/pip3 \
        /usr/local/lib/python3.12/ensurepip \
        /usr/local/lib/python3.12/site-packages/pip \
        /usr/local/lib/python3.12/site-packages/pip-*.dist-info; \
    find /usr/local -type f -executable -not \( -name '*tkinter*' \) -exec ldd '{}' ';' \
        | awk '/=>/ { so = $(NF-1); if (index(so, "/usr/local/") == 1) { next }; gsub("^/(usr/)?", "", so); printf "*%s\n", so }' \
        | sort -u \
        | xargs -rt dpkg-query --search \
        | awk 'sub(":$", "", $1) { print $1 }' \
        | sort -u > /tmp/python-runtime-packages.txt

FROM debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a

ENV PATH=/usr/local/bin:$PATH \
    LANG=C.UTF-8

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/sandbox

COPY --from=python_runtime_builder /usr/local /usr/local
COPY --from=python_runtime_builder /tmp/python-runtime-packages.txt /tmp/python-runtime-packages.txt

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates netbase tzdata; \
    xargs -r apt-get install -y --no-install-recommends < /tmp/python-runtime-packages.txt; \
    rm -rf /var/lib/apt/lists/* /tmp/python-runtime-packages.txt; \
    useradd --uid 10001 --create-home --home-dir /home/sandbox --shell /usr/sbin/nologin sandbox; \
    mkdir -p /sandbox/workspace /sandbox/output /sandbox/tmp; \
    chown -R sandbox:sandbox /sandbox /home/sandbox; \
    python3 --version

WORKDIR /sandbox/workspace
USER sandbox

CMD ["python3", "--version"]