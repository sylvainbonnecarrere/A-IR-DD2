┌─────────────────────────────────────────────────────┐ │ AGENT LOOP │ │ │ │ Prompt ──► Gather Context ──► Plan Action │ │ │ │ │ Repeat ◄─── Verify ◄── Execute Tool │ │ │ │ [Hooks interceptent à chaque étape] │ └─────────────────────────────────────────────────────┘



---
## 2. Hooks — Interception et Contrôle
Les hooks sont le mécanisme principal pour **observer, modifier ou bloquer** le comportement d'un agent. Ils s'insèrent à des points d'exécution précis.
### 2.1 Événements de hook disponibles
| Événement | Déclenchement | Usage typique |
|---|---|---|
| `PreToolUse` | Avant l'exécution d'un outil | Validation, blocage, audit |
| `PostToolUse` | Après l'exécution d'un outil | Logging, transformation de sortie |
| `OnSessionStart` | Démarrage d'une session agent | Init contexte, auth |
| `OnSessionEnd` | Fin de session | Cleanup, notifications |
| `OnAgentMessage` | Chaque message de l'agent | Monitoring, filtrage |
| `OnError` | Toute erreur dans la boucle | Alerting, recovery |
| `OnSubagentSpawn` | Création d'un sous-agent | Contrôle de prolifération |
| `OnHumanApprovalRequired` | Demande d'approbation humaine | UI trigger |
### 2.2 Anatomie d'un hook
Un hook se compose de :
- **La fonction callback** : logique métier
- **Le matcher** : filtre sur le nom de l'outil (regex supportée)
- **La configuration** : rattachement à l'événement
### 2.3 Types de réponses d'un hook
```typescript
// Autoriser (réponse vide)
return {};
// Bloquer avec raison
return {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Opération non autorisée dans ce contexte"
  }
};
// Demander approbation humaine
return {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "require_human_approval",
    permissionDecisionReason: "Écriture base de données détectée"
  }
};
// Transformer l'input avant exécution
return {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    modifiedInput: { ...input, sanitized: true }
  }
};
2.4 Hooks essentiels à implémenter systématiquement
Python — Hook de protection fichiers sensibles
python


import asyncio
import re
from claude_agent_sdk import query, ClaudeAgentOptions, HookMatcher
PROTECTED_PATTERNS = [
    r"\.env(\..+)?$",
    r".*\.pem$",
    r".*\.key$",
    r".*id_rsa.*",
    r".*secrets\.(json|yaml|yml)$",
    r".*credentials.*",
]
async def protect_sensitive_files(input_data, tool_use_id, context):
    file_path = input_data.get("tool_input", {}).get("file_path", "")
    
    for pattern in PROTECTED_PATTERNS:
        if re.search(pattern, file_path, re.IGNORECASE):
            return {
                "hookSpecificOutput": {
                    "hookEventName": input_data["hook_event_name"],
                    "permissionDecision": "deny",
                    "permissionDecisionReason": f"Fichier protégé : {file_path}"
                }
            }
    return {}
Python — Hook d'audit logging
python


import logging
import json
from datetime import datetime, timezone
logger = logging.getLogger("agent.audit")
async def audit_all_tools(input_data, tool_use_id, context):
    log_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tool_use_id": tool_use_id,
        "tool_name": input_data.get("tool_name"),
        "tool_input": input_data.get("tool_input"),
        "session_id": context.get("session_id"),
        "agent_id": context.get("agent_id"),
    }
    logger.info(json.dumps(log_entry))
    return {}  # Toujours autoriser, juste logguer
Python — Hook d'approbation humaine pour actions destructrices
python


DESTRUCTIVE_PATTERNS = [
    r"^(rm|del|drop|truncate|delete)",
    r"--force",
    r"--no-backup",
]
APPROVAL_REQUIRED_TOOLS = {"bash", "file_write", "database_query"}
async def require_human_for_destructive(input_data, tool_use_id, context):
    tool_name = input_data.get("tool_name", "")
    tool_input = str(input_data.get("tool_input", ""))
    
    if tool_name not in APPROVAL_REQUIRED_TOOLS:
        return {}
    
    for pattern in DESTRUCTIVE_PATTERNS:
        if re.search(pattern, tool_input, re.IGNORECASE):
            return {
                "hookSpecificOutput": {
                    "hookEventName": input_data["hook_event_name"],
                    "permissionDecision": "require_human_approval",
                    "permissionDecisionReason": (
                        f"Action potentiellement destructrice détectée "
                        f"dans {tool_name}: {tool_input[:100]}"
                    )
                }
            }
    return {}
TypeScript — Hook de rate limiting par outil
typescript


import { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
const toolCallCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMITS: Record<string, number> = {
  web_search: 20,
  web_fetch: 10,
  bash: 50,
  file_write: 30,
};
export const rateLimitHook: HookCallback<PreToolUseHookInput> = async (
  inputData,
  toolUseId,
  context
) => {
  const toolName = inputData.tool_name;
  const limit = RATE_LIMITS[toolName];
  if (!limit) return {};
  const now = Date.now();
  const windowMs = 60_000; // 1 minute
  const entry = toolCallCounts.get(toolName);
  if (!entry || now > entry.resetAt) {
    toolCallCounts.set(toolName, { count: 1, resetAt: now + windowMs });
    return {};
  }
  if (entry.count >= limit) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Rate limit atteint pour ${toolName}: ${limit} appels/min`,
      },
    };
  }
  entry.count++;
  return {};
};
TypeScript — Hook PostToolUse pour transformer les sorties
typescript


