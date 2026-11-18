FROM docker:29.9.3-dind@sha256:7bf70dcb85c822e3fa6f2d332143e474b99147b9d7b39102b0cfe8b04a7dd61b AS docker-cli
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

RUN apt-get update \
    && apt-get install -y --no-install-recommends systemd systemd-sysv socat curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /opt/airdd2/backend
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json jest.config.js ./
COPY src ./src
COPY __tests__ ./__tests__
COPY deploy/systemd ./deploy/systemd
COPY deploy/recovery-validation ./deploy/recovery-validation
RUN npm run build \
    && groupadd docker \
    && groupadd airdd2-gateway-clients \
    && useradd --system --no-create-home --user-group airdd2-backend \
    && useradd --system --no-create-home --user-group airdd2-gateway \
    && usermod -a -G docker airdd2-gateway \
    && usermod -a -G airdd2-gateway-clients airdd2-backend \
    && install -d -o airdd2-backend -g airdd2-backend /opt/airdd2/backend/storage/workspaces \
    && sed 's/\r$//' deploy/recovery-validation/setup.sh > /usr/local/sbin/airdd2-validation-setup \
    && chmod 0755 /usr/local/sbin/airdd2-validation-setup \
    && install -m 0644 deploy/recovery-validation/*.service /etc/systemd/system/ \
    && install -m 0644 deploy/systemd/*.service /etc/systemd/system/ \
    && touch /etc/airdd2-recovery-validation \
    && systemctl enable airdd2-validation-setup.service airdd2-validation-docker-proxy.service \
        airdd2-validation-mongo-proxy.service airdd2-backend.service

ENV container=docker
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
