# Docker Setup Implementation Notes (Code-First Architecture)

## 🎯 Overview

Professional Docker setup for MongoDB in A-IR-DD2 with **Code-First initialization** managed by the Node.js backend. This eliminates brittle Docker volume-based initialization and ensures robust, cross-platform schema management.

---

## 📋 Components

### 1. docker-compose.yml (Infrastructure Only)
- **Service**: MongoDB 6.0
- **Container name**: a-ir-dd2-mongodb
- **Port**: 27017 (mapped)
- **Authentication**: 
  - Username: value of `MONGO_USER` in `backend/.env`
  - Password: value of `MONGO_PASSWORD` in `backend/.env`
  - Database: `a-ir-dd2-dev`
- **Volumes**:
  - `mongodb_data:/data/db` - Persistent data storage only
  - **NO** initialization script mounts (Code-First!)
- **Network**: `a-ir-dd2-network` (bridge)
- **Health Check**: Enabled (ping every 10s, 5 retries)
- **Restart Policy**: `unless-stopped` (auto-restart on crash)

**Key Change**: Removed init-mongo.sh and init-collections.js volume mounts entirely.

---

### 2. backend/src/services/databaseInit.ts (NEW - Active Logic)

**Role**: Idempotent initialization service called on every backend startup

**Architecture**:
```
Backend starts
    ↓
connectDatabase() → MongoDB connection successful
    ↓
initializeDatabase() ← NEW SERVICE
    ├─ Phase 1: Check existing collections
    ├─ Phase 2: Create if absent (idempotent)
    └─ Done!
```

**Features**:
- ✅ **Idempotent**: Safe to call multiple times
- ✅ **Non-blocking**: Errors logged but don't crash startup
- ✅ **Development-aware**: Creates test user only in dev mode
- ✅ **Comprehensive logging**: Shows exactly what's happening

**Collections Created**:
1. `users` - User accounts with JSON Schema validation
2. `llm_configs` - LLM provider credentials
3. `user_settings` - User preferences (J4.3 feature)
4. `workflows` - Workflow definitions
5. `agents` - Agent prototypes
6. `workflow_nodes` - Visual workflow nodes
7. `workflow_edges` - Visual workflow connections
8. `agent_prototypes` - Agent templates
9. `agent_instances` - Runtime agent tracking

**Indexes Created** (See databaseInit.ts for full definitions):
- `users.email` (unique)
- `llm_configs.userId + provider` (unique compound)
- `user_settings.userId` (unique)
- `workflows.creator_id`, `workflows.userId`
- `agents.creator_id`
- `workflow_nodes.workflowId`
- `workflow_edges.workflowId`
- `agent_prototypes.creator_id`
- `agent_instances.agentId + createdAt`, `agent_instances.workflowId`

**Schema Validation**:
All collections enforce JSON Schema validation:
- Type checking (bsonType)
- Required fields
- Pattern validation (e.g., email format)
- Enum constraints

---

### 3. init-collections.js (Reference Only - Deprecated)

**Status**: ❌ Not executed by Docker anymore

**Purpose**: Documentation and reference
- Shows the original schema definitions
- Can be used as backup for manual MongoDB setup
- Contains logical migration history

**Note**: All logic has been transferred to `databaseInit.ts` and enhanced with idempotent checks.

---

### 4. init-mongo.sh (Deprecated)

**Status**: ❌ Not used

**Purpose**: Legacy shell script that waited for MongoDB and ran init-collections.js
- Fragile timing dependencies
- Platform-specific issues
- Replaced by Code-First approach

---

### 5. .env.docker (Configuration Template)

Template for backend `.env` configuration:

```env
# MongoDB Connection
MONGODB_URI=mongodb://<set-mongo-admin-user>:<set-mongo-strong-password>@localhost:27017/a-ir-dd2-dev?authSource=admin
MONGO_USER=<set-mongo-admin-user>
MONGO_PASSWORD=<set-mongo-strong-password>

# Backend
PORT=3001
NODE_ENV=development

# Security (Generate these!)
JWT_SECRET=<generated-32-hex>
ENCRYPTION_KEY=<generated-32-hex>

# Optional LLM Providers
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

**Important**: Generate unique `JWT_SECRET` and `ENCRYPTION_KEY` for each environment.

---

## 🔄 Initialization Flow

### Startup Sequence (npm run dev)

```
1. Express app initializes
2. connectDatabase() called
   ├─ Connects to MongoDB
   └─ Returns connection object