import { HookCallback, PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
export const sanitizeOutputHook: HookCallback<PostToolUseHookInput> = async (
  inputData,
  toolUseId,
  context
) => {
  const output = inputData.tool_output ?? "";
  // Masquer les tokens, clés API, etc. dans les sorties
  const sanitized = output
    .replace(/sk-ant-[a-zA-Z0-9\-_]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[a-zA-Z0-9\-_\.]{20,}/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/password\s*[:=]\s*\S+/gi, "password: [REDACTED]");
  if (sanitized !== output) {
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        modifiedOutput: sanitized,
      },
    };
  }
  return {};
};
2.5 Configuration complète des hooks dans query()
python


# Python — configuration complète
async for message in query(
    prompt=user_prompt,
    options=ClaudeAgentOptions(
        hooks={
            "PreToolUse": [
                HookMatcher(matcher="Write|Edit|Create", hooks=[protect_sensitive_files]),
                HookMatcher(matcher="bash|shell", hooks=[require_human_for_destructive]),
                HookMatcher(matcher=".*", hooks=[audit_all_tools]),  # Tous les outils
            ],
            "PostToolUse": [
                HookMatcher(matcher=".*", hooks=[sanitize_outputs]),
            ],
            "OnSubagentSpawn": [
                HookMatcher(matcher=".*", hooks=[limit_subagent_depth]),
            ],
        }
    )
):
    print(message)
typescript


// TypeScript — configuration complète
for await (const message of query(prompt, {
  hooks: {
    PreToolUse: [
      { matcher: /write|edit|create/i, hooks: [protectSensitiveFiles] },
      { matcher: /bash|shell/i,        hooks: [requireHumanForDestructive] },
      { matcher: /.*/,                 hooks: [rateLimitHook, auditHook] },
    ],
    PostToolUse: [
      { matcher: /.*/,                 hooks: [sanitizeOutputHook] },
    ],
  },
})) {
  console.log(message);
}
3. Sécurité & Best Practices
3.1 Principe du moindre privilège


┌──────────────────────────────────────────────┐
│  Règle d'or : Un agent ne doit avoir accès   │
│  qu'aux outils et ressources strictement     │
│  nécessaires à SA tâche spécifique.          │
└──────────────────────────────────────────────┘
Définir des profils d'outils par type d'agent (lecture seule, écriture contrôlée, exécution complète)
Ne jamais passer une liste d'outils globale à tous les agents
Révoquer les permissions temporaires dès la fin de la tâche
3.2 Sandboxing des exécutions bash/shell
python


# MAUVAIS — exécution directe sans sandbox
async def bash_tool(command: str) -> str:
    result = subprocess.run(command, shell=True, capture_output=True)
    return result.stdout.decode()
# BON — sandbox avec restrictions
import subprocess
import shlex
ALLOWED_COMMANDS = {"ls", "cat", "grep", "find", "echo", "pwd", "git", "npm", "python"}
BLOCKED_PATTERNS = [r"rm\s+-rf", r">\s*/dev/", r"curl.*\|\s*bash", r"wget.*\|\s*sh"]
async def bash_tool_safe(command: str) -> dict:
    # Vérifier les patterns dangereux
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return {"error": f"Commande refusée par politique de sécurité: {pattern}"}
    
    # Vérifier la commande de base
    base_cmd = shlex.split(command)[0] if command.strip() else ""
    if base_cmd not in ALLOWED_COMMANDS:
        return {"error": f"Commande non autorisée: {base_cmd}"}
    
    try:
        result = subprocess.run(
            shlex.split(command),
            capture_output=True,
            text=True,
            timeout=30,          # Timeout obligatoire
            cwd="/workspace",    # Répertoire de travail isolé
            env={                # Environnement minimal
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "HOME": "/tmp/agent_home",
            }
        )
        return {
            "stdout": result.stdout[:10_000],  # Limiter la taille de sortie
            "stderr": result.stderr[:2_000],
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"error": "Timeout: commande trop longue (>30s)"}
3.3 Validation des inputs de tous les tools
python


from pydantic import BaseModel, validator, HttpUrl
from typing import Literal
class WebSearchInput(BaseModel):
    query: str
    max_results: int = 5
    
    @validator("query")
    def sanitize_query(cls, v):
        if len(v) > 500:
            raise ValueError("Requête trop longue (max 500 caractères)")
        # Bloquer les injections de prompt via les queries
        forbidden = ["ignore previous instructions", "system prompt", "jailbreak"]
        for f in forbidden:
            if f.lower() in v.lower():
                raise ValueError("Requête non autorisée")
        return v.strip()
    
    @validator("max_results")
    def limit_results(cls, v):
        return min(max(1, v), 20)  # Clamp entre 1 et 20
class FileWriteInput(BaseModel):
    file_path: str
    content: str
    mode: Literal["create", "append", "overwrite"] = "create"
    
    @validator("file_path")
    def validate_path(cls, v):
        # Prévenir path traversal
        if ".." in v or v.startswith("/etc") or v.startswith("/sys"):
            raise ValueError(f"Chemin non autorisé: {v}")
        return v
    
    @validator("content")
    def limit_content_size(cls, v):
        max_size = 1_000_000  # 1 MB
        if len(v.encode("utf-8")) > max_size:
            raise ValueError("Contenu trop volumineux (max 1 MB)")
        return v
3.4 Isolation des secrets
python


# Ne JAMAIS passer de secrets dans le prompt ou les tool inputs
# Utiliser des variables d'environnement ou un secret manager
import os
from functools import lru_cache
@lru_cache(maxsize=None)
def get_secret(key: str) -> str:
    """Récupère un secret depuis l'environnement ou un vault."""
    value = os.environ.get(key)
    if not value:
        # Fallback vers un secret manager (ex: AWS Secrets Manager)
        raise ValueError(f"Secret manquant: {key}")
    return value
