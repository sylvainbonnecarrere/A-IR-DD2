FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOME=/home/sandbox

RUN apt-get update \
    && apt-get purge -y --auto-remove perl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --home-dir /home/sandbox --shell /usr/sbin/nologin sandbox \
    && mkdir -p /sandbox/workspace /sandbox/output /sandbox/tmp \
    && chown -R sandbox:sandbox /sandbox /home/sandbox

WORKDIR /sandbox/workspace
USER sandbox

CMD ["node", "--version"]