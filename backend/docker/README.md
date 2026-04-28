# MongoDB Docker Setup for A-IR-DD2 (Code-First Architecture)

This professional Docker setup implements a **Code-First** initialization architecture that eliminates fragile volume-based initialization scripts and ensures robust, cross-platform database initialization.

## ✨ Architecture Evolution

### ❌ Previous Approach (Deprecated)
- Relied on Docker volume mount for `init-collections.js`
- Fragile: Dependent on MongoDB internal initialization order
- Platform-specific issues: Problems with authentication timing
- Result: Corrupted data, initialization failures

### ✅ Current Approach (Code-First)
- MongoDB container is **"engine-only"**: No initialization logic
- Backend Node.js service initializes schema after connection
- **Idempotent design**: Safe to call multiple times
- **Platform-agnostic**: Works identically on Windows, Mac, Linux
- **Robust**: Automatic retry and error handling

---

## 🚀 Quick Start Guide

### Phase 1: Reset Infrastructure (First-Time Setup)

**CRITICAL** ⚠️ If you have an existing MongoDB volume from the previous approach:

```bash
cd backend/docker

# Destroy old volume (data loss - this is intentional cleanup)
docker-compose down -v

# Verify volume is gone
docker volume ls | grep mongodb
# Should return nothing
```

### Phase 2: Start MongoDB (Engine Only)

```bash
# From backend/docker directory
cd backend/docker

# Start fresh MongoDB container
docker-compose --env-file .env up -d

# Verify container is running
docker ps | grep a-ir-dd2-mongodb

# Check MongoDB is healthy
docker-compose logs -f mongodb

# Wait for status: "healthy"
# Exit logs: Ctrl+C
```

### Phase 3: Configure Backend

```bash
# From backend root directory
cd backend

# Copy environment template
cp docker/.env.docker .env

# Edit .env and generate security keys:
# 1. Generate JWT_SECRET (32-char hex):
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#
# 2. Generate ENCRYPTION_KEY (32-char hex):
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#
# Paste the outputs into backend/.env
```

### Phase 4: Start Backend (Triggers Schema Initialization)

```bash
cd backend

# Install dependencies (first time only)
npm install

# Start development server
npm run dev

# Watch for logs:
# ✅ Backend listening on port 3001
# 🔧 Starting database initialization...
# 📋 Creating collections with schema validation...
# 🗂️  Creating indexes for performance...
# 👤 Creating test user...
# 🎯 Database initialization complete!
```

**This is where the magic happens!** 🪄
- The backend detects MongoDB connection
- Calls `databaseInitService.ts`
- Collections, indexes, and test user are created automatically
- Process is **idempotent** (safe to restart)

### Phase 5: Verify Installation

```bash
# Test Backend Health
curl http://localhost:3001/api/health

# Response should be:
# {"status":"OK","message":"Backend is running"}

# Test MongoDB Collections
docker exec -it a-ir-dd2-mongodb mongosh \
  --username ${MONGO_USER} \
  --password ${MONGO_PASSWORD} \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "show collections"

# Should show all 9 collections:
# agent_instances
# agent_prototypes
# agents
# llm_configs
# user_settings
# users
# workflow_edges
# workflow_nodes
# workflows

# Verify Test User
docker exec -it a-ir-dd2-mongodb mongosh \
  --username ${MONGO_USER} \
  --password ${MONGO_PASSWORD} \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "db.users.findOne({ email: 'test@example.com' })"

# Should show the test user document
```

---

## 🧪 Using the Test Account

After successful installation:

1. ✅ MongoDB running: `docker-compose ps`
2. ✅ Backend running: `curl http://localhost:3001/api/health`
3. ✅ Frontend running: `npm run dev` (from root)
4. Open http://localhost:5173
5. Click "Connexion" (Login)
6. Enter credentials:
   - Email: **`test@example.com`**
   - Password: **`TestPassword123`**
7. ✅ Successfully authenticated!
8. Test persistence: Go to Settings → Clés API

---

## 📊 What Gets Created

### Collections (9 Total)

| Collection | Purpose | Key Fields |
|-----------|---------|-----------|
| `users` | User accounts | email (unique), password, role |
| `llm_configs` | LLM credentials | userId, provider (unique pair) |
| `user_settings` | User preferences | userId (unique), preferences, version |
| `workflows` | Workflow definitions | name, creator_id, userId |
| `agents` | Agent prototypes | name, creator_id |
| `workflow_nodes` | Visual nodes | workflowId, nodeId, position |
| `workflow_edges` | Visual connections | workflowId, source, target |
| `agent_prototypes` | Agent templates | creator_id, name |
| `agent_instances` | Runtime tracking | agentId, workflowId, executionState |

### Indexes (Performance)

- **users.email** (unique)
- **llm_configs.userId + provider** (unique compound)
- **user_settings.userId** (unique)
- **workflows.creator_id**, **workflows.userId**
- **agents.creator_id**
- **workflow_nodes.workflowId**
- **workflow_edges.workflowId**
- **agent_prototypes.creator_id**
- **agent_instances.agentId + createdAt**

### Schema Validation

All collections enforce JSON Schema validation on insert/update:
- Type checking (bsonType)
- Required fields validation
- Enum constraints
- Pattern matching for emails

---

## 🛠️ Container Management

### View Status
```bash
cd backend/docker

# Check if container is running
docker-compose ps

# Real-time logs
docker-compose logs -f mongodb

# Last 50 lines
docker-compose logs --tail 50 mongodb
```

