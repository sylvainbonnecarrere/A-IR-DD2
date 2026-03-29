FROM python:3.12-slim-bookworm@sha256:31c0807da611e2e377a2e9b566ad4eb038ac5a5838cbbbe6f2262259b5dc77a0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/provisioner

RUN useradd --uid 10002 --create-home --home-dir /home/provisioner --shell /bin/sh provisioner \
    && mkdir -p /provisioning/workspace /provisioning/wheelhouse /provisioning/output \
    && chown -R provisioner:provisioner /provisioning /home/provisioner

WORKDIR /provisioning/workspace
USER provisioner

CMD ["pip3", "--version"]