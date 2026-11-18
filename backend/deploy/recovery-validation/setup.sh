#!/bin/sh
set -eu
install -d -m 0700 /etc/airdd2
install -d -o airdd2-backend -g airdd2-backend /opt/airdd2/backend/storage/workspaces
jwt_secret="$(node -p "require('crypto').randomBytes(32).toString('hex')")"
refresh_secret="$(node -p "require('crypto').randomBytes(32).toString('hex')")"
encryption_key="$(node -p "require('crypto').randomBytes(32).toString('hex')")"
umask 077
cat > /etc/airdd2/docker-gateway.env <<EOF
MONGODB_URI=mongodb://127.0.0.1:27017/airdd2_recovery_validation
DOCKER_GATEWAY_SOCKET=/run/airdd2-docker-gateway/docker.sock
DOCKER_BIN=/usr/local/bin/docker
DOCKER_GATEWAY_ALLOWED_BIND_ROOTS=/opt/airdd2/backend/storage/workspaces
EOF
cat > /etc/airdd2/backend.env <<EOF
NODE_ENV=production
MONGODB_URI=mongodb://127.0.0.1:27017/airdd2_recovery_validation
JWT_SECRET=$jwt_secret
REFRESH_TOKEN_SECRET=$refresh_secret
ENCRYPTION_KEY=$encryption_key
DOCKER_GATEWAY_REQUIRED=true
DOCKER_GATEWAY_SOCKET=/run/airdd2-docker-gateway/docker.sock
WORKSPACE_STORAGE_PATH=/opt/airdd2/backend/storage/workspaces
RUNTIME_NATIVE_PYTHON_PROVISION_ON_STARTUP=false
EOF