# Dans un tool, injecter le secret sans l'exposer à l'agent
async def database_query_tool(sql: str) -> dict:
    db_url = get_secret("DATABASE_URL")  # Jamais dans le contexte agent
    # ... exécution
3.5 Limites de profondeur pour les sous-agents
python


MAX_SUBAGENT_DEPTH = 3
MAX_TOTAL_SUBAGENTS = 10
async def limit_subagent_depth(input_data, tool_use_id, context):
    current_depth = context.get("agent_depth", 0)
    total_spawned = context.get("total_subagents_spawned", 0)
    
    if current_depth >= MAX_SUBAGENT_DEPTH:
        return {
            "hookSpecificOutput": {
                "hookEventName": input_data["hook_event_name"],
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"Profondeur max de sous-agents atteinte ({MAX_SUBAGENT_DEPTH})"
                )
            }
        }
    
    if total_spawned >= MAX_TOTAL_SUBAGENTS:
        return {
            "hookSpecificOutput": {
                "hookEventName": input_data["hook_event_name"],
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"Nombre max de sous-agents atteint ({MAX_TOTAL_SUBAGENTS})"
                )
            }
        }
    
    return {}
3.6 Récapitulatif des règles de sécurité
Règle	Priorité	Description
Moindre privilège	🔴 Critique	Outils minimaux par agent
Validation inputs	🔴 Critique	Pydantic/Zod sur tous les tools
Secrets isolés	🔴 Critique	Jamais dans le contexte agent
Path traversal	🔴 Critique	Valider tous les chemins fichier
Timeout systématique	🟠 Élevée	Sur tous les tools I/O
Rate limiting	🟠 Élevée	Par outil, par session
Audit log	🟠 Élevée	Tous les appels d'outils
Sandbox bash	🟠 Élevée	Répertoire et env isolés
Limit sous-agents	🟡 Moyenne	Profondeur + nombre total
Sanitize outputs	🟡 Moyenne	Masquer tokens/clés dans les sorties
4. Contrôles UI — Boutons & Interactions Humaines
4.1 Catégories de contrôles


┌─────────────────────────────────────────────────────────────┐
│                   CONTRÔLES AGENT UI                        │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  LIFECYCLE  │  │  APPROBATION │  │    MONITORING    │  │
│  │  Start      │  │  Approve ✓   │  │    View Logs     │  │
│  │  Pause ⏸   │  │  Reject ✗    │  │    Tool Trace    │  │
│  │  Resume ▶  │  │  Modify & OK │  │    Token Usage   │  │
│  │  Stop ⏹   │  │  Escalate    │  │    Cost Meter    │  │
│  │  Restart ↺  │  └──────────────┘  └──────────────────┘  │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
4.2 Boutons de lifecycle
typescript


// Interface TypeScript pour le contrôleur d'agent
interface AgentController {
  sessionId: string;
  status: "idle" | "running" | "paused" | "awaiting_approval" | "completed" | "error";
}
// Bouton START — lance l'agent avec un prompt
async function startAgent(prompt: string, options: AgentOptions): Promise<AgentController> {
  const session = await agentOrchestrator.create({ prompt, options });
  return { sessionId: session.id, status: "running" };
}
// Bouton PAUSE — suspend la boucle agent après l'outil en cours
async function pauseAgent(sessionId: string): Promise<void> {
  await agentOrchestrator.pause(sessionId);
  // L'agent finit l'outil en cours avant de se suspendre
}
// Bouton RESUME — reprend depuis l'état suspendu
async function resumeAgent(sessionId: string, injectedContext?: string): Promise<void> {
  await agentOrchestrator.resume(sessionId, {
    additionalContext: injectedContext, // Permettre d'injecter des instructions
  });
}
// Bouton STOP — arrêt propre avec sauvegarde d'état
async function stopAgent(sessionId: string): Promise<AgentSummary> {
  const summary = await agentOrchestrator.stop(sessionId, {
    saveCheckpoint: true,      // Permettre reprise ultérieure
    generateSummary: true,     // Résumé de ce qui a été accompli
  });
  return summary;
}
// Bouton ABORT — arrêt d'urgence immédiat
async function abortAgent(sessionId: string, reason: string): Promise<void> {
  await agentOrchestrator.abort(sessionId, {
    reason,
    rollback: true, // Tenter un rollback des dernières actions
  });
}
4.3 Boutons d'approbation humaine (Human-in-the-Loop)
python


# Backend Python — gestion des files d'approbation
import asyncio
from enum import Enum
from dataclasses import dataclass
class ApprovalDecision(Enum):
    APPROVE = "approve"
    REJECT = "reject"
    MODIFY = "modify"
    ESCALATE = "escalate"
@dataclass
class ApprovalRequest:
    request_id: str
    session_id: str
    tool_name: str
    tool_input: dict
    reason: str
    risk_level: str  # "low" | "medium" | "high" | "critical"
    timeout_seconds: int = 300
