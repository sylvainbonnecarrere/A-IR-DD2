FROM ubuntu:24.04@sha256:73b999393d07f2bf65a40373778a44dc9a6d54ad7718d29247d8ff9413c4d6a8

COPY --from=python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df /usr/local /usr/local

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/usr/local/bin:$PATH \
    LANG=C.UTF-8 \
    HOME=/home/provisioner

RUN apt-get update \
    && apt-get install -y --only-upgrade --no-install-recommends apt libapt-pkg6.0t64 \
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