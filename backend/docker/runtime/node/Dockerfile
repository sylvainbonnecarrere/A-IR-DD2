FROM debian:bookworm-slim@sha256:f9c6a2fd2ddbc23e336b6257a5245e31f996953ef06cd13a59fa0a1df2d5c252 AS node_runtime_builder

# Run-only image: keep Node runtime, remove package installation tooling.
# Dependency installation belongs to a separate preparation workflow.

ARG NODE_VERSION=22.22.2

RUN set -eux; \
    arch=''; \
    openssl_arch=''; \
    dpkg_arch="$(dpkg --print-architecture)"; \
    case "${dpkg_arch##*-}" in \
        amd64) arch='x64'; openssl_arch='linux-x86_64' ;; \
        ppc64el) arch='ppc64le'; openssl_arch='linux-ppc64le' ;; \
        s390x) arch='s390x'; openssl_arch='linux*-s390x' ;; \
        arm64) arch='arm64'; openssl_arch='linux-aarch64' ;; \
        armhf) arch='armv7l'; openssl_arch='linux-armv4' ;; \
        i386) arch='x86'; openssl_arch='linux-elf' ;; \
        *) echo "unsupported architecture: ${dpkg_arch}"; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils; \
    rm -rf /var/lib/apt/lists/*; \
    curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz"; \
    curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " node-v${NODE_VERSION}-linux-${arch}.tar.xz\$" SHASUMS256.txt | sha256sum -c -; \
    mkdir -p /opt/node-runtime; \
    tar -xJf "node-v${NODE_VERSION}-linux-${arch}.tar.xz" -C /opt/node-runtime --strip-components=1 --no-same-owner; \
    rm -f "node-v${NODE_VERSION}-linux-${arch}.tar.xz" SHASUMS256.txt; \
    find /opt/node-runtime/include/node/openssl/archs -mindepth 1 -maxdepth 1 ! -name "${openssl_arch}" -exec rm -rf {} \;; \
    rm -rf \
        /opt/node-runtime/lib/node_modules/npm \
        /opt/node-runtime/bin/npm \
        /opt/node-runtime/bin/npx \
        /opt/node-runtime/bin/corepack; \
    find /opt/node-runtime -type f -executable -exec ldd '{}' ';' \
        | awk '/=>/ { so = $(NF-1); if (index(so, "/opt/node-runtime/") == 1) { next }; gsub("^/(usr/)?", "", so); print so }' \
        | sort -u \
        | xargs -r dpkg-query --search \
        | cut -d: -f1 \
        | sort -u > /tmp/node-runtime-packages.txt; \
    /opt/node-runtime/bin/node --version

FROM debian:bookworm-slim@sha256:f9c6a2fd2ddbc23e336b6257a5245e31f996953ef06cd13a59fa0a1df2d5c252

ENV NODE_ENV=production \
    HOME=/home/sandbox

COPY --from=node_runtime_builder /opt/node-runtime /usr/local
COPY --from=node_runtime_builder /tmp/node-runtime-packages.txt /tmp/node-runtime-packages.txt

RUN set -eux; \
    apt-get update; \
    xargs -r apt-get install -y --no-install-recommends < /tmp/node-runtime-packages.txt; \
    rm -rf /var/lib/apt/lists/* /tmp/node-runtime-packages.txt; \
    ln -sf /usr/local/bin/node /usr/local/bin/nodejs; \
    useradd --uid 10001 --create-home --home-dir /home/sandbox --shell /usr/sbin/nologin sandbox; \
    mkdir -p /sandbox/workspace /sandbox/output /sandbox/tmp; \
    chown -R sandbox:sandbox /sandbox /home/sandbox; \
    node --version

WORKDIR /sandbox/workspace
USER sandbox

CMD ["node", "--version"]