# File d'attente d'approbation (adaptable à Redis, DB, WebSocket)
approval_queue: asyncio.Queue[ApprovalRequest] = asyncio.Queue()
approval_responses: dict[str, ApprovalDecision] = {}
async def human_approval_hook(input_data, tool_use_id, context):
    """Hook qui met l'agent en attente d'approbation UI."""
    risk = assess_risk(input_data)
    
    if risk in ("high", "critical"):
        request = ApprovalRequest(
            request_id=tool_use_id,
            session_id=context["session_id"],
            tool_name=input_data["tool_name"],
            tool_input=input_data["tool_input"],
            reason=f"Action à risque {risk} nécessite approbation",
            risk_level=risk,
        )
        
        # Envoyer vers l'UI (WebSocket, SSE, etc.)
        await approval_queue.put(request)
        
        # Attendre la décision (timeout)
        decision = await wait_for_approval(tool_use_id, timeout=300)
        
        if decision == ApprovalDecision.APPROVE:
            return {}
        elif decision == ApprovalDecision.REJECT:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "Rejeté par l'opérateur humain"
                }
            }
    return {}
async def wait_for_approval(request_id: str, timeout: int) -> ApprovalDecision:
    """Attend la décision humaine avec timeout."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if request_id in approval_responses:
            return approval_responses.pop(request_id)
        await asyncio.sleep(0.5)
    # Timeout → rejet par défaut (fail-safe)
    return ApprovalDecision.REJECT
typescript


// Frontend TypeScript — composant d'approbation
interface ApprovalPanelProps {
  request: ApprovalRequest;
  onDecision: (decision: ApprovalDecision, modifiedInput?: object) => void;
}
// Les 4 boutons d'approbation à exposer dans l'UI
const ApprovalButtons = {
  APPROVE:  { label: "✓ Approuver",         color: "green",  action: "approve"   },
  REJECT:   { label: "✗ Rejeter",            color: "red",    action: "reject"    },
  MODIFY:   { label: "✎ Modifier & Valider", color: "orange", action: "modify"    },
  ESCALATE: { label: "↑ Escalader",          color: "purple", action: "escalate"  },
};
4.4 Boutons de monitoring & observabilité
typescript


// Contrôles de monitoring à exposer dans le tableau de bord
const MonitoringControls = {
  // Affiche la trace complète des outils appelés
  VIEW_TOOL_TRACE: async (sessionId: string) => {
    return await orchestrator.getToolTrace(sessionId);
  },
  // Affiche les tokens consommés en temps réel
  GET_TOKEN_USAGE: async (sessionId: string) => {
    return await orchestrator.getTokenUsage(sessionId);
    // { input_tokens, output_tokens, estimated_cost_usd }
  },
  // Injecte un message dans la session en cours (sans l'arrêter)
  INJECT_MESSAGE: async (sessionId: string, message: string) => {
    return await orchestrator.injectHumanMessage(sessionId, message);
  },
  // Crée un checkpoint pour rollback ultérieur
  CREATE_CHECKPOINT: async (sessionId: string) => {
    return await orchestrator.createCheckpoint(sessionId);
  },
  // Rollback au dernier checkpoint
  ROLLBACK: async (sessionId: string, checkpointId: string) => {
    return await orchestrator.rollback(sessionId, checkpointId);
  },
  // Clone la session pour tests (fork)
  FORK_SESSION: async (sessionId: string) => {
    return await orchestrator.fork(sessionId);
  },
};
4.5 Matrice des contrôles par mode d'agent
Contrôle	Agent Autonome	Agent Supervisé	Agent Interactif
Start	✅	✅	✅
Pause/Resume	✅	✅	✅
Stop/Abort	✅	✅	✅
Approve/Reject	❌ (auto)	✅	✅
Inject Message	⚠️ Limité	✅	✅
View Trace	✅ (post)	✅ (temps réel)	✅ (temps réel)
Rollback	✅	✅	⚠️ Cas extrêmes
Fork	✅	✅	❌
5. Catalogue des Tools Essentiels
Taxonomie


TOOLS
├── Recherche & Web
│   ├── web_search
│   ├── web_fetch
│   └── web_screenshot
├── Fichiers & Système
│   ├── file_read
│   ├── file_write
│   ├── file_delete
│   ├── directory_list
│   └── bash / shell_exec
├── Code & Analyse
│   ├── grep
│   ├── code_execute
│   └── diff
├── Données & APIs
│   ├── http_request
│   ├── database_query
│   └── parse_structured
└── Agents & Coordination
    ├── spawn_subagent
    ├── memory_store
    └── memory_retrieve
Définitions détaillées
Tool	Description	Inputs clés	Outputs	Risque
web_search	Recherche sur le web via API (Brave, Serper, etc.)	query, num_results, date_filter	Liste de résultats avec titre, URL, snippet	Faible
web_fetch	Récupère et parse le contenu HTML d'une URL	url, format (text/markdown/html), timeout	Contenu textuel de la page	Faible
web_screenshot	Capture d'écran d'une page web	url, viewport, wait_for	Image base64	Faible
file_read	Lit le contenu d'un fichier	file_path, encoding, start_line, end_line	Contenu du fichier	Faible
file_write	Écrit/crée/modifie un fichier	file_path, content, mode	Confirmation, chemin	Élevé
file_delete	Supprime un fichier ou dossier	path, recursive	Confirmation	Critique
directory_list	Liste le contenu d'un répertoire	path, recursive, filter	Arbre de fichiers	Faible
bash	Exécute une commande shell	command, timeout, cwd	stdout, stderr, returncode	Critique
grep	Recherche dans des fichiers par regex	pattern, path, recursive, context_lines	Matches avec contexte	Faible
code_execute	Exécute du code Python/JS dans un sandbox	code, language, timeout	Output, erreurs	Élevé
diff	Compare deux fichiers ou strings	source, target, format	Diff unifié	Faible
http_request	Requête HTTP générique	url, method, headers, body	Status, headers, body	Moyen
database_query	Exécute une requête SQL (read-only par défaut)	sql, connection_id, read_only	Résultats tabulaires	Élevé
parse_structured	Parse JSON/CSV/YAML/XML	content, format, schema	Données structurées	Faible
spawn_subagent	Lance un sous-agent avec sa propre boucle	prompt, tools, model, max_turns	Résultat du sous-agent	Élevé
memory_store	Stocke une information en mémoire persistante	key, value, ttl, namespace	Confirmation	Faible
memory_retrieve	Récupère des informations mémorisées	key ou query sémantique, namespace	Valeur ou liste de résultats	Faible
6. Exemples d'Implémentation
6.1 web_search — Python
python


import httpx
from pydantic import BaseModel, validator
import os
class WebSearchInput(BaseModel):
    query: str
    num_results: int = 5
    date_filter: str | None = None  # "day" | "week" | "month" | "year"
    @validator("query")
    def validate_query(cls, v):
        if len(v.strip()) < 2:
            raise ValueError("Requête trop courte")
        if len(v) > 500:
            raise ValueError("Requête trop longue")
        return v.strip()
    @validator("num_results")
    def clamp_results(cls, v):
        return min(max(1, v), 20)
async def web_search(query: str, num_results: int = 5, date_filter: str | None = None) -> dict:
    """
    Effectue une recherche web et retourne les résultats.
    
    Args:
        query: La requête de recherche
        num_results: Nombre de résultats souhaités (1-20)
        date_filter: Filtre temporel optionnel
    
    Returns:
        dict avec 'results' (liste) et 'query' (string)
    """
    params = WebSearchInput(query=query, num_results=num_results, date_filter=date_filter)
    
    api_key = os.environ["BRAVE_SEARCH_API_KEY"]
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    }
    
    request_params = {
        "q": params.query,
        "count": params.num_results,
        "safesearch": "moderate",
    }
    if params.date_filter:
        request_params["freshness"] = params.date_filter
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.get(
                "[api.search.brave.com](https://api.search.brave.com/res/v1/web/search)",
                headers=headers,
                params=request_params,
            )
            response.raise_for_status()
            data = response.json()
            
            results = [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("description", ""),
                    "published_date": r.get("age", ""),
                }
                for r in data.get("web", {}).get("results", [])
            ]
            
            return {"query": params.query, "results": results, "total": len(results)}
        
        except httpx.HTTPStatusError as e:
            return {"error": f"Erreur API: {e.response.status_code}", "results": []}
        except httpx.TimeoutException:
            return {"error": "Timeout dépassé (15s)", "results": []}
6.2 web_fetch — TypeScript
typescript


import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
interface WebFetchInput {
  url: string;
  format?: "text" | "markdown" | "html";
  timeout?: number;
  max_length?: number;
}
interface WebFetchOutput {
  url: string;
  title: string;
  content: string;
  format: string;
  word_count: number;
  error?: string;
}
const turndown = new TurndownService({ headingStyle: "atx" });
export async function webFetch(input: WebFetchInput): Promise<WebFetchOutput> {
  const {
    url,
    format = "markdown",
    timeout = 20_000,
    max_length = 50_000,
  } = input;
  // Validation URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { url, title: "", content: "", format, word_count: 0,
               error: "Protocole non autorisé (http/https uniquement)" };
    }
  } catch {
    return { url, title: "", content: "", format, word_count: 0,
             error: "URL invalide" };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgentBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      return { url, title: "", content: "", format, word_count: 0,
               error: `HTTP ${response.status}: ${response.statusText}` };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return { url, title: "", content: "", format, word_count: 0,
               error: `Type de contenu non supporté: ${contentType}` };
    }
    const html = await response.text();
    const dom = new JSDOM(html, { url: parsedUrl.toString() });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const title = article?.title ?? dom.window.document.title ?? "";
    let content: string;
    if (format === "html") {
      content = article?.content ?? html;
    } else if (format === "markdown") {
      content = turndown.turndown(article?.content ?? html);
    } else {
      content = article?.textContent ?? dom.window.document.body.textContent ?? "";
    }
    // Limiter la taille
    if (content.length > max_length) {
      content = content.slice(0, max_length) + "\n\n[... contenu tronqué]";
    }
    return {
      url,
      title,
      content,
      format,
      word_count: content.split(/\s+/).length,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { url, title: "", content: "", format, word_count: 0,
             error: `Erreur fetch: ${msg}` };
  } finally {
    clearTimeout(timeoutId);
  }
}
6.3 file_read & file_write — Python
python


import os
import aiofiles
from pathlib import Path
from pydantic import BaseModel, validator
WORKSPACE_ROOT = Path(os.environ.get("AGENT_WORKSPACE", "/workspace")).resolve()
def validate_workspace_path(raw_path: str) -> Path:
    """Valide qu'un chemin reste dans le workspace (anti path-traversal)."""
    path = (WORKSPACE_ROOT / raw_path).resolve()
    if not str(path).startswith(str(WORKSPACE_ROOT)):
        raise ValueError(f"Accès interdit hors du workspace: {raw_path}")
    return path
