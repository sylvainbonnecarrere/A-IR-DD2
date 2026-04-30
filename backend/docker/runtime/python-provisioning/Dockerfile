FROM ubuntu:noble-20260410@sha256:c4a8d5503dfb2a3eb8ab5f807da5bc69a85730fb49b5cfca2330194ebcc41c7b

COPY --from=python:3.12-slim-bookworm@sha256:58525e1a8dada8e72d6f8a11a0ddff8d981fd888549108db52455d577f927f77 /usr/local /usr/local

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/usr/local/bin:$PATH \
    LANG=C.UTF-8 \
    HOME=/home/provisioner

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libgdbm6t64 \
        libnsl2 \
        libreadline8 \
        libsqlite3-0 \
        libtirpc3t64 \
        netbase \
        tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10002 --create-home --home-dir /home/provisioner --shell /bin/sh provisioner \
    && mkdir -p /provisioning/workspace /provisioning/wheelhouse /provisioning/output \
    && chown -R provisioner:provisioner /provisioning /home/provisioner

WORKDIR /provisioning/workspace
USER provisioner

CMD ["pip3", "--version"]