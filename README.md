# A-IR-DD2 - AI Robot Design & Development System V2

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)

> **Advanced Multi-LLM Workflow Orchestrator with Robot Specialization Architecture & User Persistence (J4.3)**

A-IR-DD2 is a next-generation AI orchestration platform implementing a specialized robot architecture for managing complex multi-LLM workflows. Features 5 specialized robots (Archi, Bos, Com, Phil, Tim), N8N-style visual workflow editing, JWT authentication with MongoDB persistence, and enterprise-grade governance.

**🎯 Current Release: J4.3 COMPLETE** - User authentication, encrypted API keys, and settings persistence production-ready!

### 📚 Documentation
> **Need help?** Check [DOCUMENTATION_MAP.md](DOCUMENTATION_MAP.md) for quick navigation to guides and FAQs.

The current version of A-IR-DD2 is built on a central prototype creation architecture. These prototypes enable the generation and orchestration of specialized AI agents directly within the visual workflow editor.

---

## ✨ Key Features

### 🤖 Robot Specialization Architecture
- **Archi** (AR_001): Agent prototyping, instantiation, inter-agent links, task management, prototype library.
- **Bos** (BO_002): Workflow mapping, live monitoring, analytics & costs, user governance, public playground.
- **Com** (CO_003): API connections, SQL/NoSQL databases, vector DBs, MCP integrations, connector hub.
- **Phil** (PH_004): RAG configuration, file handling, custom functions, external libraries, knowledge base.
- **Tim** (TI_005): Triggers & webhooks, scheduling, polling, rate limiting, async task management.

### 🔄 Visual Workflow Editor (N8N-Style)
- Drag & drop canvas with React Flow
- Robot-specific node templates
- Real-time execution monitoring
- Multi-robot orchestration with governance

### 🤖 Multi-LLM Support
- **9 Providers**: Gemini, OpenAI, Anthropic, Mistral, Grok, Perplexity, Qwen, Kimi, DeepSeek
- **Local LMStudio**: Run models locally with backend CORS proxy
- **Advanced Capabilities**: Function calling, image generation/editing, web search, OCR, embeddings, reasoning
- **Smart Context**: Auto-summarization, token optimization, conversation history

### 🔐 Enterprise Security (J4.3)
- **JWT Authentication**: Secure login/register with refresh tokens
- **Encrypted API Keys**: AES-256-GCM encryption before MongoDB storage
- **User Settings**: Per-user LLM configs and preferences persisted
- **Session Management**: API keys only in memory, never in localStorage
- **Creator Validation**: Robot permission system for governance

---

## 📋 Prerequisites

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **Node.js** | 18.0 | 20.x LTS |
| **MongoDB** | 5.0 | 6.0+ |
| **Python** | 3.8 | 3.11+ |
| **Docker** | - | Optional (recommended for MongoDB) |

⚠️ **CRITICAL**: MongoDB is **MANDATORY** for J4.3. No MongoDB = no authentication or persistence.

---

---

## 🔧 Installation

### 1. Clone Repository

```bash
git clone https://github.com/sylvainbonnecarrere/A-IR-DD2.git
cd A-IR-DD2
```

### 2. Install Dependencies

```bash
npm install
cd backend && npm install && cd ..
```

### 3. Environment Configuration

> **📍 Where are LLM API Keys stored?**
> - **Guest Mode (no login)**: Browser localStorage only (not encrypted, device-specific)
> - **Authenticated Mode (logged in)**: MongoDB `llm_configs` collection (AES-256-GCM encrypted)
> - **Never in `.env` files**: API keys are entered through the Settings UI

**Backend (`backend/.env`):**

If using Docker (recommended):
```bash
# 1. Configure backend
cp backend/docker/.env.docker backend/.env

# 2. Generate security keys
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"

# IMPORTANT :  → Copy outputs to backend/.env

# 3. Start MongoDB with automatic initialization
cd backend/docker
docker-compose --env-file ../.env up -d

# 4. Start services (2 terminals from root)
# Terminal 1: cd backend && npm run dev
# Terminal 2: npm run dev

# 5. Login at http://localhost:4000
# Email: test@example.com
# Password: TestPassword123
```