# --- FILE READ ---
class FileReadInput(BaseModel):
    file_path: str
    encoding: str = "utf-8"
    start_line: int | None = None
    end_line: int | None = None
async def file_read(
    file_path: str,
    encoding: str = "utf-8",
    start_line: int | None = None,
    end_line: int | None = None,
) -> dict:
    """
    Lit le contenu d'un fichier dans le workspace.
    
    Args:
        file_path: Chemin relatif au workspace
        encoding: Encodage du fichier
        start_line: Ligne de début (1-indexé, optionnel)
        end_line: Ligne de fin (incluse, optionnel)
    
    Returns:
        dict avec 'content', 'line_count', 'size_bytes'
    """
    try:
        path = validate_workspace_path(file_path)
    except ValueError as e:
        return {"error": str(e)}
    
    if not path.exists():
        return {"error": f"Fichier introuvable: {file_path}"}
    if not path.is_file():
        return {"error": f"Pas un fichier: {file_path}"}
    
    size = path.stat().st_size
    if size > 5_000_000:  # 5 MB max
        return {"error": f"Fichier trop volumineux ({size} bytes, max 5MB)"}
    
    async with aiofiles.open(path, "r", encoding=encoding, errors="replace") as f:
        lines = await f.readlines()
    
    if start_line is not None or end_line is not None:
        s = (start_line or 1) - 1
        e = end_line or len(lines)
        lines = lines[s:e]
    
    return {
        "content": "".join(lines),
        "line_count": len(lines),
        "size_bytes": size,
        "file_path": str(path.relative_to(WORKSPACE_ROOT)),
    }
