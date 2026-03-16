┌─────────────────────────────────────────┐
│ PHASE 1 — Fondations (J1 + J2)          │ ← À faire EN PREMIER
│ Schémas MongoDB + API REST Backend      │
└──────────────┬──────────────────────────┘
               │
      ┌────────┴────────┐
      ▼                 ▼
  ┌─────────────┐   ┌──────────────┐
  │ J3 + J4     │   │ J7           │ ← Fonctions natives (incl. duckduckgo)
  │ Phil/Libs   │   │              │
  │ Éditeur+    │   │ Python files │
  │ Sandbox ✓   │   │              │
  └──────┬──────┘   └──────┬───────┘
         │                 │
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │ J8              │ ← LLMs locaux
         │ (FunctionCalling)
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │ J9              │ ← ToolCall UI
         │ (Affichage)     │
         └─────────────────┘

Situation Actuelle vs. Plan
Composant	État actuel	Plan	Statut
J1 — Modèle MongoDB UserFunction	❌ Inexistant	Créer collection + indices	🔴 À faire
J2 — API REST /api/functions	❌ Inexistant	GET/POST/PATCH/DELETE	🔴 À faire
J3 — Phil/Library	⚠️ Partial	Onglet Bibliothèque complet	🟡 En cours
J4.1/J4.2 — Éditeur Monaco + dépendances	✅ Partiellement	Monaco + gestion librairies	🟢 Proche
J4.3 — Sandbox Console pour TypeScript	❌ Stub ("sera disponible en V2")	WebSocket + logs temps réel	🔴 À faire
J7 — 11 fonctions natives (incl. web_search_py + duckduckgo)	❌ Inexistant	Python backend + Docker	🔴 À faire
J8 — LLMs locaux (Prompt Engineering)	❌ Inexistant	FunctionCallingPromptBuilder	🔴 À faire

Étape 1️⃣ — J1 + J2 (1-2 sprints) [BLOQUANT]
✅ Créer modèle MongoDB UserFunction
✅ Créer API REST /api/functions
✅ Seed les 11 fonctions natives
Sortie : L'API peut lister/créer/modifier des fonctions.

Étape 2️⃣ — J4.3 Sandbox Console (1 sprint) [CRITIQUE]
Remplacer le message stub par une vraie console d'exécution :

Requis :

Backend exposer POST /api/functions/sandbox/run (voir plan J2+)
Frontend : composant SandboxConsole.tsx avec WebSocket
Étape 3️⃣ — J7.2 Fonctions Web (1-2 sprints) [DÉVERROUILLE QA]
Implémenter les fonctions natives :

Intégration : Le ToolExecutor route vers ces scripts Python.

Étape 4️⃣ — Test Agent → Tool Call (1 sprint) [QA VALIDATION]
Agent utilise web_search_py avec query duckduckgo
Résultat persiste en BDD
ToolCallBlock affiche le résultat dans le chat
Estimation Réaliste
Phase	Durée	Dépend de
J1 (MongoDB)	3-5j	✅ Prêt maintenant
J2 (API Backend)	5-7j	J1 complété
J4.3 (Sandbox Console UI)	3-4j	J2 complété
J7.2 (web_search_py + duckduckgo)	4-6j	J1+J2 complétés
J8 (LLMs locaux — Prompt Builder)	5-10j	J7 complété
J9 (ToolCall UI + persistance)	3-5j	J8 complété
TOTAL chemin critique	~24-37 jours	

Gap	Criticité
isolated-vm absent de package.json	🔴 BLOQUANT pour J4.3
WORKSPACE_ROOT, PYTHON_EXECUTABLE absents des .env	🔴 BLOQUANT dès J7
Dockerfile.sandbox-python + service docker-compose non créés	🟡 sandbox Docker J7
Scripts npm run migrate / seed:functions absents	🟡 onboarding dev
tailwindcss/framer-motion absents du package.json frontend	🟡 build production
Séquence d'installation nulle part documentée	🟡 onboarding

Bilan de l'audit — Gaps identifiés et comblés
L'analyse a couvert package.json (frontend + backend), requirements.txt, docker-compose.yml, les .env, et les scripts npm. Voici ce que le plan original ne prenait pas en compte :

Gaps critiques (🔴 bloquants)
Gap	Impact
isolated-vm absent de package.json	Sandbox TypeScript J4.3 stub permanent, sans erreur visible
WORKSPACE_ROOT absent des .env	pythonExecutor.ts fallback sur sandbox (chemin inexistant sur Windows)
Aucune séquence d'installation documentée	Risque d'oubli systématique par les nouveaux développeurs
Gaps importants (🟡)
Gap	Impact
Dockerfile.sandbox-python non créé	bash_py (F02) ne peut pas être sandboxée via Docker (J7)
Service sandbox-python absent du docker-compose.yml	Idem
FUNCTION_SANDBOX_TIMEOUT_MS, SANDBOX_PYTHON_IMAGE, etc. absents des .env	Configuration sandbox non portable
Scripts migrate:up/down, seed:functions manquants	Migration 004 impossible en CI/CD ou rollback manuel
tailwindcss/framer-motion absents du package.json frontend	Build production cassé (Tailwind chargé uniquement via CDN)
python-dotenv, motor, httpx manquants dans requirements.txt	Manques pour J8 (agent_py complet) et usage standalone de runner.py
Ce qui a été ajouté au plan
Le Jalon J0 — Installation, Prérequis et Dépendances (8 sous-sections) a été inséré avec :

J0.1 : tableau des prérequis système (Node, Python, Docker, etc.)
J0.2 : isolated-vm + dockerode backend (avec nota Windows build tools)
J0.3 : état des dépendances frontend + action corrective
J0.4 : requirements.txt complété + commandes virtualenv
J0.5 : bloc env complet pour .env.docker/.env.example
J0.6 : Dockerfile.sandbox-python + service dans docker-compose.yml
J0.7 : scripts npm migrate:up/down, seed:functions, setup:tools-v2
J0.8 : séquence d'installation pas-à-pas + vérification post-install