### Lifecycle Operations
```bash
# Stop (keep data)
docker-compose stop

# Resume (same data)
docker-compose start

# Restart (clear cache, keep data)
docker-compose restart

# Full cleanup (⚠️ DATA LOSS - use for reset)
docker-compose down -v
```

### Direct MongoDB Access
```bash
# Connect to mongosh shell
docker exec -it a-ir-dd2-mongodb mongosh \
  --username ${MONGO_USER} \
  --password ${MONGO_PASSWORD} \
  --authenticationDatabase admin

# In mongosh:
> use a-ir-dd2-dev
> db.users.countDocuments()
> db.workflows.find().pretty()
> exit()
```

---

## 📦 Backup & Restore

### Backup Database
```bash
docker exec a-ir-dd2-mongodb mongodump \
  --username ${MONGO_USER} \
  --password ${MONGO_PASSWORD} \
  --authenticationDatabase admin \
  --db a-ir-dd2-dev \
  --archive=backup-$(date +%Y%m%d-%H%M%S).archive
```

### Restore from Backup
```bash
docker exec -i a-ir-dd2-mongodb mongorestore \
  --username ${MONGO_USER} \
  --password ${MONGO_PASSWORD} \
  --authenticationDatabase admin \
  --archive < backup-20250116-143022.archive
```

---

## 🔐 Security

### Development (Current)
✅ Authentication enabled  
✅ Schema validation enforced  
✅ Indexes for data integrity  
✅ Test user segregated  
⚠️ Credentials in plaintext (development only)

### Production Checklist

1. **Change Credentials**
   ```yaml
   # docker-compose.yml
   MONGO_INITDB_ROOT_USERNAME: prod_secure_admin
   MONGO_INITDB_ROOT_PASSWORD: <generate-strong-password>
   ```

2. **Network Security**
   - ❌ Never expose port 27017 to internet
   - ✅ Firewall: Restrict to backend container only
   - ✅ Use container network isolation

3. **Data Protection**
   - ✅ Enable MongoDB encryption at rest (Enterprise or Atlas)
   - ✅ Use TLS/SSL for connections
   - ✅ Implement automated daily backups

4. **Access Control**
   - ✅ Use Kubernetes secrets for credentials
   - ✅ Implement RBAC
   - ✅ Enable audit logging

5. **Recommended: MongoDB Atlas**
   - Cloud-managed MongoDB
   - Automatic backups and recovery
   - Global distribution
   - Compliance features

---

## 🐛 Troubleshooting

### Container Won't Start
```bash
# Check logs for errors
docker-compose logs mongodb

# Common causes:
# 1. Port 27017 already in use
# 2. Docker daemon not running
# 3. Insufficient disk space
```

### Connection Refused
```bash
# Verify container is running
docker ps | grep a-ir-dd2-mongodb

# If not found:
docker-compose up -d

# Check initialization logs
docker-compose logs
```

### Authentication Failed
```bash
# Verify credentials match docker-compose.yml
grep MONGO_ backend/.env

# Test credentials manually
docker exec -it a-ir-dd2-mongodb mongosh \
  --username "$MONGO_USER" \
  --password "$MONGO_PASSWORD" \
  --authenticationDatabase admin
```

### Collections Not Created
```bash
# Check backend initialization logs
npm run dev

# Watch for initialization messages
# If errors appear, check MongoDB connection
```

---

## 🔄 Development Workflow

### Daily Startup
```bash
# Terminal 1: MongoDB (backend/docker)
cd backend/docker
docker-compose up -d

# Terminal 2: Backend (backend)
cd backend
npm run dev

# Terminal 3: Frontend (root)
npm run dev
```

### After Major Changes
```bash
# Restart everything fresh
docker-compose down -v  # MongoDB reset
npm run dev             # Triggers re-initialization
```

---

## 📚 Reference

### Files & Roles

| File | Role | Status |
|------|------|--------|
| `docker-compose.yml` | Container orchestration | ✅ Active |
| `init-collections.js` | Reference only | 📚 Documentation |
| `backend/src/services/databaseInit.ts` | **Active initialization** | ✅ Primary |

### Environment Variables
```env
# .env.docker template
MONGODB_URI=mongodb://<set-mongo-admin-user>:<set-mongo-strong-password>@localhost:27017/a-ir-dd2-dev?authSource=admin
MONGO_USER=<set-mongo-admin-user>
MONGO_PASSWORD=<set-mongo-strong-password>
JWT_SECRET=<generated-32-hex>
ENCRYPTION_KEY=<generated-32-hex>
```

---

## ✅ Checklist: First-Time Setup

- [ ] Docker & Docker Compose installed
- [ ] Old MongoDB volume cleaned: `docker-compose down -v`
- [ ] MongoDB started: `docker-compose up -d`
- [ ] Backend .env configured with generated keys
- [ ] Backend started: `npm run dev` (wait for "initialization complete")
- [ ] Collections verified: `show collections` in mongosh
- [ ] Test user created: `db.users.findOne({ email: 'test@example.com' })`
- [ ] Frontend started: `npm run dev`
- [ ] Login tested with test@example.com / TestPassword123

---

**Professional MongoDB Setup for A-IR-DD2 J4.3**

Last Updated: January 16, 2026

Built with Code-First initialization for robustness and cross-platform consistency.