# --- FILE WRITE ---
class FileWriteInput(BaseModel):
    file_path: str
    content: str
    mode: str = "create"  # "create" | "overwrite" | "append"
    encoding: str = "utf-8"
    @validator("mode")
    def validate_mode(cls, v):
        allowed = {"create", "overwrite", "append"}
        if v not in allowed:
            raise ValueError(f"Mode invalide. Valeurs autorisées: {allowed}")
        return v
async def file_write(
    file_path: str,
    content: str,
    mode: str = "create",
    encoding: str = "utf-8",
) -> dict:
    """
    Écrit dans un fichier du workspace.
    
    Args:
        file_path: Chemin relatif au workspace
        content: Contenu à écrire
        mode: 'create' (échoue si existe), 'overwrite', ou 'append'
    
    Returns:
        dict avec confirmation et métadonnées
    """
    try:
        params = FileWriteInput(file_path=file_path, content=content,
                                mode=mode, encoding=encoding)
        path = validate_workspace_path(params.file_path)
    except ValueError as e:
        return {"error": str(e)}
    
    if params.mode == "create" and path.exists():
        return {"error": f"Fichier déjà existant (utilisez 'overwrite'): {file_path}"}
    
    # Créer les répertoires parents si nécessaire
    path.parent.mkdir(parents=True, exist_ok=True)
    
    write_mode = "a" if params.mode == "append" else "w"
    
    async with aiofiles.open(path, write_mode, encoding=params.encoding) as f:
        await f.write(params.content)
    
    return {
        "success": True,
        "file_path": str(path.relative_to(WORKSPACE_ROOT)),
        "bytes_written": len(params.content.encode(params.encoding)),
        "mode": params.mode,
    }
6.4 grep — Python
python


import re
from pathlib import Path
from typing import Generator
async def grep(
    pattern: str,
    path: str = ".",
    recursive: bool = True,
    context_lines: int = 2,
    max_matches: int = 100,
    file_pattern: str = "*",
    case_sensitive: bool = True,
) -> dict:
    """
    Recherche un pattern regex dans des fichiers.
    
    Args:
        pattern: Expression régulière à chercher
        path: Chemin de départ (relatif au workspace)
        recursive: Chercher récursivement
        context_lines: Lignes de contexte avant/après
        max_matches: Nombre max de résultats
        file_pattern: Glob pour filtrer les fichiers (ex: "*.py")
        case_sensitive: Sensibilité à la casse
    
    Returns:
        dict avec 'matches' et 'total_count'
    """
    try:
        search_path = validate_workspace_path(path)
        flags = 0 if case_sensitive else re.IGNORECASE
        compiled = re.compile(pattern, flags)
    except (re.error, ValueError) as e:
        return {"error": f"Pattern invalide: {e}"}
    
    matches = []
    
    def iter_files(base: Path) -> Generator[Path, None, None]:
        if base.is_file():
            yield base
            return
        glob_fn = base.rglob if recursive else base.glob
        yield from glob_fn(file_pattern)
    
    for file_path in iter_files(search_path):
        if not file_path.is_file():
            continue
        if file_path.stat().st_size > 2_000_000:
            continue  # Ignorer les gros fichiers binaires
        
        try:
            lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            continue
        
        for i, line in enumerate(lines):
            if compiled.search(line):
                start = max(0, i - context_lines)
                end = min(len(lines), i + context_lines + 1)
                
                matches.append({
                    "file": str(file_path.relative_to(WORKSPACE_ROOT)),
                    "line_number": i + 1,
                    "match": line.strip(),
                    "context": {
                        "before": lines[start:i],
                        "after": lines[i + 1:end],
                    },
                })
                
                if len(matches) >= max_matches:
                    return {
                        "matches": matches,
                        "total_count": len(matches),
                        "truncated": True,
                        "message": f"Résultats tronqués à {max_matches}",
                    }
    
    return {"matches": matches, "total_count": len(matches), "truncated": False}
6.5 http_request — TypeScript
typescript