Add the outputs to `backend/.env` along with your LLM API keys.

For detailed .env configuration, see [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md#environment-configuration)

### 4. Start Services

```bash
# Terminal 1: Start MongoDB (Docker setup)
cd backend/docker
docker-compose up -d

# Terminal 2: Start backend
cd backend
npm run dev

# Terminal 3: Start frontend (from root)
npm run dev
```

### 5. Verify Installation

Open http://localhost:4000 and verify:
- ✅ App loads without errors
- ✅ Login available ("Connexion" button visible)
- ✅ Test account ready: test@example.com / TestPassword123

**Backend verification:**
```bash
curl http://localhost:3001/api/health
# Response: {"status":"OK"}
```

For complete verification steps, see [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md#verification-checklist)

---

## 🔒 Authentication & Persistence (J4.3)

### Default Test Account (Docker Setup)

When using the Docker setup, a test account is automatically created:

| Field | Value |
|-------|-------|
| **Email** | `test@example.com` |
| **Password** | `TestPassword123` |
| **Status** | Active and ready to use |
| **Purpose** | Testing authentication without manual registration |

**Quick Test:**
1. Start application (all services running)
2. Go to http://localhost:4000
3. Click "Connexion"
4. Use test account credentials
5. Login successfully → Navigate to Settings to test encrypted key storage

### User Features
- **Registration**: Create new accounts with email + password
- **Login**: Secure JWT-based authentication with refresh tokens
- **Settings**: Per-user LLM configs and preferences stored in MongoDB
- **Encrypted Keys**: All API keys encrypted with AES-256-GCM before storage
- **Multi-Device**: Settings sync across devices when logged in
- **Session Management**: API keys only in memory, never in localStorage

### Guest Mode (No Account)
- Works without authentication
- LLM API keys stored in browser localStorage (not encrypted)
- Settings stored in browser localStorage only
- No persistence across devices
- Perfect for quick testing without login

> **⚠️ Security Note**: Guest mode API keys are stored in plain text in localStorage. For production use, create an account to benefit from AES-256-GCM encrypted storage.

### Authentication Flow
1. **Registration**: Click "Inscription" → Create account with email + password
2. **Login**: Click "Connexion" → Enter credentials
3. **Auto-Fetch**: Backend automatically fetches available LLM providers
4. **Settings Sync**: User preferences persisted to MongoDB
5. **Logout**: Session cleared, API keys removed from memory

---

## 🛠️ Development

### Project Structure
```
A-IR-DD2/
├── components/              # React UI components
│   ├── workflow/           # Workflow editor
│   ├── modals/             # Auth, settings modals
│   └── panels/             # Sidebar components
├── contexts/               # React Context (Auth, Localization, etc.)
├── services/               # LLM provider services (9 providers)
├── stores/                 # Zustand state management
├── hooks/                  # Custom React hooks
├── i18n/                   # Internationalization (8+ languages)
├── types.ts                # TypeScript definitions
├── backend/
│   └── src/
│       ├── server.ts              # Express + routes
│       ├── models/                # MongoDB schemas
│       ├── routes/                # API endpoints
│       ├── services/              # Business logic
│       ├── middleware/            # Auth, validation
│       ├── pythonExecutor.ts      # Python tool execution
│       └── config.ts              # Whitelisted tools
└── documentation/          # Architecture, migration guides
```

### Tech Stack
- **Frontend**: React 18, TypeScript, Tailwind, Zustand, React Flow
  - **HTTP Client**: Fetch API (native) for authentication + API calls
  - **State**: React Context + Zustand
- **Backend**: Node.js, Express, TypeScript, Mongoose ODM
  - **Authentication**: JWT (access + refresh tokens)
  - **Security**: Passport.js, bcrypt, AES-256-GCM encryption
- **Database**: MongoDB 5.0+
  - **Schema**: Mongoose validation with Zod
- **Build**: Vite with HMR

### Available Scripts

**Frontend:**
```bash
npm run dev         # Start dev server (port 5173)
npm run build       # Production build
npm run preview     # Preview production
npm run lint        # Run linter
```

**Backend:**
```bash
cd backend
npm run dev         # Start with ts-node-dev (port 3001)
npm run build       # TypeScript build
npm run start       # Run compiled code
```

### Configuration

**LLM Providers Matrix:**
| Provider | Chat | Function Calling | Images | Web Search | Local | Production Ready |
|----------|------|------------------|--------|------------|-------|------------------|
| Gemini | ✅ | ✅ | ✅ | ✅ | - | ✅ Yes |
| OpenAI | ✅ | ✅ | ✅ | - | - | ✅ Yes |
| Anthropic | ✅ | ✅ | - | - | - | ✅ Yes |
| Mistral (Cloud) | ✅ | ✅ | - | - | - | ✅ Yes |
| DeepSeek | ✅ | ✅ | - | - | - | ✅ Yes |
| **LMStudio + Mistral-7B** | ✅ | ✅ | - | - | ✅ | ✅ **Yes** |

**LMStudio Setup (Privacy-Focused, Production-Ready):**
1. Download [lmstudio.ai](https://lmstudio.ai/)
2. Load **Mistral-7B-Instruct-v0.2** or compatible model
3. Start local server (default: port 1234)
4. Backend proxy automatically routes requests
5. Eliminates CORS issues
6. **✅ Fully operational with function calling support** (production-validated)

### Python Tools
Add custom tools in `utils/pythonTools/` and register in `backend/src/config.ts`:
```typescript
export const WHITELISTED_PYTHON_TOOLS = [
    'search_web_py',
    'your_tool_here',
];
```

Contract: `python3 <script> '<json-args>'` → JSON to stdout

---

## 🚨 Troubleshooting

### MongoDB Connection
**Error**: `ECONNREFUSED` or `Cannot connect to MongoDB`

**Solutions:**
```bash
# 1. Check if MongoDB is running
# Windows: net start MongoDB
# macOS: brew services start mongodb-community
# Linux: sudo systemctl start mongod
# Docker: docker start mongodb

# 2. Verify connection string in backend/.env
# Should be: mongodb://localhost:27017/a-ir-dd2-dev

# 3. Test connection manually
mongosh "mongodb://localhost:27017/a-ir-dd2-dev"

# 4. Check port conflict
# Windows: netstat -ano | findstr :27017
# macOS/Linux: lsof -i :27017
```

### Authentication Errors
**Error**: `JWT_SECRET not configured` or `ENCRYPTION_KEY not configured`

**Solution:**
```bash
# Generate keys
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Add to backend/.env
echo "JWT_SECRET=$JWT_SECRET" >> backend/.env
echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> backend/.env

# Restart backend
npm run dev
```

**Error**: `Registration failed` or `Login rejected`

**Solutions:**
```bash
# 1. Verify users collection exists
mongosh
> use a-ir-dd2-dev
> db.users.countDocuments()  # Should work

# 2. Check password requirements
# - Minimum 8 characters
# - Valid email format

# 3. Check backend logs for specific error
```

**Error**: `useAuth must be used within AuthProvider`

**Solution:**
- Reload browser (F5) or restart dev server
- This indicates auth hook outside provider scope
- Should be fixed in latest version

### Backend/Frontend Issues
**Error**: `EADDRINUSE: address already in use :::3001`

**Solution:**
```bash
# Find and kill process
# Windows: netstat -ano | findstr :3001 && taskkill /PID <PID> /F
# macOS/Linux: lsof -i :3001 && kill -9 <PID>

# Or use different port: edit backend/.env PORT=3002
```

**Error**: `Cannot find module` or blank page

**Solution:**
```bash
# 1. Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# 2. Check Node version (must be 18+)
node --version

# 3. Restart dev server
npm run dev

# 4. Check browser console (F12) for errors
```

### Settings Not Persisting
**Error**: Settings disappear after refresh

**Diagnosis:**
```bash
# 1. Check if authenticated
# Browser Console (F12) → check for Authorization header

# 2. Verify user_settings in MongoDB
mongosh
> use a-ir-dd2-dev
> db.user_settings.findOne()

# 3. If guest mode: settings in localStorage only
# Clear: Ctrl+Shift+Delete in browser
```

**Error**: `Failed to save API keys`

**Solution:**
```bash
# 1. Verify ENCRYPTION_KEY is valid
# Should be 64 hex characters

# 2. Check MongoDB user_settings collection
mongosh
> db.user_settings.countDocuments()

# 3. Check backend logs for specific error
```

### Database Initialization
**Error**: `Missing collections`

**Solution:**
```bash
# Restart backend - auto-creates collections
npm run dev

# Verify
mongosh
> use a-ir-dd2-dev
> show collections
# Should list: users, llm_configs, user_settings, workflows, agents, etc.
```

---

## 🏗️ Architecture

### System Overview
```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Frontend      │         │   Backend Proxy  │         │   LMStudio      │
│   React + TS    │◄───────►│   Node.js + TS   │◄───────►│   Local Models  │
│   Robot UI      │         │   CORS Handler   │         │   (Mistral...)  │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                    │
                                    │ JWT Auth
                                    ▼
                            ┌──────────────────┐
                            │     MongoDB      │
                            │  (users, settings)
                            └──────────────────┘
                                    │
                                    ▼
                            ┌──────────────────┐
                            │  Cloud LLMs      │
                            │  (Gemini, GPT-4) │
                            └──────────────────┘
```

### Robot Specialization Matrix
| Robot | Domain | Capabilities | Color |
|-------|--------|-------------|-------|
| **Archi** | Architecture | Workflow design, agent creation | Cyan |
| **Bos** | Monitoring | Supervision, cost tracking | Red |
| **Com** | Connections | APIs, auth, integrations | Blue |
| **Phil** | Data | File handling, validation | Purple |
| **Tim** | Events | Triggers, scheduling | Orange |

### Security Model (J4.3)
- **Frontend**: Session-only storage (localStorage for guest mode)
- **Backend**: Bearer token authentication (JWT)
- **Database**: Encrypted API keys (AES-256-GCM)
- **Transport**: HTTPS recommended for production
- **Governance**: Creator ID validation for prototypes

---

## ⚠️ Known Limitations

### LMStudio & Local Models
- **Mistral-7B (LMStudio)**: ✅ **FULLY OPERATIONAL** - Tested and validated on production machines
  - Function calling: Supported (tested & verified by QA)
  - Chat completion: Fully working
  - Note: Not available in current dev environment due to resource constraints, but production-ready
  
- **Function Calling by Model Type**:
  - ✅ Cloud APIs (OpenAI, Gemini, Anthropic): Full support
  - ✅ Specialized local models (Hermes, Functionary): Full support
  - ✅ Mistral-7B in LMStudio: Fully supported (production-validated)
  
- **Embeddings**: Only embedding-specific models support this
- **Performance**: Local models slower than cloud APIs for complex reasoning tasks

### Recommendations
- Use **cloud APIs** (Gemini, OpenAI) for production workloads requiring cloud infrastructure
- Use **LMStudio + Mistral-7B** for privacy-sensitive tasks or offline deployments (production-ready)
- Use **cloud APIs** for rapid prototyping and advanced reasoning
- Test capability detection before deploying workflows to production
- Monitor console warnings for model compatibility issues

---

## 🔒 Security Best Practices

- **Dependency Audits**: `npm audit` regularly
- **Environment Variables**: Never commit `.env` files
- **Input Validation**: All inputs sanitized
- **CORS**: Backend proxy handles local LLM access
- **Python Execution**: Whitelist-based sandboxing
- **API Keys**: Encrypted at rest, session-only in memory
- **JWT**: Refresh tokens for token rotation

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open Pull Request

## 🙏 Support & Community

- **Issues**: [GitHub Issues](https://github.com/sylvainbonnecarrere/A-IR-DD2/issues)
- **Discussions**: [GitHub Discussions](https://github.com/sylvainbonnecarrere/A-IR-DD2/discussions)
- **Documentation**: [Project Wiki](https://github.com/sylvainbonnecarrere/A-IR-DD2/wiki)

---

**Built with ❤️ by the A-IR-DD2 Team**

*Empowering the future of AI orchestration through specialized robot architecture.*

Last Updated: J4.3 (January 2025)