3. initializeDatabase() called (NEW!)
   ├─ Phase 1: Check for existing collections
   ├─ If collections exist:
   │  └─ Log "Database already initialized"
   └─ If NO collections:
      ├─ Create all 9 collections with validators
      ├─ Create all indexes
      ├─ Inject test user (dev only)
      └─ Log completion
4. Routes registered
5. HTTP server listening on port 3001
```

### Key Design Pattern: Idempotent

```javascript
// Pseudo-code
if (testUserExists) {
  // Already done - skip
  logger.info('Database already initialized');
} else {
  // First time - initialize everything
  await createCollections();
  await createIndexes();
  await createTestUser();
}
```

This ensures:
- ✅ Restarting backend doesn't corrupt data
- ✅ Multiple backends can start in parallel (safe)
- ✅ No race conditions

---

## 📊 Data Persistence

### Volume Location

MongoDB data stored in Docker named volume `mongodb_data`:

| OS | Location |
|----|----|
| **Windows** | Docker Desktop VM (managed) |
| **macOS** | Docker Desktop VM (managed) |
| **Linux** | `/var/lib/docker/volumes/backend_docker_mongodb_data/_data` |

### Persistence Guarantees

- ✅ Data survives: `docker-compose stop` / `docker-compose start`
- ✅ Data survives: Container crash with `restart: unless-stopped`
- ❌ Data lost: `docker-compose down -v` (intentional destruction)

---

## 🧪 Test User

Created automatically in development mode:

```json
{
  "_id": ObjectId(...),
  "email": "test@example.com",
  "password": "$2b$10$JkttyuwNvLIxq.f2p9rW8uKD7CFyZZvPZP8jKgRPrBXf2wq8Z2j6u",
  "role": "user",
  "isActive": true,
  "createdAt": ISODate(...),
  "updatedAt": ISODate(...)
}
```

**Credentials**:
- Email: `test@example.com`
- Password: `TestPassword123` (plaintext)
- Hash Algorithm: bcrypt (10 rounds)

**Purpose**: Testing authentication and user workflows without manual account creation.

**Security Note**: 
- Only created in `NODE_ENV === 'development'`
- Not created in production
- Password is bcrypt-hashed (never stored plaintext)

---

## 🔐 Security Architecture

### Authentication Flow
```
User login (test@example.com / TestPassword123)
    ↓
Backend: Find user by email
    ↓
Backend: bcrypt.compare(input, hash) 
    ↓
Match? → Generate JWT
    ↓
Return JWT token to client
    ↓
Subsequent requests: Verify JWT (Passport middleware)
```

### Encryption for Sensitive Data
- LLM API keys stored encrypted (AES-256-GCM)
- Encryption key: `ENCRYPTION_KEY` environment variable
- Each API key encrypted before MongoDB storage

### Access Control
- Unique index on `email` prevents duplicates
- `userId` foreign key references in other collections
- Schema validation enforces required fields

---

## 🚀 First-Time Setup (Developer Instructions)

### Step 1: Clean Old Volume
```bash
cd backend/docker
docker-compose down -v    # Destroys old volume if it exists
```

### Step 2: Start MongoDB
```bash
docker-compose up -d
# Wait for health check to pass (watch logs with: docker-compose logs -f)
```

### Step 3: Configure Backend
```bash
cd backend
cp docker/.env.docker .env

# Edit .env and generate:
# JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

### Step 4: Start Backend
```bash
npm install  # First time only
npm run dev
```

Expected output:
```
✨ ===== A-IR-DD2 BACKEND DÉMARRÉ ===== ✨
🚀 Serveur HTTP: http://localhost:3001
🔧 Starting database initialization...
📋 Creating collections with schema validation...
🗂️  Creating indexes for performance...
👤 Creating test user...
🎯 Database initialization complete!
```