import { z } from "zod";
const HttpRequestSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
  headers: z.record(z.string()).optional(),
  body: z.union([z.string(), z.record(z.unknown())]).optional(),
  timeout: z.number().min(1000).max(60_000).default(15_000),
  follow_redirects: z.boolean().default(true),
});
type HttpRequestInput = z.infer<typeof HttpRequestSchema>;
interface HttpRequestOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  content_type: string;
  elapsed_ms: number;
  error?: string;
}
// Blocklist pour éviter les requêtes vers des IP internes (SSRF)
const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254"];
export async function httpRequest(raw: HttpRequestInput): Promise<HttpRequestOutput> {
  const start = Date.now();
  
  let input: HttpRequestInput;
  try {
    input = HttpRequestSchema.parse(raw);
  } catch (e) {
    return { status: 0, statusText: "", headers: {}, body: "",
             content_type: "", elapsed_ms: 0, error: `Validation: ${e}` };
  }
  // Protection SSRF
  const hostname = new URL(input.url).hostname;
  if (BLOCKED_HOSTS.some(blocked => hostname === blocked || hostname.endsWith(`.${blocked}`))) {
    return { status: 0, statusText: "", headers: {}, body: "",
             content_type: "", elapsed_ms: 0,
             error: `Hôte bloqué (SSRF protection): ${hostname}` };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeout);
  try {
    const fetchOptions: RequestInit = {
      method: input.method,
      signal: controller.signal,
      headers: {
        "User-Agent": "AgentHTTP/1.0",
        ...(input.headers ?? {}),
        ...(input.body && typeof input.body === "object"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      redirect: input.follow_redirects ? "follow" : "manual",
    };
    if (input.body !== undefined) {
      fetchOptions.body = typeof input.body === "object"
        ? JSON.stringify(input.body)
        : input.body;
    }
    const response = await fetch(input.url, fetchOptions);
    const bodyText = await response.text();
    const elapsed = Date.now() - start;
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { respHeaders[k] = v; });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      body: bodyText.slice(0, 100_000), // Limiter à 100KB
      content_type: response.headers.get("content-type") ?? "",
      elapsed_ms: elapsed,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { status: 0, statusText: "", headers: {}, body: "",
             content_type: "", elapsed_ms: Date.now() - start,
             error: `Erreur réseau: ${msg}` };
  } finally {
    clearTimeout(timeoutId);
  }
}
6.6 memory_store & memory_retrieve — Python (avec embeddings)
python


import json
import hashlib
from datetime import datetime, timezone, timedelta
from pathlib import Path
import numpy as np
# Stockage simple fichier (remplaçable par Redis, Qdrant, pgvector, etc.)
MEMORY_PATH = Path(os.environ.get("AGENT_MEMORY_PATH", "/workspace/.agent_memory"))
MEMORY_PATH.mkdir(parents=True, exist_ok=True)
async def memory_store(
    key: str,
    value: str | dict | list,
    namespace: str = "default",
    ttl_hours: int | None = None,
) -> dict:
    """
    Stocke une valeur en mémoire persistante.
    
    Args:
        key: Identifiant unique de la mémoire
        value: Valeur à stocker (string ou structure)
        namespace: Espace de nommage pour isolation
        ttl_hours: Durée de vie en heures (None = permanent)
    
    Returns:
        Confirmation avec timestamp
    """
    ns_path = MEMORY_PATH / namespace
    ns_path.mkdir(exist_ok=True)
    
    # Sécuriser le nom de fichier
    safe_key = hashlib.sha256(key.encode()).hexdigest()[:16] + "_" + \
               re.sub(r"[^a-zA-Z0-9_-]", "_", key)[:32]
    
    entry = {
        "key": key,
        "value": value,
        "namespace": namespace,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (
            (datetime.now(timezone.utc) + timedelta(hours=ttl_hours)).isoformat()
            if ttl_hours else None
        ),
    }
    
    file_path = ns_path / f"{safe_key}.json"
    async with aiofiles.open(file_path, "w") as f:
        await f.write(json.dumps(entry, ensure_ascii=False, indent=2))
    
    return {
        "success": True,
        "key": key,
        "namespace": namespace,
        "expires_at": entry["expires_at"],
    }
async def memory_retrieve(
    key: str | None = None,
    query: str | None = None,
    namespace: str = "default",
    max_results: int = 5,
) -> dict:
    """
    Récupère des mémoires par clé exacte ou recherche sémantique.
    
    Args:
        key: Clé exacte (prioritaire si fournie)
        query: Requête de recherche textuelle (si pas de clé)
        namespace: Espace de nommage
        max_results: Nombre max de résultats (pour recherche)
    
    Returns:
        dict avec 'value' (clé exacte) ou 'results' (recherche)
    """
    ns_path = MEMORY_PATH / namespace
    if not ns_path.exists():
        return {"results": [], "count": 0}
    
    now = datetime.now(timezone.utc)
    
    # Récupération par clé exacte
    if key is not None:
        for file_path in ns_path.glob("*.json"):
            async with aiofiles.open(file_path, "r") as f:
                entry = json.loads(await f.read())
            if entry["key"] == key:
                # Vérifier expiration
                if entry["expires_at"] and \
                   datetime.fromisoformat(entry["expires_at"]) < now:
                    file_path.unlink(missing_ok=True)
                    return {"error": "Mémoire expirée", "key": key}
                return {"key": key, "value": entry["value"],
                        "created_at": entry["created_at"]}
        return {"error": "Clé introuvable", "key": key}
    
    # Recherche textuelle simple (remplacer par embeddings pour production)
    if query is not None:
        results = []
        query_lower = query.lower()
        
        for file_path in ns_path.glob("*.json"):
            try:
                async with aiofiles.open(file_path, "r") as f:
                    entry = json.loads(await f.read())
                
                if entry["expires_at"] and \
                   datetime.fromisoformat(entry["expires_at"]) < now:
                    file_path.unlink(missing_ok=True)
                    continue
                
                # Score de pertinence basique
                text = (entry["key"] + " " + str(entry["value"])).lower()
                score = sum(1 for word in query_lower.split() if word in text)
                
                if score > 0:
                    results.append({
                        "key": entry["key"],
                        "value": entry["value"],
                        "score": score,
                        "created_at": entry["created_at"],
                    })
            except Exception:
                continue
        
        results.sort(key=lambda x: x["score"], reverse=True)
        return {"query": query, "results": results[:max_results],
                "count": len(results)}
    
    return {"error": "Fournir 'key' ou 'query'"}
6.7 spawn_subagent — Python
python


from claude_agent_sdk import query, ClaudeAgentOptions
async def spawn_subagent(
    prompt: str,
    tools: list[str],
    model: str = "claude-opus-4",
    max_turns: int = 20,
    system_prompt: str | None = None,
    context: dict | None = None,
) -> dict:
    """
    Lance un sous-agent avec un prompt et un ensemble d'outils limité.
    
    Args:
        prompt: Tâche à confier au sous-agent
        tools: Liste des noms d'outils autorisés
        model: Modèle Claude à utiliser
        max_turns: Nombre max de tours dans la boucle agent
        system_prompt: Instructions système pour le sous-agent
        context: Données de contexte à passer
    
    Returns:
        dict avec 'result', 'turns_used', 'tools_called'
    """
    # Injecter le contexte dans le prompt si fourni
    full_prompt = prompt
    if context:
        context_str = json.dumps(context, ensure_ascii=False, indent=2)
        full_prompt = f"Contexte:\n```json\n{context_str}\n```\n\nTâche:\n{prompt}"
    
    available_tools = get_tools_by_names(tools)  # Votre registre de tools
    
    turns_used = 0
    tools_called = []
    result_messages = []
    
    async for message in query(
        prompt=full_prompt,
        options=ClaudeAgentOptions(
            model=model,
            max_turns=max_turns,
            system_prompt=system_prompt or "Tu es un agent spécialisé. "
                          "Accomplis la tâche de manière précise et concise.",
            tools=available_tools,
        )
    ):
        if hasattr(message, "type"):
            if message.type == "assistant":
                result_messages.append(message.content)
            elif message.type == "tool_use":
                tools_called.append(message.name)
                turns_used += 1
    
    return {
        "result": result_messages[-1] if result_messages else "",
        "turns_used": turns_used,
        "tools_called": tools_called,
        "model": model,
    }
7. Architecture Multi-Agents & MCP
7.1 Schéma d'orchestration


┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR AGENT                           │
│                                                                 │
│  Reçoit tâche complexe ──► Décompose en sous-tâches            │
│                                                                 │
│      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│      │  Agent      │  │  Agent      │  │  Agent      │        │
│      │  Research   │  │  Code       │  │  Writer     │        │
│      │  (web only) │  │  (bash+fs)  │  │  (fs only)  │        │
│      └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│             │                │                │               │
│      ┌──────▼────────────────▼────────────────▼──────┐        │
│      │              MCP SERVERS                       │        │
│      │   filesystem │ web │ database │ custom APIs    │        │
│      └────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
7.2 Intégration MCP — Serveur custom Python
python


# Serveur MCP exposant vos tools via protocole standard
from mcp.server import Server
from mcp.server.models import InitializationOptions
from mcp.types import Tool, TextContent
import mcp.server.stdio
app = Server("custom-tools-server")
@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="web_search",
            description="Recherche sur le web",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Requête de recherche"},
                    "num_results": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="file_read",
            description="Lit un fichier dans le workspace",
            inputSchema={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string"},
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                },
                "required": ["file_path"],
            },
        ),
        # ... autres tools
    ]
