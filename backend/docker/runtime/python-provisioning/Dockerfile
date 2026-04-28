FROM python:3.12-slim-bookworm@sha256:58525e1a8dada8e72d6f8a11a0ddff8d981fd888549108db52455d577f927f77

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