### Step 5: Verify
```bash
# Collections created?
docker exec -it a-ir-dd2-mongodb mongosh \
  --username "$MONGO_USER" \
  --password "$MONGO_PASSWORD" \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "show collections"

# Test user created?
docker exec -it a-ir-dd2-mongodb mongosh \
  --username "$MONGO_USER" \
  --password "$MONGO_PASSWORD" \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "db.users.countDocuments()"
```

---

## 🔧 Maintenance Operations

### View All Collections
```bash
docker exec -it a-ir-dd2-mongodb mongosh \
  --username "$MONGO_USER" \
  --password "$MONGO_PASSWORD" \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "db.getCollectionNames()"
```

### Query Test User
```bash
docker exec -it a-ir-dd2-mongodb mongosh \
  --username "$MONGO_USER" \
  --password "$MONGO_PASSWORD" \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "db.users.findOne({ email: 'test@example.com' })"
```

### Check Indexes on a Collection
```bash
docker exec -it a-ir-dd2-mongodb mongosh \
  --username "$MONGO_USER" \
  --password "$MONGO_PASSWORD" \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "db.users.getIndexes()"
```

### Reset Everything
```bash
# Stop and destroy
docker-compose down -v

# Start fresh
docker-compose up -d
npm run dev  # Backend will re-initialize
```

---

## ⚡ Performance Considerations

### Indexes Rationale

| Index | Purpose | Query Examples |
|-------|---------|-----------------|
| `users.email` (unique) | Fast login by email | `db.users.findOne({ email: '...' })` |
| `llm_configs.userId+provider` (unique) | Prevent duplicate configs | Insert validation |
| `user_settings.userId` (unique) | Fast settings lookup | `db.user_settings.findOne({ userId: ... })` |
| `workflows.userId` | List user workflows | `db.workflows.find({ userId: ... })` |
| `agent_instances.agentId+createdAt` | Historical tracking | Pagination queries |

### Query Optimization Tips

```javascript
// GOOD: Uses index on userId
db.workflows.find({ userId: ObjectId(...) })

// BAD: Full collection scan
db.workflows.find({ name: 'My Workflow' })
// (Consider adding index on name if frequently queried)

// GOOD: Uses compound index
db.llm_configs.findOne({ userId: ..., provider: 'openai' })
```

---

## 📚 Files Reference (Updated Architecture)

| File | Type | Status | Purpose |
|------|------|--------|---------|
| `docker-compose.yml` | Active | ✅ | Container orchestration |
| `backend/src/services/databaseInit.ts` | Active | ✅ | **PRIMARY**: Initialization logic |
| `backend/src/server.ts` | Active | ✅ | Calls databaseInit on startup |
| `init-collections.js` | Reference | 📚 | Documentation & reference only |
| `init-mongo.sh` | Legacy | ❌ | Not used (deprecated) |
| `.env.docker` | Template | ✅ | Configuration template |
| `README.md` | Guide | ✅ | User-facing documentation |

---

## 🎯 Benefits of Code-First Architecture

### ✅ Robustness
- No Docker timing dependencies
- Handles errors gracefully
- Automatic recovery on restart

### ✅ Transparency
- Backend logs show exactly what's happening
- Easy to debug issues
- Clear error messages

### ✅ Flexibility
- Easy to modify schema without Docker rebuild
- Can add new collections on the fly
- Version management in application code

### ✅ Cross-Platform
- Identical behavior on Windows, Mac, Linux
- No shell script compatibility issues
- Works with or without Docker

### ✅ Safety
- Idempotent operations (no data corruption)
- Parallel startup safe
- Non-blocking failures

---

## 🔮 Future Enhancements

1. **Database Versioning**: Track schema versions in DB
2. **Migration System**: Automated schema upgrades
3. **Seed Data**: Bulk load test workflows/agents
4. **Monitoring**: Log initialization performance metrics
5. **Backup Automation**: Scheduled backups on startup

---

**Professional MongoDB Docker Setup for A-IR-DD2**

Last Updated: January 16, 2026

Implemented with Code-First initialization for maximum robustness and cross-platform consistency.