@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "web_search":
        result = await web_search(**arguments)
    elif name == "file_read":
        result = await file_read(**arguments)
    else:
        result = {"error": f"Tool inconnu: {name}"}
    
    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]
async def main():
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="custom-tools-server",
                server_version="1.0.0",
            ),
        )
if __name__ == "__main__":
    asyncio.run(main())
8. Checklist de Déploiement
Avant la mise en production
Sécurité
 Tous les tools valident leurs inputs avec Pydantic (Python) ou Zod (TS)
 Protection path traversal sur tous les tools fichier
 Protection SSRF sur tous les tools réseau
 Secrets isolés dans des variables d'environnement ou un vault
 Sandbox activé pour les exécutions bash/shell
 Timeout défini sur tous les tools I/O
 Rate limiting activé par outil et par session
Hooks
 PreToolUse : audit logging sur tous les outils
 PreToolUse : protection des fichiers sensibles (.env, *.key, *.pem)
 PreToolUse : approbation humaine pour les actions destructrices
 PostToolUse : sanitization des sorties (masquage tokens/clés)
 OnSubagentSpawn : limite de profondeur et de nombre
 OnError : alerting et logging structuré
Contrôles UI
 Boutons Start / Pause / Resume / Stop / Abort opérationnels
 File d'approbation humaine avec Approve / Reject / Modify / Escalate
 Affichage temps réel des outils appelés
 Compteur de tokens et coût estimé
 Système de checkpoint et rollback
Observabilité
 Logs structurés JSON pour chaque appel d'outil
 Traces distribuées (OpenTelemetry recommandé)
 Métriques Prometheus : latence, erreurs, token usage
 Alertes sur dépassement de seuils (coût, durée, erreurs)
Performance
 Taille des contextes vérifiée (fenêtre 1M tokens Claude Opus 4)
 Résultats des tools tronqués à des tailles raisonnables
 Connexions HTTP poolées (httpx.AsyncClient réutilisé)
 Memory store avec TTL pour éviter l'accumulation
Références

platform.claude.com
 — Documentation officielle Hooks

claudelab.net
 — Claude Agent SDK Guide 2026

blog.artisandev.fr
 — Architecture Agent SDK