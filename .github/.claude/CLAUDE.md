# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (root directory)
```bash
npm install          # Install dependencies
npm run dev          # Dev server at http://127.0.0.1:4000 (strictPort)
npm run build        # Production build
npm run lint         # Lint
npm test             # Run Jest tests
npm run test:watch   # Jest in watch mode
npm run test:coverage
```

### Backend (`backend/` directory)
```bash
cd backend
npm install
npm run dev          # ts-node-dev server at http://localhost:3001
npm run build        # TypeScript compile to dist/
npm run start        # Run compiled dist/server.js
npm test
npm run test:watch
npm run test:coverage
```

### Full stack startup (3 terminals)
```bash
# Terminal 1 — MongoDB (Docker)
cd backend/docker && docker-compose up -d

# Terminal 2 — Backend
cd backend && npm run dev

# Terminal 3 — Frontend
npm run dev
```

### Running a single test
```bash
# Frontend
npx jest path/to/test.test.ts

# Backend
cd backend && npx jest path/to/test.test.ts
```

## Architecture

This is a **multi-LLM agent workflow orchestrator**: a visual canvas where users build pipelines of AI agents, each backed by a configurable LLM provider.

### Two critical domains (keep separated)

| Domain | Purpose | Key files |
|---|---|---|
| **Design** | Prototype/agent definitions — static, JSON-serializable, CRUD | `types.ts`, `App.tsx`, `components/AgentSidebar.tsx` |
| **Runtime** | Agent execution state — streaming, real-time, WebSocket | `components/AgentNode.tsx`, `services/*Service.ts` |

### Frontend (`/` root)

- **`App.tsx`** — root component, orchestrates agent management state
- **`types.ts`** — single source of truth for all TypeScript interfaces (`Agent`, `WorkflowNode`, `LLMProvider` enum, etc.)
- **`services/llmService.ts`** — dispatches to provider modules (`openAIService.ts`, `geminiService.ts`, `anthropicService.ts`, etc.)
- **`stores/`** — Zustand stores: Design, Runtime, Workflow, Localization, RobotManagement, SaveMode
- **`contexts/`** — React Context: Auth, Localization
- **`components/`** — UI: modals, panels, workflow canvas (React Flow 11), sidebar, robot panels
- **`i18n/`** — 8+ language files; all keys via `contexts/LocalizationContext.tsx`

### Backend (`backend/src/`)

- **`server.ts`** — Express entry point, mounts all routes, Socket.IO
- **`routes/`** — 13 route files (auth, workflows, agents, llm, user settings, media, …)
- **`models/`** — Mongoose schemas: User, Agent, Workflow, LLMConfig, Journal, MediaReference, UserWorkspace
- **`services/`** — LLM integrations, persistence, governance logic
- **`middleware/`** — JWT auth (Passport.js), rate limiting (express-rate-limit), Helmet security headers
- **`pythonExecutor.ts`** — executes whitelisted Python scripts; contract: `python3 <script> '<json-args>'` → JSON to stdout
- **`config.ts`** — contains `WHITELISTED_PYTHON_TOOLS` — only scripts listed here can be executed

### LLM Provider interface

Every provider module must export:
```typescript
export const generateContentStream = async function* (apiKey, model, systemInstruction, history, tools, outputConfig)
export const generateContent = async (apiKey, model, systemInstruction, history, tools, outputConfig)
// optional:
export const generateContentWithSearch = async (apiKey, model, prompt, systemInstruction)
export const generateImage = async (apiKey, prompt)
export const editImage = async (apiKey, prompt, image)
```

Message format: `ChatMessage[]` with `sender: 'user' | 'agent' | 'tool' | 'tool_result'`. Agent messages may include `toolCalls: ToolCall[]`.

### Authentication & security model

- **Guest mode**: API keys stored unencrypted in localStorage
- **Authenticated mode**: API keys encrypted AES-256-GCM before MongoDB storage
- JWT access + refresh token rotation (Passport.js)
- `backend/.env` requires: `MONGO_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` (all 64 hex chars)

### Robot specialization (V2 architecture)

Five specialized robots govern prototype creation — validate `creator_id` matches mandate:

| Robot | ID | Mandate |
|---|---|---|
| **Archi** | AR_001 | Agent prototypes, orchestration |
| **Bos** | BO_002 | Workflow supervision, analytics |
| **Com** | CO_003 | API connections, external integrations |
| **Phil** | PH_004 | RAG, file handling, data transformation |
| **Tim** | TI_005 | Triggers, scheduling, async tasks |

### V2 sidebar refactor (in progress)

Priority: compact vertical icon-based navigation to maximize React Flow canvas space.
Atomic design target: `<IconMenuItem>` → `<IconSidebar>` → `<AppLayout>`.

## Key conventions

- **All new interfaces** go in `types.ts`
- **Localization**: never hardcode UI strings — add keys to `i18n/*.ts` and use `LocalizationContext`
- **New LLM providers**: copy interface from `openAIService.ts`; register in `services/llmService.ts`
- **ES modules** (frontend `"type": "module"`): no `__dirname` — use `fileURLToPath(import.meta.url)` (see `pythonExecutor.ts`)
- **Python executable**: backend uses `python3`; on Windows this may need to be `python`
- **Stream parsing**: follow chunk assembly pattern in `openAIService.ts` for `data: ` line parsing
- **Offline dev**: use `mockLLMService.ts` to avoid real API calls
- **Tests**: on the frontend, all the tests are in `tests/` forlder and for the backend it is in `backend/tests/`


## Collaboration process

Before implementing any significant architectural change:
1. Read `documentation/` (backend) and `Guides/` (frontend) for current milestone context
2. Propose design + Design Patterns to use
3. Perform impact/regression analysis
4. Get explicit user approval before generating final code

## UX and Design
You must refer to the graphic chart `in Guides\UX/` when you work on the design.

# Use comments sparingly. Only comment complex code.