#!/bin/bash

# MongoDB initialization script
# This script runs automatically when the container starts
# It creates the application database and sets up initial authentication

set -e

MONGO_ROOT_USERNAME="${MONGO_INITDB_ROOT_USERNAME:-${MONGO_USER:-}}"
MONGO_ROOT_PASSWORD="${MONGO_INITDB_ROOT_PASSWORD:-${MONGO_PASSWORD:-}}"

if [ -z "$MONGO_ROOT_USERNAME" ] || [ -z "$MONGO_ROOT_PASSWORD" ]; then
  echo "MongoDB init error: missing root credentials in environment."
  echo "Expected MONGO_INITDB_ROOT_USERNAME/MONGO_INITDB_ROOT_PASSWORD or MONGO_USER/MONGO_PASSWORD."
  exit 1
fi

echo "MongoDB initialization script starting..."

# Wait for MongoDB to be ready
until mongosh --username "$MONGO_ROOT_USERNAME" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --eval "db.version()" &>/dev/null; do
  echo "Waiting for MongoDB to be ready..."
  sleep 2
done

echo "MongoDB is ready!"

# Run the collections initialization script
mongosh --username "$MONGO_ROOT_USERNAME" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin < /docker-entrypoint-initdb.d/init-collections.js

echo "MongoDB initialization complete!"
