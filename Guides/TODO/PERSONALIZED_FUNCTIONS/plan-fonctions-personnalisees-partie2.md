# PARTIE 2 — Fonctions Natives par Défaut
## Implémentation Python Backend · 11 Fonctions Natives

> **Suite de** : Plan — Fonctions Personnalisées pour Agents IA (Partie 1)  
> **Destinataires** : Agent Architecte + Agents Développeurs  
> **Stack** : Python 3.12 (backend) · Node.js (orchestration) · MongoDB (existant) · Docker Compose (existant)  
> **Périmètre** : Architecture fichiers, implémentation des 11 fonctions natives, multi-utilisateur, sécurité, intégration  
> **Version** : 1.0 — Mars 2026

---

## Table des Matières — Partie 2

- [P2.1 Analyse Préalable & Décisions d'Architecture](#p21-analyse-préalable--décisions-darchitecture)
- [P2.2 Arborescence Complète du Backend](#p22-arborescence-complète-du-backend)
- [P2.3 Infrastructure Partagée (Base Layer)](#p23-infrastructure-partagée-base-layer)
- [P2.4 Intégration Docker Compose](#p24-intégration-docker-compose)
- [P2.5 Fonctions Natives — Implémentation Détaillée](#p25-fonctions-natives--implémentation-détaillée)
  - [F01 — agent_py : Lancement de Sous-Agent](#f01--agent_py--lancement-de-sous-agent)
  - [F02 — bash_py : Exécution Shell / PowerShell](#f02--bash_py--exécution-shell--powershell)
  - [F03 — edit_py : Édition de Fichier](#f03--edit_py--édition-de-fichier)
  - [F04 — ls_py : Listage de Répertoire](#f04--ls_py--listage-de-répertoire)
  - [F05 — multi_edit_py : Éditions Multiples](#f05--multi_edit_py--éditions-multiples)
  - [F06 — read_py : Lecture de Fichier](#f06--read_py--lecture-de-fichier)
  - [F07 — todo_read_py : Lecture TodoList](#f07--todo_read_py--lecture-todolist)
  - [F08 — todo_write_py : Écriture TodoList](#f08--todo_write_py--écriture-todolist)
  - [F09 — web_fetch_py : Récupération Page Web](#f09--web_fetch_py--récupération-page-web)
  - [F10 — web_search_py : Recherche Web](#f10--web_search_py--recherche-web)
  - [F11 — write_py : Création et Écriture de Fichier](#f11--write_py--création-et-écriture-de-fichier)
- [P2.6 Registre & Seed des Fonctions Natives](#p26-registre--seed-des-fonctions-natives)
- [P2.7 Système de Fichiers Multi-Utilisateur](#p27-système-de-fichiers-multi-utilisateur)
- [P2.8 Sécurité Spécifique aux Fonctions Natives](#p28-sécurité-spécifique-aux-fonctions-natives)
- [P2.9 Tests des Fonctions Natives](#p29-tests-des-fonctions-natives)
- [P2.10 Roadmap d'Implémentation Partie 2](#p210-roadmap-dimplémentation-partie-2)

---

## P2.1 Analyse Préalable & Décisions d'Architecture

### P2.1.1 Analyse des 11 Fonctions par Domaine

Avant de coder, regrouper les fonctions par domaine fonctionnel permet d'identifier les couches partagées à construire une seule fois :

| Fonction | Domaine | Dépendances clés | Risque sécurité |
|---|---|---|---|
| `agent_py` | Orchestration | AgentService interne, LLM API | Moyen (appels récursifs) |
| `bash_py` | Système | OS detection, subprocess | **ÉLEVÉ** (exécution arbitraire) |
| `edit_py` | Filesystem | Workspace utilisateur | Moyen (écriture fichier) |
| `ls_py` | Filesystem | Workspace utilisateur | Faible |
| `multi_edit_py` | Filesystem | edit_py (composition) | Moyen |
| `read_py` | Filesystem | Workspace utilisateur | Faible |
| `todo_read_py` | Données | MongoDB, modèle Todo | Faible |
| `todo_write_py` | Données | MongoDB, modèle Todo | Faible |
| `web_fetch_py` | Réseau | httpx, HTML parser | Moyen (SSRF) |
| `web_search_py` | Réseau | API Search externe | Faible |
| `write_py` | Filesystem | Workspace utilisateur | Moyen (création fichier) |

**3 couches partagées à construire :**

```
1. WorkspaceManager    → gestion du filesystem multi-utilisateur sécurisé
2. SecurityGuard       → validation des chemins, rate limiting, permissions
3. DatabaseLayer       → accès MongoDB (Todo) et registre des fonctions
```

### P2.1.2 Décision — Workspace Utilisateur

Chaque utilisateur dispose d'un **workspace isolé** sur le filesystem du backend :

```
{WORKSPACE_ROOT}/
  users/
    {userId}/
      workspace/         ← Répertoire de travail de l'agent (read/write)
        projects/        ← Projets de l'utilisateur
        uploads/         ← Fichiers uploadés
        outputs/         ← Fichiers générés par les agents
      todos/             ← Stockage JSON des todos (persistance légère)
      functions/         ← Fonctions custom de l'utilisateur (code Python/TS)
  native/                ← Fonctions natives (READ-ONLY, partagées)
    agent_py/
    bash_py/
    ...
```

**Règle de sécurité fondamentale** : toute fonction filesystem valide que le chemin cible est bien **à l'intérieur** du workspace de l'utilisateur (`path.startswith(user_workspace)`). Aucun accès au-delà n'est permis.

### P2.1.3 Décision — `bash_py` : Containérisation Obligatoire

`bash_py` est la seule fonction qui exécute du code shell arbitraire. Elle **ne peut pas** tourner dans le processus principal Python. Elle sera toujours exécutée dans un **container Docker dédié** (le sandbox défini en Partie 1), avec les contraintes suivantes :
- Accès filesystem : uniquement `/workspace/{userId}/` monté en lecture/écriture
- Réseau : aucun (sauf si la commande est whitelistée)
- Timeout : 30 secondes max
- Commandes interdites : liste noire statique

### P2.1.4 Décision — `agent_py` : Prévention des Boucles Infinies

`agent_py` permet à un agent de lancer un sous-agent. Pour éviter la récursion infinie :
- **Profondeur max** : 3 niveaux d'imbrication
- **Budget tokens** : chaque sous-agent hérite d'un budget décroissant
- **Circuit breaker** : si le sous-agent échoue 3 fois, l'erreur remonte

### P2.1.5 Décision — MongoDB vs Fichiers pour les Todos

Les `Todo` sont stockés en **MongoDB** (cohérent avec le reste de l'application) dans une collection `todos`, avec un index `userId + agentId`. Un cache Redis TTL 60s est utilisé pour les lectures fréquentes.

---

## P2.2 Arborescence Complète du Backend

```
backend/
├── docker-compose.yml                    ← MODIFIER : ajouter service sandbox
├── Dockerfile.sandbox-python             ← CRÉER
│
├── src/                                  ← Code Node.js/TypeScript existant
│   ├── functions/
│   │   ├── function.controller.ts        ← (Partie 1)
│   │   ├── function.service.ts           ← (Partie 1)
│   │   ├── function.schemas.ts
│   │   └── sandbox/
│   │       └── sandbox.service.ts        ← (Partie 1)
│   └── ...
│
└── python/                               ← CRÉER (nouveau répertoire Python)
    │
    ├── requirements.txt                  ← Dépendances Python globales
    ├── requirements-sandbox.txt          ← Dépendances sandbox (subset)
    │
    ├── app/                              ← Package principal
    │   ├── __init__.py
    │   │
    │   ├── core/                         ← Infrastructure partagée
    │   │   ├── __init__.py
    │   │   ├── context.py                ← FunctionContext + FunctionResult
    │   │   ├── workspace.py              ← WorkspaceManager (filesystem multi-user)
    │   │   ├── security.py               ← SecurityGuard (validation chemins, perms)
    │   │   ├── database.py               ← Connexion MongoDB (moteur PyMongo/Motor)
    │   │   ├── models/
    │   │   │   ├── __init__.py
    │   │   │   ├── todo.py               ← Modèle Todo (Pydantic v2)
    │   │   │   └── function_result.py    ← Modèle FunctionResult
    │   │   └── exceptions.py             ← Exceptions métier
    │   │
    │   ├── native/                       ← 11 fonctions natives
    │   │   ├── __init__.py
    │   │   ├── registry.py               ← NativeFunctionRegistry + seed MongoDB
    │   │   │
    │   │   ├── agent/
    │   │   │   ├── __init__.py
    │   │   │   ├── agent_py.py           ← F01 — Lancement sous-agent
    │   │   │   ├── schema_input.json     ← JSON Schema entrée
    │   │   │   ├── schema_output.json    ← JSON Schema sortie
    │   │   │   └── SKILL.md              ← Documentation LLM
    │   │   │
    │   │   ├── bash/
    │   │   │   ├── __init__.py
    │   │   │   ├── bash_py.py            ← F02 — Shell / PowerShell
    │   │   │   ├── command_validator.py  ← Validation + blacklist commandes
    │   │   │   ├── schema_input.json
    │   │   │   ├── schema_output.json
    │   │   │   └── SKILL.md
    │   │   │
    │   │   ├── filesystem/               ← F03, F04, F05, F06, F11 groupés
    │   │   │   ├── __init__.py
    │   │   │   ├── edit_py.py            ← F03 — Édition fichier
    │   │   │   ├── ls_py.py              ← F04 — Listage répertoire
    │   │   │   ├── multi_edit_py.py      ← F05 — Éditions multiples
    │   │   │   ├── read_py.py            ← F06 — Lecture fichier
    │   │   │   ├── write_py.py           ← F11 — Création/écriture fichier
    │   │   │   ├── schema_edit_input.json
    │   │   │   ├── schema_edit_output.json
    │   │   │   ├── schema_ls_input.json
    │   │   │   ├── schema_ls_output.json
    │   │   │   ├── schema_multi_edit_input.json
    │   │   │   ├── schema_read_input.json
    │   │   │   ├── schema_read_output.json
    │   │   │   ├── schema_write_input.json
    │   │   │   └── SKILL.md
    │   │   │
    │   │   ├── todo/
    │   │   │   ├── __init__.py
    │   │   │   ├── todo_read_py.py       ← F07 — Lecture Todo
    │   │   │   ├── todo_write_py.py      ← F08 — Écriture Todo
    │   │   │   ├── schema_todo_read_input.json
    │   │   │   ├── schema_todo_read_output.json
    │   │   │   ├── schema_todo_write_input.json
    │   │   │   ├── schema_todo_write_output.json
    │   │   │   └── SKILL.md
    │   │   │
    │   │   └── web/
    │   │       ├── __init__.py
    │   │       ├── web_fetch_py.py       ← F09 — Récupération page web
    │   │       ├── web_search_py.py      ← F10 — Recherche web
    │   │       ├── schema_fetch_input.json
    │   │       ├── schema_fetch_output.json
    │   │       ├── schema_search_input.json
    │   │       ├── schema_search_output.json
    │   │       └── SKILL.md
    │   │
    │   ├── runner.py                     ← Point d'entrée subprocess (Partie 1)
    │   └── api.py                        ← FastAPI sidecar (Partie 1)
    │
    ├── users/                            ← Workspaces utilisateurs (RUNTIME, gitignored)
    │   └── {userId}/
    │       ├── workspace/
    │       │   ├── projects/
    │       │   ├── uploads/
    │       │   └── outputs/
    │       ├── todos/                    ← Cache JSON local (backup MongoDB)
    │       └── functions/               ← Fonctions custom de l'utilisateur
    │           ├── my_function_py.py
    │           └── ...
    │
    └── tests/
        ├── __init__.py
        ├── conftest.py
        ├── test_workspace.py
        ├── test_security.py
        ├── native/
        │   ├── test_agent_py.py
        │   ├── test_bash_py.py
        │   ├── test_filesystem.py
        │   ├── test_todo.py
        │   └── test_web.py
        └── fixtures/
            ├── sample_files/
            └── mock_responses/
```

---

## P2.3 Infrastructure Partagée (Base Layer)

### P2.3.1 FunctionContext & FunctionResult (core/context.py)

```python
# backend/python/app/core/context.py
"""
Contexte d'exécution injecté dans chaque fonction native ou custom.
Fournit les services essentiels sans exposer les internals.
"""

from __future__ import annotations
import os
import logging
from dataclasses import dataclass, field
from typing import Any, Optional
from pathlib import Path
import httpx


@dataclass
class FunctionContext:
    """
    Injecté par le runner à chaque appel de fonction.
    
    Attributs accessibles dans une fonction :
        - logger    : logging structuré
        - http      : client HTTP async (httpx)
        - workspace : chemin absolu du workspace de l'utilisateur
        - user_id   : identifiant de l'utilisateur courant
        - agent_id  : identifiant de l'agent appelant
        - depth     : profondeur d'imbrication agent (0 = agent racine)
        - is_sandbox: True si exécution en mode test (console)
    """
    user_id:    str
    agent_id:   str
    workspace:  Path
    logger:     logging.Logger     = field(default_factory=lambda: logging.getLogger("fn"))
    http:       Optional[httpx.AsyncClient] = None
    depth:      int                = 0          # Profondeur récursion agents
    is_sandbox: bool               = False
    job_id:     str                = ""
    token_budget: int              = 50_000     # Budget tokens pour sous-agents

    def __post_init__(self):
        if self.http is None:
            self.http = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
                follow_redirects=True,
                headers={"User-Agent": "AppAgent/1.0"},
                limits=httpx.Limits(max_connections=10)
            )
        # Garantir que workspace est un Path absolu résolu
        self.workspace = Path(self.workspace).resolve()

    @classmethod
    def from_env(cls) -> "FunctionContext":
        """Construit le contexte depuis les variables d'environnement (mode subprocess)."""
        workspace_root = os.environ.get("WORKSPACE_ROOT", "/app/users")
        user_id = os.environ["USER_ID"]
        return cls(
            user_id=user_id,
            agent_id=os.environ.get("AGENT_ID", ""),
            workspace=Path(workspace_root) / user_id / "workspace",
            depth=int(os.environ.get("AGENT_DEPTH", "0")),
            is_sandbox=os.environ.get("SANDBOX", "false").lower() == "true",
            job_id=os.environ.get("JOB_ID", ""),
            token_budget=int(os.environ.get("TOKEN_BUDGET", "50000")),
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        if self.http:
            await self.http.aclose()


@dataclass
class FunctionResult:
    """
    Retour standardisé pour toutes les fonctions natives et custom.
    
    Toujours sérialiser via .to_dict() avant de retourner au runner.
    """
    success:  bool
    data:     Any                  = None
    error:    Optional[str]        = None
    error_code: Optional[str]      = None   # ex: "PATH_OUTSIDE_WORKSPACE"
    meta:     dict[str, Any]       = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "success":    self.success,
            "data":       self.data,
            "error":      self.error,
            "error_code": self.error_code,
            "meta":       self.meta,
        }

    @classmethod
    def ok(cls, data: Any, **meta) -> "FunctionResult":
        return cls(success=True, data=data, meta=meta)

    @classmethod
    def fail(cls, error: str, code: str = "EXECUTION_ERROR", **meta) -> "FunctionResult":
        return cls(success=False, error=error, error_code=code, meta=meta)
```

### P2.3.2 WorkspaceManager (core/workspace.py)

```python
# backend/python/app/core/workspace.py
"""
Gestionnaire du filesystem multi-utilisateur.
Toutes les opérations filesystem des fonctions natives passent par ce module.
"""

from __future__ import annotations
import os
import shutil
from pathlib import Path
from typing import Optional

from .exceptions import WorkspaceSecurityError, WorkspaceNotFoundError


class WorkspaceManager:
    """
    Point d'entrée unique pour toutes les opérations filesystem.
    Garantit que chaque opération reste dans le workspace de l'utilisateur.
    """

    def __init__(self, workspace_root: str | Path):
        self.root = Path(workspace_root).resolve()

    def get_user_workspace(self, user_id: str) -> Path:
        """Retourne le chemin absolu du workspace d'un utilisateur, crée si nécessaire."""
        ws = (self.root / user_id / "workspace").resolve()
        ws.mkdir(parents=True, exist_ok=True)
        return ws

    def get_user_functions_dir(self, user_id: str) -> Path:
        """Répertoire des fonctions custom de l'utilisateur."""
        d = (self.root / user_id / "functions").resolve()
        d.mkdir(parents=True, exist_ok=True)
        return d

    def get_user_todos_dir(self, user_id: str) -> Path:
        """Répertoire de stockage local des todos."""
        d = (self.root / user_id / "todos").resolve()
        d.mkdir(parents=True, exist_ok=True)
        return d

    def resolve_path(self, user_id: str, relative_path: str) -> Path:
        """
        Résout un chemin relatif (fourni par l'agent) en chemin absolu sécurisé.
        
        Lève WorkspaceSecurityError si le chemin sort du workspace.
        """
        workspace = self.get_user_workspace(user_id)

        # Résolution : on joint workspace + chemin fourni, puis on résout les ..
        if os.path.isabs(relative_path):
            # Si l'agent envoie un chemin absolu, on prend uniquement la partie relative
            # ex: /etc/passwd → on ignore le / et on traite comme "etc/passwd"
            candidate = (workspace / Path(relative_path).relative_to("/")).resolve()
        else:
            candidate = (workspace / relative_path).resolve()

        # Vérification de confinement strict
        try:
            candidate.relative_to(workspace)
        except ValueError:
            raise WorkspaceSecurityError(
                f"Chemin interdit : '{relative_path}' sort du workspace utilisateur. "
                f"Workspace autorisé : {workspace}"
            )

        return candidate

    def ensure_parent_exists(self, path: Path) -> None:
        """Crée les répertoires parents si nécessaire."""
        path.parent.mkdir(parents=True, exist_ok=True)

    def get_file_info(self, path: Path) -> dict:
        """Métadonnées d'un fichier/répertoire."""
        stat = path.stat()
        return {
            "name":       path.name,
            "path":       str(path),
            "type":       "directory" if path.is_dir() else "file",
            "size":       stat.st_size,
            "modified":   stat.st_mtime,
            "extension":  path.suffix.lower() if path.is_file() else None,
        }
```

### P2.3.3 SecurityGuard (core/security.py)

```python
# backend/python/app/core/security.py
"""
Couche de sécurité transversale pour les fonctions natives.
"""

from __future__ import annotations
import re
import time
from collections import defaultdict
from typing import Optional
from urllib.parse import urlparse

from .exceptions import (
    RateLimitError, CommandForbiddenError,
    URLForbiddenError, FileSizeLimitError
)


# ─── Rate Limiter simple en mémoire (Redis en production si multiprocess) ───

class RateLimiter:
    def __init__(self):
        self._calls: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, max_calls: int, window_seconds: int = 60) -> None:
        now = time.time()
        calls = self._calls[key]
        # Purge des appels hors fenêtre
        self._calls[key] = [t for t in calls if now - t < window_seconds]
        if len(self._calls[key]) >= max_calls:
            raise RateLimitError(
                f"Rate limit dépassé pour '{key}' : "
                f"{max_calls} appels/{window_seconds}s"
            )
        self._calls[key].append(now)


_rate_limiter = RateLimiter()


# ─── Validation des commandes shell ─────────────────────────────────────────

# Commandes shell strictement interdites, quelle que soit la plateforme
FORBIDDEN_COMMANDS: set[str] = {
    "rm -rf /", "rm -rf ~", "mkfs", "dd if=/dev/zero",
    ":(){ :|:& };:", "fork bomb",
    "chmod 777 /", "chown", "sudo", "su -",
    "wget -O- | bash", "curl | bash", "curl | sh",
    "> /dev/sda", "shred",
}

FORBIDDEN_PATTERNS: list[re.Pattern] = [
    re.compile(r"rm\s+-rf\s+/"),
    re.compile(r";\s*rm\s"),
    re.compile(r"\|\s*(bash|sh|zsh|fish)\s*$"),
    re.compile(r">\s*/dev/(sd|hd|null\s*&&)"),
    re.compile(r"curl.*\|\s*(bash|sh)"),
    re.compile(r"wget.*\|\s*(bash|sh)"),
    re.compile(r"python[23]?\s+-c\s+['\"]import\s+os"),
    re.compile(r"__import__"),
    re.compile(r"eval\s*\("),
]


def validate_shell_command(command: str) -> None:
    """Lève CommandForbiddenError si la commande est interdite."""
    cmd_lower = command.lower().strip()

    for forbidden in FORBIDDEN_COMMANDS:
        if forbidden in cmd_lower:
            raise CommandForbiddenError(f"Commande interdite : '{forbidden}'")

    for pattern in FORBIDDEN_PATTERNS:
        if pattern.search(command):
            raise CommandForbiddenError(
                f"Pattern interdit détecté dans la commande"
            )


# ─── Validation des URLs ─────────────────────────────────────────────────────

FORBIDDEN_URL_SCHEMES = {"file", "ftp", "sftp", "data", "javascript"}
FORBIDDEN_URL_HOSTS = {
    "169.254.169.254",  # AWS/GCP metadata
    "metadata.google.internal",
    "169.254.170.2",    # ECS metadata
}
PRIVATE_IP_PATTERNS = [
    re.compile(r"^10\."),
    re.compile(r"^172\.(1[6-9]|2[0-9]|3[01])\."),
    re.compile(r"^192\.168\."),
    re.compile(r"^127\."),
    re.compile(r"^::1$"),
    re.compile(r"^localhost$", re.IGNORECASE),
]


def validate_url(url: str) -> None:
    """Valide une URL pour web_fetch / web_search. Prévient le SSRF."""
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise URLForbiddenError(f"Schéma interdit : '{parsed.scheme}'")

    host = parsed.hostname or ""

    if host in FORBIDDEN_URL_HOSTS:
        raise URLForbiddenError(f"Hôte interdit (metadata service) : '{host}'")

    for pattern in PRIVATE_IP_PATTERNS:
        if pattern.match(host):
            raise URLForbiddenError(
                f"Accès aux IPs privées interdit (prévention SSRF) : '{host}'"
            )


# ─── Limites fichiers ────────────────────────────────────────────────────────

MAX_READ_SIZE_BYTES  = 10 * 1024 * 1024   # 10 MB
MAX_WRITE_SIZE_BYTES = 50 * 1024 * 1024   # 50 MB
MAX_LS_DEPTH         = 5


def check_file_size(size_bytes: int, operation: str = "read") -> None:
    limit = MAX_READ_SIZE_BYTES if operation == "read" else MAX_WRITE_SIZE_BYTES
    if size_bytes > limit:
        raise FileSizeLimitError(
            f"Fichier trop volumineux pour {operation} : "
            f"{size_bytes / 1024 / 1024:.1f} MB (max: {limit / 1024 / 1024:.0f} MB)"
        )
```

### P2.3.4 Exceptions métier (core/exceptions.py)

```python
# backend/python/app/core/exceptions.py

class FunctionError(Exception):
    """Base de toutes les erreurs de fonctions."""
    code: str = "FUNCTION_ERROR"

class WorkspaceSecurityError(FunctionError):
    code = "PATH_OUTSIDE_WORKSPACE"

class WorkspaceNotFoundError(FunctionError):
    code = "WORKSPACE_NOT_FOUND"

class RateLimitError(FunctionError):
    code = "RATE_LIMIT_EXCEEDED"

class CommandForbiddenError(FunctionError):
    code = "COMMAND_FORBIDDEN"

class URLForbiddenError(FunctionError):
    code = "URL_FORBIDDEN"

class FileSizeLimitError(FunctionError):
    code = "FILE_SIZE_LIMIT"

class AgentDepthLimitError(FunctionError):
    code = "AGENT_DEPTH_LIMIT"

class TodoNotFoundError(FunctionError):
    code = "TODO_NOT_FOUND"
```

### P2.3.5 Modèles Pydantic (core/models/todo.py)

```python
# backend/python/app/core/models/todo.py

from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
from bson import ObjectId


class TodoStatus(str, Enum):
    pending    = "pending"
    in_progress = "in_progress"
    done       = "done"
    cancelled  = "cancelled"


class TodoPriority(str, Enum):
    low    = "low"
    medium = "medium"
    high   = "high"


class TodoItem(BaseModel):
    id:          str              = Field(default_factory=lambda: str(ObjectId()))
    title:       str
    description: Optional[str]   = None
    status:      TodoStatus       = TodoStatus.pending
    priority:    TodoPriority     = TodoPriority.medium
    tags:        list[str]        = Field(default_factory=list)
    due_date:    Optional[datetime] = None
    created_at:  datetime         = Field(default_factory=datetime.utcnow)
    updated_at:  datetime         = Field(default_factory=datetime.utcnow)
    agent_id:    Optional[str]    = None   # Agent qui a créé le todo


class TodoList(BaseModel):
    user_id:    str
    agent_id:   Optional[str]  = None
    items:      list[TodoItem] = Field(default_factory=list)
    created_at: datetime       = Field(default_factory=datetime.utcnow)
    updated_at: datetime       = Field(default_factory=datetime.utcnow)
```

---

## P2.4 Intégration Docker Compose

### P2.4.1 Modifications docker-compose.yml

Ajouter le service sandbox Python au docker-compose **existant** (qui contient déjà MongoDB) :

```yaml
# Ajout dans le docker-compose.yml existant
# NE PAS modifier les services existants (mongodb, backend, frontend)

services:
  # ... services existants inchangés ...

  # ─── NOUVEAU : Python Sidecar (API FastAPI pour fonctions natives) ───────
  python-sidecar:
    build:
      context: ./backend/python
      dockerfile: ../../Dockerfile.python-sidecar
    container_name: app-python-sidecar
    restart: unless-stopped
    environment:
      - WORKSPACE_ROOT=/app/users
      - MONGODB_URL=mongodb://mongodb:27017/app
      - LOG_LEVEL=info
      - MAX_AGENT_DEPTH=3
      - SEARCH_API_KEY=${SEARCH_API_KEY}
      - SEARCH_ENGINE=${SEARCH_ENGINE:-searxng}
    volumes:
      - user_workspaces:/app/users           # Workspaces utilisateurs (persistant)
      - ./backend/python/app:/app/app:ro     # Code source (lecture seule en prod)
    networks:
      - app-network
    depends_on:
      - mongodb
    ports:
      - "8001:8001"                          # Accessible uniquement depuis le backend Node
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ─── NOUVEAU : Sandbox Docker-in-Docker pour bash_py ────────────────────
  sandbox-runner:
    build:
      context: ./backend
      dockerfile: Dockerfile.sandbox-python
    container_name: app-sandbox-runner
    restart: unless-stopped
    environment:
      - SANDBOX=true
      - MAX_EXECUTION_TIME=30
    volumes:
      - user_workspaces:/app/users           # Même volume que sidecar
      - /var/run/docker.sock:/var/run/docker.sock  # Docker-in-Docker pour bash_py
    networks:
      - sandbox-net                          # Réseau isolé pour le sandbox
    security_opt:
      - no-new-privileges:true

volumes:
  user_workspaces:                           # Volume persistant pour tous les workspaces
    driver: local

networks:
  app-network:
    driver: bridge
  sandbox-net:                               # Réseau isolé pour les sandboxes bash
    driver: bridge
    internal: true                           # Pas d'accès internet depuis sandbox-net
```

### P2.4.2 Dockerfile Python Sidecar

```dockerfile
# backend/python/Dockerfile.python-sidecar
FROM python:3.12-slim

# Sécurité : utilisateur non-root
RUN useradd -m -u 1000 -s /bin/bash appuser

WORKDIR /app

# Dépendances système minimales
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code source
COPY app/ ./app/

# Répertoire workspaces (monté comme volume en runtime)
RUN mkdir -p /app/users && chown appuser:appuser /app/users

USER appuser

EXPOSE 8001

CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
```

### P2.4.3 requirements.txt

```
# backend/python/requirements.txt

# API Framework
fastapi==0.115.*
uvicorn[standard]==0.32.*
pydantic==2.*
pydantic-settings==2.*

# HTTP Client
httpx==0.28.*

# MongoDB
motor==3.*          # AsyncIO MongoDB driver
pymongo==4.*

# HTML Parsing (web_fetch)
beautifulsoup4==4.*
lxml==5.*

# Markdown / Text conversion
markdownify==0.*    # HTML → Markdown pour web_fetch

# Sécurité
python-multipart==0.*

# Utils
python-dateutil==2.*
aiofiles==24.*      # I/O fichiers async

# Tests
pytest==8.*
pytest-asyncio==0.24.*
pytest-mock==3.*
httpx                # Déjà inclus, pour TestClient FastAPI
```

---

## P2.5 Fonctions Natives — Implémentation Détaillée

---

### F01 — `agent_py` : Lancement de Sous-Agent

**Objectif** : Permettre à un agent de déléguer une sous-tâche à un autre agent configuré dans l'application, avec transmission du contexte et récupération du résultat.

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["task"],
  "properties": {
    "task": {
      "type": "string",
      "description": "Description précise de la tâche à confier au sous-agent"
    },
    "agent_id": {
      "type": "string",
      "description": "ID d'un agent spécifique à utiliser. Si omis, l'orchestrateur choisit le plus adapté."
    },
    "context": {
      "type": "object",
      "description": "Données contextuelles supplémentaires à transmettre au sous-agent",
      "additionalProperties": true
    },
    "max_tokens": {
      "type": "integer",
      "default": 4096,
      "minimum": 256,
      "maximum": 32000,
      "description": "Budget tokens maximum pour le sous-agent"
    },
    "await_result": {
      "type": "boolean",
      "default": true,
      "description": "Attendre le résultat (synchrone) ou lancer en arrière-plan"
    }
  }
}
```

**JSON Schema Sortie** :

```json
{
  "type": "object",
  "properties": {
    "result":        { "type": "string",  "description": "Réponse finale du sous-agent" },
    "agent_id":      { "type": "string",  "description": "ID de l'agent qui a traité la tâche" },
    "tokens_used":   { "type": "integer" },
    "duration_ms":   { "type": "integer" },
    "job_id":        { "type": "string",  "description": "ID du job si await_result=false" }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/agent/agent_py.py

from __future__ import annotations
import asyncio
import time
import httpx
from typing import Any

from app.core.context import FunctionContext, FunctionResult
from app.core.exceptions import AgentDepthLimitError

MAX_AGENT_DEPTH = 3


async def agent_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Lance un sous-agent pour traiter une tâche déléguée.
    
    Prévention boucle infinie : max 3 niveaux d'imbrication.
    Le sous-agent hérite d'un budget tokens réduit.
    """
    # ─── Vérification profondeur de récursion ───────────────────────────────
    if context.depth >= MAX_AGENT_DEPTH:
        raise AgentDepthLimitError(
            f"Profondeur maximale d'imbrication atteinte ({MAX_AGENT_DEPTH}). "
            "Impossible de lancer un nouveau sous-agent."
        )

    task         = params["task"]
    agent_id     = params.get("agent_id")
    extra_ctx    = params.get("context", {})
    max_tokens   = min(params.get("max_tokens", 4096), context.token_budget // 2)
    await_result = params.get("await_result", True)

    # ─── Appel au backend Node.js (AgentExecutionService) via HTTP interne ──
    # Le sidecar Python appelle l'API Node.js qui gère l'orchestration des agents
    node_api_url = "http://backend:3000/api/internal/agents/run"
    
    payload = {
        "task":         task,
        "agent_id":     agent_id,
        "context":      {
            **extra_ctx,
            "parent_agent_id": context.agent_id,
            "depth":           context.depth + 1,
        },
        "user_id":      context.user_id,
        "max_tokens":   max_tokens,
        "await_result": await_result,
    }

    start = time.time()
    
    try:
        response = await context.http.post(
            node_api_url,
            json=payload,
            timeout=120.0  # Les agents peuvent prendre du temps
        )
        response.raise_for_status()
        result_data = response.json()
        
        duration_ms = int((time.time() - start) * 1000)
        context.logger.info(
            f"Sous-agent terminé",
            extra={
                "agent_id":    result_data.get("agent_id"),
                "duration_ms": duration_ms,
                "tokens":      result_data.get("tokens_used", 0)
            }
        )

        return FunctionResult.ok(
            data={
                "result":      result_data.get("result", ""),
                "agent_id":    result_data.get("agent_id"),
                "tokens_used": result_data.get("tokens_used", 0),
                "duration_ms": duration_ms,
                "job_id":      result_data.get("job_id"),
            }
        )

    except httpx.HTTPStatusError as e:
        return FunctionResult.fail(
            f"Erreur du sous-agent : {e.response.status_code} — {e.response.text}",
            code="AGENT_EXECUTION_ERROR"
        )
    except httpx.TimeoutException:
        return FunctionResult.fail(
            "Le sous-agent n'a pas répondu dans les 120 secondes.",
            code="AGENT_TIMEOUT"
        )
```

---

### F02 — `bash_py` : Exécution Shell / PowerShell

**Objectif** : Exécuter une commande shell dans l'environnement de l'utilisateur. Détecte automatiquement l'OS (Linux/Windows) et adapte le shell. Exécution toujours dans un container Docker isolé.

> ⚠️ **Fonction à haut risque sécurité** — exécution obligatoire via le sandbox Docker défini en Partie 1. Ne jamais exécuter dans le processus principal.

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["command"],
  "properties": {
    "command": {
      "type": "string",
      "description": "Commande shell à exécuter"
    },
    "working_directory": {
      "type": "string",
      "description": "Répertoire de travail relatif au workspace (défaut: racine workspace)"
    },
    "timeout_seconds": {
      "type": "integer",
      "default": 30,
      "minimum": 1,
      "maximum": 120,
      "description": "Timeout en secondes"
    },
    "environment": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Variables d'environnement supplémentaires"
    }
  }
}
```

**JSON Schema Sortie** :

```json
{
  "type": "object",
  "properties": {
    "stdout":      { "type": "string" },
    "stderr":      { "type": "string" },
    "exit_code":   { "type": "integer" },
    "duration_ms": { "type": "integer" },
    "shell_used":  { "type": "string", "description": "bash / sh / powershell / cmd" },
    "os_detected": { "type": "string", "description": "linux / windows / macos" }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/bash/bash_py.py

from __future__ import annotations
import asyncio
import os
import platform
import sys
import time
from pathlib import Path
from typing import Any

from app.core.context import FunctionContext, FunctionResult
from app.core.security import validate_shell_command
from app.core.workspace import WorkspaceManager


def _detect_os() -> tuple[str, list[str]]:
    """
    Détecte l'OS et retourne (os_name, shell_command_prefix).
    
    Returns:
        ("linux",   ["bash", "-c"])
        ("macos",   ["bash", "-c"])
        ("windows", ["powershell", "-NoProfile", "-NonInteractive", "-Command"])
    """
    system = platform.system().lower()
    if system == "windows":
        return "windows", ["powershell", "-NoProfile", "-NonInteractive", "-Command"]
    elif system == "darwin":
        return "macos", ["bash", "-c"]
    else:
        # Linux ou conteneur : préférer bash, fallback sh
        shell = "/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"
        shell_name = "bash" if "bash" in shell else "sh"
        return "linux", [shell, "-c"]


async def bash_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Exécute une commande shell dans le workspace de l'utilisateur.
    
    Sécurité :
    - Validation statique de la commande (blacklist)
    - Exécution confinée au workspace utilisateur
    - Timeout strict
    - Variables d'environnement sanitisées
    """
    command         = params["command"]
    rel_workdir     = params.get("working_directory", "")
    timeout_seconds = min(params.get("timeout_seconds", 30), 120)
    extra_env       = params.get("environment", {})

    # ─── Validation de la commande ──────────────────────────────────────────
    validate_shell_command(command)   # Lève CommandForbiddenError si interdit

    # ─── Résolution du répertoire de travail ────────────────────────────────
    workspace_mgr = WorkspaceManager(context.workspace.parent.parent)
    
    if rel_workdir:
        workdir = workspace_mgr.resolve_path(context.user_id, rel_workdir)
    else:
        workdir = context.workspace

    if not workdir.exists():
        return FunctionResult.fail(
            f"Répertoire de travail introuvable : '{rel_workdir}'",
            code="DIRECTORY_NOT_FOUND"
        )

    # ─── Détection OS et shell ──────────────────────────────────────────────
    os_name, shell_cmd = _detect_os()

    # ─── Environnement sécurisé ─────────────────────────────────────────────
    # On repart d'un env minimal, on n'expose pas les secrets du backend
    safe_env = {
        "HOME":          str(context.workspace),
        "USER":          f"user_{context.user_id[:8]}",
        "PATH":          "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "TERM":          "xterm-256color",
        "LANG":          "en_US.UTF-8",
        "WORKSPACE_DIR": str(workdir),
        **{k: v for k, v in extra_env.items() if not k.startswith("APP_") and k not in {
            "MONGODB_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SECRET_KEY"
        }}
    }

    # ─── Exécution async avec timeout ───────────────────────────────────────
    start = time.time()

    try:
        process = await asyncio.create_subprocess_exec(
            *shell_cmd, command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(workdir),
            env=safe_env,
        )

        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                process.communicate(),
                timeout=float(timeout_seconds)
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            return FunctionResult.fail(
                f"Commande annulée après {timeout_seconds}s (timeout).",
                code="COMMAND_TIMEOUT",
                command=command,
                timeout_seconds=timeout_seconds
            )

        duration_ms = int((time.time() - start) * 1000)
        stdout      = stdout_b.decode("utf-8", errors="replace")
        stderr      = stderr_b.decode("utf-8", errors="replace")
        exit_code   = process.returncode

        # Tronquer les sorties excessives
        MAX_OUTPUT = 50_000   # 50k chars
        if len(stdout) > MAX_OUTPUT:
            stdout = stdout[:MAX_OUTPUT] + f"\n... [tronqué — {len(stdout_b)} octets total]"
        if len(stderr) > MAX_OUTPUT:
            stderr = stderr[:MAX_OUTPUT] + f"\n... [tronqué]"

        context.logger.info(
            f"Commande exécutée",
            extra={"exit_code": exit_code, "duration_ms": duration_ms, "os": os_name}
        )

        return FunctionResult.ok(
            data={
                "stdout":      stdout,
                "stderr":      stderr,
                "exit_code":   exit_code,
                "duration_ms": duration_ms,
                "shell_used":  shell_cmd[0],
                "os_detected": os_name,
            }
        )

    except FileNotFoundError:
        return FunctionResult.fail(
            f"Shell introuvable : {shell_cmd[0]}",
            code="SHELL_NOT_FOUND"
        )
    except PermissionError as e:
        return FunctionResult.fail(str(e), code="PERMISSION_DENIED")
```

---

### F03 — `edit_py` : Édition de Fichier

**Objectif** : Remplacer une occurrence précise dans un fichier existant, avec vérification que le remplacement est unique (pour éviter les modifications ambiguës). Pattern inspiré de Claude Code.

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["file_path", "old_string", "new_string"],
  "properties": {
    "file_path":  { "type": "string", "description": "Chemin relatif au workspace" },
    "old_string": { "type": "string", "description": "Texte exact à remplacer (doit être unique dans le fichier)" },
    "new_string": { "type": "string", "description": "Texte de remplacement" },
    "create_if_not_exists": {
      "type": "boolean", "default": false,
      "description": "Si true et fichier absent, le créer avec new_string comme contenu"
    }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/filesystem/edit_py.py

from __future__ import annotations
import difflib
from pathlib import Path
from typing import Any

from app.core.context import FunctionContext, FunctionResult
from app.core.workspace import WorkspaceManager
from app.core.security import check_file_size, MAX_READ_SIZE_BYTES


async def edit_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Remplace une chaîne de texte exacte dans un fichier.
    
    old_string doit apparaître exactement une fois dans le fichier.
    Si plusieurs occurrences existent, retourne une erreur avec des suggestions
    pour rendre la sélection non-ambiguë.
    """
    ws_mgr             = WorkspaceManager(context.workspace.parent.parent)
    file_path          = ws_mgr.resolve_path(context.user_id, params["file_path"])
    old_string         = params["old_string"]
    new_string         = params["new_string"]
    create_if_missing  = params.get("create_if_not_exists", False)

    # ─── Fichier absent ─────────────────────────────────────────────────────
    if not file_path.exists():
        if create_if_missing:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(new_string, encoding="utf-8")
            return FunctionResult.ok(data={
                "action":    "created",
                "file_path": str(file_path.relative_to(context.workspace)),
                "lines":     new_string.count("\n") + 1,
            })
        return FunctionResult.fail(
            f"Fichier introuvable : '{params['file_path']}'",
            code="FILE_NOT_FOUND"
        )

    # ─── Lecture et vérification taille ─────────────────────────────────────
    check_file_size(file_path.stat().st_size, "read")
    original = file_path.read_text(encoding="utf-8", errors="replace")

    # ─── Vérification unicité du remplacement ───────────────────────────────
    count = original.count(old_string)
    if count == 0:
        # Fournir un diff contextuel pour aider l'agent à corriger
        suggestions = _suggest_close_matches(old_string, original)
        return FunctionResult.fail(
            f"La chaîne à remplacer n'a pas été trouvée dans '{params['file_path']}'.",
            code="STRING_NOT_FOUND",
            suggestions=suggestions[:3]
        )

    if count > 1:
        return FunctionResult.fail(
            f"La chaîne à remplacer apparaît {count} fois dans le fichier. "
            "Ajoutez plus de contexte (lignes avant/après) pour la rendre unique.",
            code="AMBIGUOUS_MATCH",
            occurrence_count=count
        )

    # ─── Remplacement unique ─────────────────────────────────────────────────
    new_content = original.replace(old_string, new_string, 1)

    # Calcul du diff pour retour informatif
    diff = list(difflib.unified_diff(
        original.splitlines(keepends=True),
        new_content.splitlines(keepends=True),
        fromfile=params["file_path"],
        tofile=params["file_path"] + " (modifié)",
        n=2
    ))

    file_path.write_text(new_content, encoding="utf-8")

    return FunctionResult.ok(data={
        "action":    "edited",
        "file_path": str(file_path.relative_to(context.workspace)),
        "diff":      "".join(diff[:100]),   # Limité pour éviter les réponses trop longues
        "lines_before": original.count("\n") + 1,
        "lines_after":  new_content.count("\n") + 1,
    })


def _suggest_close_matches(target: str, content: str, n: int = 3) -> list[str]:
    """Retourne des lignes proches du fichier pour aider l'agent à corriger sa recherche."""
    lines = content.splitlines()
    # Cherche les lignes les plus similaires à la première ligne de target
    first_line = target.splitlines()[0] if target else ""
    matches = difflib.get_close_matches(first_line, lines, n=n, cutoff=0.4)
    return matches
```

---

### F04 — `ls_py` : Listage de Répertoire

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "properties": {
    "path":        { "type": "string", "default": ".", "description": "Chemin relatif au workspace" },
    "recursive":   { "type": "boolean", "default": false },
    "max_depth":   { "type": "integer", "default": 2, "minimum": 1, "maximum": 5 },
    "show_hidden": { "type": "boolean", "default": false },
    "filter_ext":  { "type": "array", "items": { "type": "string" }, "description": "ex: [\".py\", \".ts\"]" }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/filesystem/ls_py.py

from __future__ import annotations
from pathlib import Path
from typing import Any

from app.core.context import FunctionContext, FunctionResult
from app.core.workspace import WorkspaceManager
from app.core.security import MAX_LS_DEPTH


async def ls_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Liste les fichiers et répertoires du workspace.
    Retourne une arborescence structurée avec métadonnées.
    """
    ws_mgr      = WorkspaceManager(context.workspace.parent.parent)
    rel_path    = params.get("path", ".")
    target_path = ws_mgr.resolve_path(context.user_id, rel_path)
    recursive   = params.get("recursive", False)
    max_depth   = min(params.get("max_depth", 2), MAX_LS_DEPTH)
    show_hidden = params.get("show_hidden", False)
    filter_ext  = [e.lower() if e.startswith(".") else f".{e.lower()}"
                   for e in params.get("filter_ext", [])]

    if not target_path.exists():
        return FunctionResult.fail(
            f"Chemin introuvable : '{rel_path}'", code="PATH_NOT_FOUND"
        )

    if not target_path.is_dir():
        return FunctionResult.fail(
            f"'{rel_path}' est un fichier, pas un répertoire.", code="NOT_A_DIRECTORY"
        )

    def build_tree(path: Path, depth: int) -> list[dict]:
        if depth > max_depth:
            return [{"name": "...", "type": "truncated"}]

        entries = []
        try:
            items = sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except PermissionError:
            return [{"name": "?", "type": "permission_denied"}]

        for item in items:
            if not show_hidden and item.name.startswith("."):
                continue
            if filter_ext and item.is_file() and item.suffix.lower() not in filter_ext:
                continue

            info = ws_mgr.get_file_info(item)
            info["relative_path"] = str(item.relative_to(context.workspace))

            if item.is_dir() and recursive:
                info["children"] = build_tree(item, depth + 1)

            entries.append(info)

        return entries

    tree = build_tree(target_path, 1)

    # Résumé textuel pour faciliter la lecture par l'agent
    def tree_to_text(entries: list[dict], indent: int = 0) -> str:
        lines = []
        prefix = "  " * indent
        for e in entries:
            if e.get("type") == "directory":
                lines.append(f"{prefix}📁 {e['name']}/")
                if "children" in e:
                    lines.append(tree_to_text(e["children"], indent + 1))
            elif e.get("type") == "file":
                size = e.get("size", 0)
                size_str = f"{size:,}B" if size < 1024 else f"{size//1024}KB"
                lines.append(f"{prefix}📄 {e['name']} ({size_str})")
            elif e.get("type") == "truncated":
                lines.append(f"{prefix}  ... (profondeur max atteinte)")
        return "\n".join(lines)

    return FunctionResult.ok(data={
        "path":         rel_path,
        "entries":      tree,
        "text_summary": tree_to_text(tree),
        "total_files":  sum(1 for e in tree if e.get("type") == "file"),
        "total_dirs":   sum(1 for e in tree if e.get("type") == "directory"),
    })
```

---

### F05 — `multi_edit_py` : Éditions Multiples

**Objectif** : Appliquer plusieurs éditions sur un ou plusieurs fichiers en une seule invocation. Composition de `edit_py` avec gestion transactionnelle (rollback si une édition échoue).

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["edits"],
  "properties": {
    "edits": {
      "type": "array",
      "minItems": 1,
      "maxItems": 50,
      "items": {
        "type": "object",
        "required": ["file_path", "old_string", "new_string"],
        "properties": {
          "file_path":  { "type": "string" },
          "old_string": { "type": "string" },
          "new_string": { "type": "string" },
          "create_if_not_exists": { "type": "boolean", "default": false }
        }
      }
    },
    "atomic": {
      "type": "boolean",
      "default": true,
      "description": "Si true, toutes les éditions réussissent ou aucune n'est appliquée"
    }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/filesystem/multi_edit_py.py

from __future__ import annotations
from pathlib import Path
from typing import Any

from app.core.context import FunctionContext, FunctionResult
from app.core.workspace import WorkspaceManager
from .edit_py import edit_py


async def multi_edit_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Applique plusieurs éditions séquentiellement.
    
    Mode atomique (défaut) : si une édition échoue, toutes les modifications
    précédentes sont annulées (rollback via sauvegarde des contenus originaux).
    """
    edits  = params["edits"]
    atomic = params.get("atomic", True)

    ws_mgr = WorkspaceManager(context.workspace.parent.parent)

    # ─── Snapshot avant modification (pour rollback atomique) ────────────────
    snapshots: dict[str, str] = {}   # file_path → contenu original
    if atomic:
        for edit in edits:
            path = ws_mgr.resolve_path(context.user_id, edit["file_path"])
            if path.exists():
                key = str(path)
                if key not in snapshots:
                    snapshots[key] = path.read_text(encoding="utf-8", errors="replace")

    # ─── Application séquentielle ────────────────────────────────────────────
    results: list[dict] = []
    failed_at: int | None = None

    for i, edit in enumerate(edits):
        result = await edit_py(edit, context)
        results.append({
            "index":     i,
            "file_path": edit["file_path"],
            "success":   result.success,
            "action":    result.data.get("action") if result.success else None,
            "error":     result.error if not result.success else None,
            "error_code": result.error_code if not result.success else None,
        })

        if not result.success and atomic:
            failed_at = i
            break

    # ─── Rollback si mode atomique et échec ──────────────────────────────────
    if failed_at is not None and atomic:
        for file_str, original_content in snapshots.items():
            Path(file_str).write_text(original_content, encoding="utf-8")

        return FunctionResult.fail(
            f"Édition #{failed_at + 1} échouée. "
            f"Rollback effectué sur {len(snapshots)} fichier(s).",
            code="MULTI_EDIT_ROLLBACK",
            failed_edit=results[failed_at],
            rolled_back_files=list(snapshots.keys())
        )

    success_count = sum(1 for r in results if r["success"])
    fail_count    = len(results) - success_count

    return FunctionResult.ok(data={
        "edits_applied": success_count,
        "edits_failed":  fail_count,
        "atomic":        atomic,
        "results":       results,
    })
```

---

### F06 — `read_py` : Lecture de Fichier

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["file_path"],
  "properties": {
    "file_path":  { "type": "string" },
    "start_line": { "type": "integer", "minimum": 1, "description": "Première ligne à lire (1-indexed)" },
    "end_line":   { "type": "integer", "minimum": 1, "description": "Dernière ligne à lire incluse" },
    "encoding":   { "type": "string", "default": "utf-8" }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/filesystem/read_py.py

from __future__ import annotations
from pathlib import Path
from typing import Any
import mimetypes

from app.core.context import FunctionContext, FunctionResult
from app.core.workspace import WorkspaceManager
from app.core.security import check_file_size, MAX_READ_SIZE_BYTES


# Extensions binaires non-lisibles comme texte
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
    ".mp3", ".mp4", ".avi", ".mov", ".wav",
    ".zip", ".tar", ".gz", ".rar", ".7z",
    ".pdf", ".docx", ".xlsx", ".pptx",
    ".exe", ".dll", ".so", ".dylib",
    ".pyc", ".class"
}


async def read_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Lit le contenu d'un fichier texte.
    
    Supporte la lecture partielle via start_line/end_line.
    Refuse les fichiers binaires avec un message informatif.
    """
    ws_mgr    = WorkspaceManager(context.workspace.parent.parent)
    file_path = ws_mgr.resolve_path(context.user_id, params["file_path"])
    encoding  = params.get("encoding", "utf-8")
    start_line = params.get("start_line")
    end_line   = params.get("end_line")

    if not file_path.exists():
        return FunctionResult.fail(
            f"Fichier introuvable : '{params['file_path']}'",
            code="FILE_NOT_FOUND"
        )

    if file_path.is_dir():
        return FunctionResult.fail(
            f"'{params['file_path']}' est un répertoire. Utilisez ls_py pour lister.",
            code="IS_A_DIRECTORY"
        )

    # ─── Vérification binaire ────────────────────────────────────────────────
    if file_path.suffix.lower() in BINARY_EXTENSIONS:
        return FunctionResult.fail(
            f"Fichier binaire ({file_path.suffix}) — lecture texte non supportée. "
            "Utilisez une fonction spécialisée selon le type de fichier.",
            code="BINARY_FILE",
            file_type=file_path.suffix
        )

    # ─── Vérification taille ─────────────────────────────────────────────────
    file_size = file_path.stat().st_size
    check_file_size(file_size, "read")

    # ─── Lecture ─────────────────────────────────────────────────────────────
    try:
        content = file_path.read_text(encoding=encoding, errors="replace")
    except LookupError:
        return FunctionResult.fail(
            f"Encodage invalide : '{encoding}'", code="INVALID_ENCODING"
        )

    lines = content.splitlines(keepends=True)
    total_lines = len(lines)

    # ─── Lecture partielle ───────────────────────────────────────────────────
    if start_line or end_line:
        s = (start_line or 1) - 1          # 0-indexed
        e = (end_line or total_lines)       # 1-indexed inclus
        selected = lines[s:e]
        content = "".join(selected)
        display_range = f"{start_line or 1}-{min(e, total_lines)}"
    else:
        display_range = f"1-{total_lines}"

    # ─── Détection du type de fichier ────────────────────────────────────────
    mime_type, _ = mimetypes.guess_type(str(file_path))

    return FunctionResult.ok(data={
        "content":      content,
        "file_path":    str(file_path.relative_to(context.workspace)),
        "total_lines":  total_lines,
        "lines_read":   display_range,
        "size_bytes":   file_size,
        "mime_type":    mime_type or "text/plain",
        "encoding":     encoding,
    })
```

---

### F07 — `todo_read_py` : Lecture TodoList

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "properties": {
    "agent_id": { "type": "string", "description": "Filtrer par agent. Omis = tous les todos de l'utilisateur" },
    "status":   { "type": "string", "enum": ["pending", "in_progress", "done", "cancelled", "all"], "default": "all" },
    "priority": { "type": "string", "enum": ["low", "medium", "high", "all"], "default": "all" },
    "limit":    { "type": "integer", "default": 50, "minimum": 1, "maximum": 200 }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/todo/todo_read_py.py

from __future__ import annotations
from typing import Any

from app.core.context import FunctionContext, FunctionResult
from app.core.database import get_db
from app.core.models.todo import TodoStatus, TodoPriority


async def todo_read_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Lit les todos de l'utilisateur depuis MongoDB.
    Supporte le filtrage par agent, statut et priorité.
    """
    agent_id      = params.get("agent_id")
    status_filter = params.get("status", "all")
    priority_filter = params.get("priority", "all")
    limit         = min(params.get("limit", 50), 200)

    # ─── Construction du filtre MongoDB ─────────────────────────────────────
    query: dict = {"user_id": context.user_id}

    if agent_id:
        query["agent_id"] = agent_id

    if status_filter != "all":
        query["items.status"] = status_filter

    if priority_filter != "all":
        query["items.priority"] = priority_filter

    # ─── Requête MongoDB ─────────────────────────────────────────────────────
    db = await get_db()
    collection = db["todos"]

    cursor = collection.find(query).sort("updated_at", -1).limit(limit)
    todo_lists = await cursor.to_list(length=limit)

    # ─── Formatage de la réponse ─────────────────────────────────────────────
    all_items = []
    for todo_list in todo_lists:
        for item in todo_list.get("items", []):
            # Filtrage côté applicatif si nécessaire
            if status_filter != "all" and item.get("status") != status_filter:
                continue
            if priority_filter != "all" and item.get("priority") != priority_filter:
                continue
            all_items.append({
                **item,
                "agent_id": todo_list.get("agent_id"),
            })

    # Résumé lisible pour l'agent
    summary_lines = []
    for item in all_items[:20]:  # Max 20 dans le résumé texte
        icon = {"pending": "⏳", "in_progress": "🔄", "done": "✅", "cancelled": "❌"}.get(
            item.get("status", "pending"), "⏳"
        )
        summary_lines.append(
            f"{icon} [{item.get('priority', 'medium').upper()}] {item.get('title', '?')} "
            f"(ID: {item.get('id', '?')[:8]})"
        )

    return FunctionResult.ok(data={
        "items":       all_items,
        "total":       len(all_items),
        "summary":     "\n".join(summary_lines) if summary_lines else "Aucun todo trouvé.",
        "filters":     {"status": status_filter, "priority": priority_filter, "agent_id": agent_id},
    })
```

---

### F08 — `todo_write_py` : Écriture TodoList

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["action"],
  "properties": {
    "action": {
      "type": "string",
      "enum": ["create", "update", "delete", "clear_done"],
      "description": "Action à effectuer"
    },
    "item": {
      "type": "object",
      "description": "Pour create/update",
      "properties": {
        "id":          { "type": "string", "description": "Requis pour update" },
        "title":       { "type": "string" },
        "description": { "type": "string" },
        "status":      { "type": "string", "enum": ["pending", "in_progress", "done", "cancelled"] },
        "priority":    { "type": "string", "enum": ["low", "medium", "high"] },
        "tags":        { "type": "array", "items": { "type": "string" } },
        "due_date":    { "type": "string", "format": "date-time" }
      }
    },
    "item_id": { "type": "string", "description": "Requis pour delete" }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/todo/todo_write_py.py

from __future__ import annotations
from datetime import datetime
from typing import Any
from bson import ObjectId

from app.core.context import FunctionContext, FunctionResult
from app.core.database import get_db
from app.core.models.todo import TodoItem, TodoStatus, TodoPriority
from app.core.exceptions import TodoNotFoundError


async def todo_write_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Crée, modifie ou supprime des éléments dans la TodoList de l'utilisateur.
    
    Actions disponibles :
    - create     : ajoute un nouvel item
    - update     : modifie un item existant (par son id)
    - delete     : supprime un item (par son id)
    - clear_done : supprime tous les items avec status=done
    """
    action = params["action"]
    db     = await get_db()
    coll   = db["todos"]
    now    = datetime.utcnow()

    # Clé de document : un document par (user_id, agent_id)
    doc_filter = {
        "user_id":  context.user_id,
        "agent_id": context.agent_id or None,
    }

    # ─── CREATE ──────────────────────────────────────────────────────────────
    if action == "create":
        item_data = params.get("item", {})
        if not item_data.get("title"):
            return FunctionResult.fail("'title' requis pour créer un todo.", code="MISSING_FIELD")

        new_item = TodoItem(
            title       = item_data["title"],
            description = item_data.get("description"),
            status      = TodoStatus(item_data.get("status", "pending")),
            priority    = TodoPriority(item_data.get("priority", "medium")),
            tags        = item_data.get("tags", []),
            due_date    = (datetime.fromisoformat(item_data["due_date"])
                          if item_data.get("due_date") else None),
            agent_id    = context.agent_id,
        )

        result = await coll.update_one(
            doc_filter,
            {
                "$push":         {"items": new_item.model_dump()},
                "$set":          {"updated_at": now},
                "$setOnInsert":  {"created_at": now, **doc_filter},
            },
            upsert=True
        )

        return FunctionResult.ok(data={
            "action":  "created",
            "item_id": new_item.id,
            "title":   new_item.title,
        })

    # ─── UPDATE ──────────────────────────────────────────────────────────────
    elif action == "update":
        item_id   = params.get("item", {}).get("id")
        if not item_id:
            return FunctionResult.fail("'item.id' requis pour update.", code="MISSING_FIELD")

        updates = {
            k: v for k, v in params.get("item", {}).items()
            if k != "id" and v is not None
        }
        updates["updated_at"] = now.isoformat()

        mongo_updates = {f"items.$.{k}": v for k, v in updates.items()}

        result = await coll.update_one(
            {**doc_filter, "items.id": item_id},
            {"$set": {**mongo_updates, "updated_at": now}}
        )

        if result.matched_count == 0:
            return FunctionResult.fail(
                f"Todo '{item_id}' introuvable.", code="TODO_NOT_FOUND"
            )

        return FunctionResult.ok(data={
            "action":  "updated",
            "item_id": item_id,
            "updates": list(updates.keys()),
        })

    # ─── DELETE ──────────────────────────────────────────────────────────────
    elif action == "delete":
        item_id = params.get("item_id")
        if not item_id:
            return FunctionResult.fail("'item_id' requis pour delete.", code="MISSING_FIELD")

        result = await coll.update_one(
            doc_filter,
            {
                "$pull": {"items": {"id": item_id}},
                "$set":  {"updated_at": now}
            }
        )

        if result.modified_count == 0:
            return FunctionResult.fail(
                f"Todo '{item_id}' introuvable ou déjà supprimé.", code="TODO_NOT_FOUND"
            )

        return FunctionResult.ok(data={"action": "deleted", "item_id": item_id})

    # ─── CLEAR DONE ──────────────────────────────────────────────────────────
    elif action == "clear_done":
        result = await coll.update_one(
            doc_filter,
            {
                "$pull": {"items": {"status": "done"}},
                "$set":  {"updated_at": now}
            }
        )

        return FunctionResult.ok(data={
            "action":  "cleared",
            "removed": result.modified_count > 0,
        })

    return FunctionResult.fail(
        f"Action inconnue : '{action}'", code="INVALID_ACTION"
    )
```

---

### F09 — `web_fetch_py` : Récupération Page Web

**Objectif** : Télécharger le contenu d'une URL et le convertir en Markdown lisible par l'agent. Gestion propre des pages dynamiques via sélection du contenu principal.

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["url"],
  "properties": {
    "url":          { "type": "string", "format": "uri" },
    "output_format": {
      "type": "string",
      "enum": ["markdown", "text", "html"],
      "default": "markdown",
      "description": "Format de retour du contenu"
    },
    "max_chars":    { "type": "integer", "default": 20000, "maximum": 100000 },
    "selector":     { "type": "string", "description": "Sélecteur CSS pour extraire une partie spécifique" },
    "timeout_seconds": { "type": "integer", "default": 15, "maximum": 30 }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/web/web_fetch_py.py

from __future__ import annotations
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup
import markdownify

from app.core.context import FunctionContext, FunctionResult
from app.core.security import validate_url


async def web_fetch_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Récupère le contenu d'une page web et le convertit en Markdown.
    
    Prévention SSRF : validation stricte de l'URL (pas d'IPs privées, 
    pas de metadata services, schéma HTTPS uniquement).
    """
    url           = params["url"]
    output_format = params.get("output_format", "markdown")
    max_chars     = min(params.get("max_chars", 20_000), 100_000)
    css_selector  = params.get("selector")
    timeout       = min(params.get("timeout_seconds", 15), 30)

    # ─── Validation URL (anti-SSRF) ──────────────────────────────────────────
    validate_url(url)

    # ─── Téléchargement ──────────────────────────────────────────────────────
    headers = {
        "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
    }

    try:
        response = await context.http.get(url, headers=headers, timeout=float(timeout))
        response.raise_for_status()
    except Exception as e:
        return FunctionResult.fail(
            f"Échec du téléchargement de '{url}' : {str(e)}",
            code="FETCH_ERROR",
            url=url
        )

    # ─── Vérification type contenu ───────────────────────────────────────────
    content_type = response.headers.get("content-type", "")
    if "text" not in content_type and "html" not in content_type:
        return FunctionResult.fail(
            f"Type de contenu non supporté : '{content_type}'. "
            "web_fetch_py supporte uniquement les pages HTML/texte.",
            code="UNSUPPORTED_CONTENT_TYPE",
            content_type=content_type
        )

    html = response.text

    # ─── Parsing HTML ────────────────────────────────────────────────────────
    soup = BeautifulSoup(html, "lxml")

    # Suppression des éléments non-pertinents
    for tag in soup.find_all(["script", "style", "nav", "footer",
                               "header", "aside", "iframe", "noscript",
                               "form", "button"]):
        tag.decompose()

    # Application du sélecteur CSS si fourni
    if css_selector:
        selected = soup.select(css_selector)
        if not selected:
            return FunctionResult.fail(
                f"Sélecteur CSS '{css_selector}' n'a retourné aucun élément.",
                code="SELECTOR_NO_MATCH"
            )
        content_element = selected[0]
    else:
        # Heuristique : chercher le contenu principal
        main = (
            soup.find("main") or
            soup.find("article") or
            soup.find(id="content") or
            soup.find(class_="content") or
            soup.find("body")
        )
        content_element = main or soup

    # ─── Conversion selon format souhaité ────────────────────────────────────
    if output_format == "markdown":
        content = markdownify.markdownify(
            str(content_element),
            heading_style="ATX",
            bullets="-",
            strip=["img"]
        )
        # Nettoyage des lignes vides multiples
        import re
        content = re.sub(r"\n{3,}", "\n\n", content).strip()

    elif output_format == "text":
        content = content_element.get_text(separator="\n", strip=True)
    else:
        content = str(content_element)

    # ─── Troncature si nécessaire ────────────────────────────────────────────
    truncated = len(content) > max_chars
    if truncated:
        content = content[:max_chars] + f"\n\n... [contenu tronqué à {max_chars} caractères]"

    # ─── Métadonnées ─────────────────────────────────────────────────────────
    title = soup.find("title")
    meta_desc = soup.find("meta", {"name": "description"})

    return FunctionResult.ok(data={
        "content":       content,
        "url":           url,
        "title":         title.get_text() if title else None,
        "description":   meta_desc["content"] if meta_desc and meta_desc.get("content") else None,
        "content_type":  content_type,
        "output_format": output_format,
        "char_count":    len(content),
        "truncated":     truncated,
    })
```

---

### F10 — `web_search_py` : Recherche Web

**Objectif** : Effectuer une recherche web et retourner les résultats structurés. Support de plusieurs moteurs (SearXNG self-hosted recommandé, Brave Search API, DuckDuckGo comme fallback gratuit).

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query":        { "type": "string", "description": "Requête de recherche" },
    "max_results":  { "type": "integer", "default": 10, "minimum": 1, "maximum": 20 },
    "language":     { "type": "string", "default": "fr", "description": "Langue des résultats" },
    "region":       { "type": "string", "default": "fr-fr" },
    "fetch_content": {
      "type": "boolean",
      "default": false,
      "description": "Si true, récupère aussi le contenu des pages (plus lent)"
    },
    "engine":       {
      "type": "string",
      "enum": ["auto", "searxng", "brave", "duckduckgo"],
      "default": "auto"
    }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/web/web_search_py.py

from __future__ import annotations
import os
from typing import Any
from urllib.parse import urlencode, quote_plus

from app.core.context import FunctionContext, FunctionResult


class SearchEngine:
    """Interface commune pour tous les moteurs de recherche."""

    async def search(
        self,
        http,
        query: str,
        max_results: int,
        language: str,
        region: str,
    ) -> list[dict]:
        raise NotImplementedError


class SearXNGEngine(SearchEngine):
    """
    SearXNG self-hosted — recommandé pour la confidentialité et la gratuité.
    Nécessite SEARXNG_URL dans les variables d'environnement.
    """
    def __init__(self):
        self.base_url = os.environ.get("SEARXNG_URL", "http://searxng:8080")

    async def search(self, http, query, max_results, language, region) -> list[dict]:
        params = urlencode({
            "q":        query,
            "format":   "json",
            "language": language,
            "pageno":   1,
        })
        response = await http.get(f"{self.base_url}/search?{params}")
        response.raise_for_status()
        data = response.json()

        return [
            {
                "title":   r.get("title", ""),
                "url":     r.get("url", ""),
                "snippet": r.get("content", ""),
                "engine":  r.get("engine", "searxng"),
                "score":   r.get("score", 0),
            }
            for r in data.get("results", [])[:max_results]
        ]


class BraveSearchEngine(SearchEngine):
    """Brave Search API — nécessite BRAVE_SEARCH_API_KEY."""
    def __init__(self):
        self.api_key = os.environ.get("BRAVE_SEARCH_API_KEY", "")

    async def search(self, http, query, max_results, language, region) -> list[dict]:
        if not self.api_key:
            raise ValueError("BRAVE_SEARCH_API_KEY non configuré")
        response = await http.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"Accept": "application/json", "X-Subscription-Token": self.api_key},
            params={"q": query, "count": max_results, "search_lang": language, "country": region[:2].upper()}
        )
        response.raise_for_status()
        data = response.json()
        return [
            {
                "title":   r.get("title", ""),
                "url":     r.get("url", ""),
                "snippet": r.get("description", ""),
                "engine":  "brave",
            }
            for r in data.get("web", {}).get("results", [])[:max_results]
        ]


class DuckDuckGoEngine(SearchEngine):
    """DuckDuckGo — gratuit, sans clé API, via l'API HTML non-officielle."""
    async def search(self, http, query, max_results, language, region) -> list[dict]:
        # Utilise l'endpoint DuckDuckGo HTML puis parse les résultats
        from bs4 import BeautifulSoup
        response = await http.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query, "kl": region},
            headers={"User-Agent": "Mozilla/5.0 (compatible; AppAgent/1.0)"}
        )
        soup = BeautifulSoup(response.text, "lxml")
        results = []
        for r in soup.select(".result")[:max_results]:
            title_el   = r.select_one(".result__title a")
            snippet_el = r.select_one(".result__snippet")
            if title_el:
                results.append({
                    "title":   title_el.get_text(strip=True),
                    "url":     title_el.get("href", ""),
                    "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
                    "engine":  "duckduckgo",
                })
        return results


def _get_engine(preferred: str) -> SearchEngine:
    """Sélectionne le moteur disponible selon la configuration."""
    if preferred == "searxng" or (preferred == "auto" and os.environ.get("SEARXNG_URL")):
        return SearXNGEngine()
    if preferred == "brave" or (preferred == "auto" and os.environ.get("BRAVE_SEARCH_API_KEY")):
        return BraveSearchEngine()
    return DuckDuckGoEngine()


async def web_search_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Recherche web multi-moteur avec fallback automatique.
    Moteur recommandé : SearXNG self-hosted (confidentialité maximale).
    """
    query         = params["query"]
    max_results   = min(params.get("max_results", 10), 20)
    language      = params.get("language", "fr")
    region        = params.get("region", "fr-fr")
    fetch_content = params.get("fetch_content", False)
    engine_pref   = params.get("engine", "auto")

    engine = _get_engine(engine_pref)

    try:
        results = await engine.search(
            context.http, query, max_results, language, region
        )
    except Exception as e:
        # Fallback sur DuckDuckGo si le moteur principal échoue
        if not isinstance(engine, DuckDuckGoEngine):
            context.logger.warning(f"Moteur {engine_pref} échoué, fallback DuckDuckGo : {e}")
            try:
                results = await DuckDuckGoEngine().search(
                    context.http, query, max_results, language, region
                )
            except Exception as e2:
                return FunctionResult.fail(
                    f"Tous les moteurs de recherche ont échoué. Dernier : {str(e2)}",
                    code="SEARCH_ALL_FAILED"
                )
        else:
            return FunctionResult.fail(str(e), code="SEARCH_FAILED")

    # ─── Récupération optionnelle du contenu ─────────────────────────────────
    if fetch_content and results:
        from .web_fetch_py import web_fetch_py
        for r in results[:3]:  # Limité à 3 pour les performances
            try:
                fetch_result = await web_fetch_py(
                    {"url": r["url"], "max_chars": 3000}, context
                )
                if fetch_result.success:
                    r["content"] = fetch_result.data.get("content", "")
            except Exception:
                pass  # Contenu optionnel, on continue

    # ─── Résumé textuel ──────────────────────────────────────────────────────
    summary = "\n\n".join([
        f"**{i+1}. {r['title']}**\n{r['url']}\n{r.get('snippet', '')}"
        for i, r in enumerate(results)
    ])

    return FunctionResult.ok(data={
        "results":     results,
        "total":       len(results),
        "query":       query,
        "engine_used": type(engine).__name__.replace("Engine", "").lower(),
        "summary":     summary,
    })
```

---

### F11 — `write_py` : Création et Écriture de Fichier

**JSON Schema Entrée** :

```json
{
  "type": "object",
  "required": ["file_path", "content"],
  "properties": {
    "file_path":  { "type": "string", "description": "Chemin relatif au workspace" },
    "content":    { "type": "string", "description": "Contenu complet du fichier" },
    "mode": {
      "type": "string",
      "enum": ["overwrite", "append", "create_only"],
      "default": "overwrite",
      "description": "overwrite: écrase si existant | append: ajoute à la fin | create_only: échoue si existant"
    },
    "encoding":   { "type": "string", "default": "utf-8" },
    "create_dirs": {
      "type": "boolean",
      "default": true,
      "description": "Crée les répertoires parents si nécessaires"
    }
  }
}
```

**Implémentation** :

```python
# backend/python/app/native/filesystem/write_py.py

from __future__ import annotations
from pathlib import Path
from typing import Any

from app.core.context import FunctionContext, FunctionResult
from app.core.workspace import WorkspaceManager
from app.core.security import check_file_size, MAX_WRITE_SIZE_BYTES


async def write_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Crée ou écrase un fichier dans le workspace.
    
    Modes :
    - overwrite  (défaut) : crée ou écrase
    - append     : ajoute au contenu existant
    - create_only: échoue si le fichier existe déjà
    """
    ws_mgr      = WorkspaceManager(context.workspace.parent.parent)
    file_path   = ws_mgr.resolve_path(context.user_id, params["file_path"])
    content     = params["content"]
    mode        = params.get("mode", "overwrite")
    encoding    = params.get("encoding", "utf-8")
    create_dirs = params.get("create_dirs", True)

    # ─── Vérification taille ─────────────────────────────────────────────────
    content_bytes = content.encode(encoding, errors="replace")
    check_file_size(len(content_bytes), "write")

    # ─── Mode create_only ────────────────────────────────────────────────────
    if mode == "create_only" and file_path.exists():
        return FunctionResult.fail(
            f"Le fichier '{params['file_path']}' existe déjà (mode create_only).",
            code="FILE_ALREADY_EXISTS"
        )

    # ─── Création des répertoires parents ────────────────────────────────────
    if create_dirs:
        file_path.parent.mkdir(parents=True, exist_ok=True)
    elif not file_path.parent.exists():
        return FunctionResult.fail(
            f"Répertoire parent inexistant : '{file_path.parent}'. "
            "Passez create_dirs=true pour le créer automatiquement.",
            code="PARENT_DIR_NOT_FOUND"
        )

    # ─── Écriture ────────────────────────────────────────────────────────────
    existed_before = file_path.exists()
    old_size       = file_path.stat().st_size if existed_before else 0

    if mode == "append" and existed_before:
        with file_path.open("a", encoding=encoding) as f:
            f.write(content)
        action = "appended"
    else:
        file_path.write_text(content, encoding=encoding)
        action = "overwritten" if existed_before else "created"

    new_size = file_path.stat().st_size

    return FunctionResult.ok(data={
        "action":         action,
        "file_path":      str(file_path.relative_to(context.workspace)),
        "size_bytes":     new_size,
        "lines":          content.count("\n") + 1,
        "encoding":       encoding,
        "previous_size":  old_size if existed_before else None,
    })
```

---

## P2.6 Registre & Seed des Fonctions Natives

### P2.6.1 NativeFunctionRegistry

```python
# backend/python/app/native/registry.py
"""
Registre des fonctions natives.
Inséré en base MongoDB au démarrage de l'application (seed).
Les fonctions natives sont marquées origin='native' et isReadonly=True.
"""

from __future__ import annotations
import json
from pathlib import Path
from typing import Any

NATIVE_DIR = Path(__file__).parent


NATIVE_FUNCTIONS_MANIFEST: list[dict[str, Any]] = [
    {
        "id":          "native_agent_py",
        "name":        "agent_py",
        "description": "Lance un sous-agent pour traiter une tâche déléguée. "
                       "Utiliser quand la tâche nécessite un agent spécialisé ou "
                       "quand la complexité dépasse les capacités de l'agent courant.",
        "language":    "python",
        "origin":      "native",
        "category":    "ai",
        "tags":        ["agent", "orchestration", "delegation", "sous-agent"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.agent.agent_py",
        "inputSchema":  _load_schema("agent/schema_input.json"),
        "outputSchema": _load_schema("agent/schema_output.json"),
    },
    {
        "id":          "native_bash_py",
        "name":        "bash_py",
        "description": "Exécute une commande Shell (Linux/macOS) ou PowerShell (Windows) "
                       "dans le workspace de l'utilisateur. Détecte automatiquement l'OS.",
        "language":    "python",
        "origin":      "native",
        "category":    "utility",
        "tags":        ["bash", "shell", "powershell", "commande", "terminal", "os"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.bash.bash_py",
        "inputSchema":  _load_schema("bash/schema_input.json"),
        "outputSchema": _load_schema("bash/schema_output.json"),
    },
    {
        "id":          "native_edit_py",
        "name":        "edit_py",
        "description": "Édite un fichier en remplaçant une occurrence exacte de texte. "
                       "old_string doit être unique dans le fichier.",
        "language":    "python",
        "origin":      "native",
        "category":    "file",
        "tags":        ["fichier", "édition", "modification", "remplacer", "edit"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.filesystem.edit_py",
        "inputSchema":  _load_schema("filesystem/schema_edit_input.json"),
        "outputSchema": _load_schema("filesystem/schema_edit_output.json"),
    },
    {
        "id":          "native_ls_py",
        "name":        "ls_py",
        "description": "Liste les fichiers et dossiers dans le workspace. "
                       "Retourne une arborescence avec métadonnées.",
        "language":    "python",
        "origin":      "native",
        "category":    "file",
        "tags":        ["liste", "répertoire", "dossier", "ls", "explorer"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.filesystem.ls_py",
        "inputSchema":  _load_schema("filesystem/schema_ls_input.json"),
        "outputSchema": _load_schema("filesystem/schema_ls_output.json"),
    },
    {
        "id":          "native_multi_edit_py",
        "name":        "multi_edit_py",
        "description": "Applique plusieurs éditions de fichiers en une seule opération. "
                       "Supporte le mode atomique (rollback si une édition échoue).",
        "language":    "python",
        "origin":      "native",
        "category":    "file",
        "tags":        ["multi", "éditions", "batch", "fichiers", "atomique"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.filesystem.multi_edit_py",
        "inputSchema":  _load_schema("filesystem/schema_multi_edit_input.json"),
        "outputSchema": {"type": "object"},
    },
    {
        "id":          "native_read_py",
        "name":        "read_py",
        "description": "Lit le contenu d'un fichier texte dans le workspace. "
                       "Supporte la lecture partielle (start_line/end_line).",
        "language":    "python",
        "origin":      "native",
        "category":    "file",
        "tags":        ["lire", "fichier", "contenu", "texte", "read"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.filesystem.read_py",
        "inputSchema":  _load_schema("filesystem/schema_read_input.json"),
        "outputSchema": _load_schema("filesystem/schema_read_output.json"),
    },
    {
        "id":          "native_todo_read_py",
        "name":        "todo_read_py",
        "description": "Lit la liste des todos de l'utilisateur. "
                       "Supporte les filtres par statut, priorité et agent.",
        "language":    "python",
        "origin":      "native",
        "category":    "data",
        "tags":        ["todo", "tâche", "liste", "planification"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.todo.todo_read_py",
        "inputSchema":  _load_schema("todo/schema_todo_read_input.json"),
        "outputSchema": _load_schema("todo/schema_todo_read_output.json"),
    },
    {
        "id":          "native_todo_write_py",
        "name":        "todo_write_py",
        "description": "Crée, modifie ou supprime des éléments dans la TodoList. "
                       "Actions: create, update, delete, clear_done.",
        "language":    "python",
        "origin":      "native",
        "category":    "data",
        "tags":        ["todo", "tâche", "créer", "modifier", "supprimer"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.todo.todo_write_py",
        "inputSchema":  _load_schema("todo/schema_todo_write_input.json"),
        "outputSchema": _load_schema("todo/schema_todo_write_output.json"),
    },
    {
        "id":          "native_web_fetch_py",
        "name":        "web_fetch_py",
        "description": "Récupère et convertit le contenu d'une page web en Markdown. "
                       "Prévention SSRF intégrée.",
        "language":    "python",
        "origin":      "native",
        "category":    "web",
        "tags":        ["web", "page", "url", "fetch", "html", "markdown"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.web.web_fetch_py",
        "inputSchema":  _load_schema("web/schema_fetch_input.json"),
        "outputSchema": _load_schema("web/schema_fetch_output.json"),
    },
    {
        "id":          "native_web_search_py",
        "name":        "web_search_py",
        "description": "Recherche sur le web et retourne les résultats structurés. "
                       "Multi-moteur avec fallback automatique (SearXNG, Brave, DuckDuckGo).",
        "language":    "python",
        "origin":      "native",
        "category":    "web",
        "tags":        ["recherche", "web", "search", "google", "internet"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.web.web_search_py",
        "inputSchema":  _load_schema("web/schema_search_input.json"),
        "outputSchema": _load_schema("web/schema_search_output.json"),
    },
    {
        "id":          "native_write_py",
        "name":        "write_py",
        "description": "Crée ou écrase un fichier dans le workspace. "
                       "Modes: overwrite (défaut), append, create_only.",
        "language":    "python",
        "origin":      "native",
        "category":    "file",
        "tags":        ["écrire", "créer", "fichier", "write", "nouveau"],
        "isReadonly":  True,
        "isActive":    True,
        "version":     "1.0.0",
        "entrypoint":  "app.native.filesystem.write_py",
        "inputSchema":  _load_schema("filesystem/schema_write_input.json"),
        "outputSchema": {"type": "object"},
    },
]


def _load_schema(relative_path: str) -> dict:
    """Charge un fichier JSON Schema depuis le répertoire des fonctions natives."""
    schema_path = NATIVE_DIR / relative_path
    if schema_path.exists():
        return json.loads(schema_path.read_text())
    return {"type": "object"}


async def seed_native_functions(db) -> None:
    """
    Insère ou met à jour les fonctions natives en base MongoDB.
    Appelé au démarrage du sidecar Python (lifespan FastAPI).
    Les fonctions natives existantes sont mises à jour si la version change.
    """
    collection = db["functions"]

    for fn in NATIVE_FUNCTIONS_MANIFEST:
        await collection.update_one(
            {"id": fn["id"], "origin": "native"},
            {"$set": fn},
            upsert=True
        )

    count = await collection.count_documents({"origin": "native"})
    print(f"[Seed] {count} fonctions natives enregistrées en base.")
```

---

## P2.7 Système de Fichiers Multi-Utilisateur

### P2.7.1 Initialisation du Workspace à la Création d'un Compte

Le workspace d'un utilisateur est créé automatiquement lors de sa première connexion (middleware Node.js) :

```typescript
// backend/src/middleware/workspace-init.middleware.ts

export async function ensureUserWorkspace(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user?.id) return next();

  // Appel au sidecar Python pour initialiser le workspace
  try {
    await fetch(`http://python-sidecar:8001/internal/workspace/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: req.user.id })
    });
  } catch {
    // Non-bloquant : le workspace sera créé à la première utilisation
  }
  next();
}
```

Endpoint Python correspondant :

```python
# Dans app/api.py — endpoint interne
@app.post("/internal/workspace/init")
async def init_workspace(body: dict):
    """Initialise la structure de workspace d'un nouvel utilisateur."""
    user_id = body["user_id"]
    workspace_root = os.environ.get("WORKSPACE_ROOT", "/app/users")
    ws_mgr = WorkspaceManager(workspace_root)

    # Crée tous les répertoires nécessaires
    ws_mgr.get_user_workspace(user_id)
    ws_mgr.get_user_functions_dir(user_id)
    ws_mgr.get_user_todos_dir(user_id)

    # Crée un README dans le workspace
    ws = ws_mgr.get_user_workspace(user_id)
    readme = ws / "README.md"
    if not readme.exists():
        readme.write_text(
            f"# Workspace\n\nCe répertoire est votre espace de travail personnel.\n"
            f"Les agents peuvent y lire et écrire des fichiers via les fonctions natives.\n"
        )

    return {"status": "ok", "workspace": str(ws)}
```

### P2.7.2 Structure d'un Workspace Utilisateur (runtime)

```
/app/users/                                   ← Monté comme volume Docker persistant
  {userId_abc123}/
    workspace/                                ← Accessible par l'agent via fonctions natives
      README.md
      projects/
        mon-projet/
          main.py
          requirements.txt
      uploads/
      outputs/
    todos/                                    ← Backup JSON local des todos (optionnel)
    functions/                                ← Fonctions custom de l'utilisateur
      my_analyzer_py.py
      my_formatter_py.py
  {userId_def456}/
    workspace/
    ...
native/                                       ← Fonctions natives READ-ONLY
  agent/
  bash/
  filesystem/
  todo/
  web/
```

---

## P2.8 Sécurité Spécifique aux Fonctions Natives

### P2.8.1 Matrice de Risques & Mitigations

| Fonction | Risque Principal | Mitigation |
|---|---|---|
| `agent_py` | Récursion infinie | Compteur depth ≤ 3, budget tokens décroissant |
| `bash_py` | Exécution arbitraire | Docker sandbox obligatoire, blacklist commandes, env minimal |
| `edit_py` | Corruption fichier | Vérification unicité, diff retourné, backup implicite si atomic |
| `ls_py` | Enumération filesystem | Confinement workspace, profondeur max 5 |
| `multi_edit_py` | Modifications en cascade | Mode atomique avec rollback par défaut |
| `read_py` | Exfiltration données | Confinement workspace, taille max 10MB, binaires bloqués |
| `todo_read_py` | Accès données autres users | Filter MongoDB par user_id systématique |
| `todo_write_py` | Injection NoSQL | Pydantic v2 validation avant toute écriture |
| `web_fetch_py` | SSRF | Validation URL stricte, blocage IPs privées/metadata |
| `web_search_py` | Abus quota API | Rate limit par user_id (10 req/min) |
| `write_py` | Écriture hors workspace | WorkspaceManager.resolve_path() systématique |

### P2.8.2 Rate Limiting par Fonction

```python
# Limites appliquées dans SecurityGuard
RATE_LIMITS: dict[str, tuple[int, int]] = {
    # (max_calls, window_seconds)
    "agent_py":      (5,  60),   # 5 sous-agents par minute
    "bash_py":       (10, 60),   # 10 commandes par minute
    "web_fetch_py":  (20, 60),   # 20 fetches par minute
    "web_search_py": (10, 60),   # 10 recherches par minute
    "write_py":      (50, 60),   # 50 écritures par minute
    "edit_py":       (50, 60),
    "multi_edit_py": (10, 60),
    "read_py":       (100, 60),
    "ls_py":         (100, 60),
    "todo_read_py":  (100, 60),
    "todo_write_py": (50, 60),
}
```

---

## P2.9 Tests des Fonctions Natives

### P2.9.1 Configuration pytest (conftest.py)

```python
# backend/python/tests/conftest.py

import asyncio
import pytest
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from app.core.context import FunctionContext
from app.core.workspace import WorkspaceManager


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def tmp_workspace(tmp_path):
    """Workspace temporaire pour les tests filesystem."""
    user_id = "test_user_001"
    ws = tmp_path / "users" / user_id / "workspace"
    ws.mkdir(parents=True)
    return tmp_path, user_id, ws


@pytest.fixture
def mock_context(tmp_workspace):
    """FunctionContext mocké pour les tests."""
    workspace_root, user_id, workspace = tmp_workspace
    ctx = FunctionContext(
        user_id=user_id,
        agent_id="test_agent",
        workspace=workspace,
        is_sandbox=True,
        depth=0,
    )
    ctx.http = AsyncMock()
    return ctx
```

### P2.9.2 Tests Représentatifs

```python
# backend/python/tests/native/test_filesystem.py

import pytest
from pathlib import Path

from app.native.filesystem.read_py   import read_py
from app.native.filesystem.write_py  import write_py
from app.native.filesystem.edit_py   import edit_py
from app.native.filesystem.ls_py     import ls_py
from app.core.exceptions import WorkspaceSecurityError


class TestWriteAndRead:

    @pytest.mark.asyncio
    async def test_create_file(self, mock_context):
        result = await write_py(
            {"file_path": "test.txt", "content": "Hello World\n"},
            mock_context
        )
        assert result.success is True
        assert result.data["action"] == "created"
        assert (mock_context.workspace / "test.txt").exists()

    @pytest.mark.asyncio
    async def test_read_created_file(self, mock_context):
        (mock_context.workspace / "hello.txt").write_text("Bonjour\n")
        result = await read_py({"file_path": "hello.txt"}, mock_context)
        assert result.success is True
        assert "Bonjour" in result.data["content"]

    @pytest.mark.asyncio
    async def test_path_traversal_blocked(self, mock_context):
        """Test critique sécurité : le path traversal doit être bloqué."""
        result = await read_py({"file_path": "../../etc/passwd"}, mock_context)
        assert result.success is False
        assert result.error_code == "PATH_OUTSIDE_WORKSPACE"

    @pytest.mark.asyncio
    async def test_edit_unique_replacement(self, mock_context):
        (mock_context.workspace / "code.py").write_text("def hello():\n    return 'world'\n")
        result = await edit_py(
            {"file_path": "code.py", "old_string": "return 'world'", "new_string": "return 'Python'"},
            mock_context
        )
        assert result.success is True
        content = (mock_context.workspace / "code.py").read_text()
        assert "return 'Python'" in content

    @pytest.mark.asyncio
    async def test_edit_ambiguous_match_rejected(self, mock_context):
        (mock_context.workspace / "dup.txt").write_text("foo\nfoo\n")
        result = await edit_py(
            {"file_path": "dup.txt", "old_string": "foo", "new_string": "bar"},
            mock_context
        )
        assert result.success is False
        assert result.error_code == "AMBIGUOUS_MATCH"


class TestSecurity:

    @pytest.mark.asyncio
    async def test_bash_forbidden_command(self, mock_context):
        from app.native.bash.bash_py import bash_py
        result = await bash_py({"command": "rm -rf /"}, mock_context)
        assert result.success is False
        assert result.error_code == "COMMAND_FORBIDDEN"

    @pytest.mark.asyncio
    async def test_web_fetch_ssrf_blocked(self, mock_context):
        from app.native.web.web_fetch_py import web_fetch_py
        result = await web_fetch_py({"url": "http://169.254.169.254/latest/meta-data"}, mock_context)
        assert result.success is False
        assert result.error_code == "URL_FORBIDDEN"

    @pytest.mark.asyncio
    async def test_agent_depth_limit(self, mock_context):
        from app.native.agent.agent_py import agent_py
        mock_context.depth = 3   # Déjà au max
        result = await agent_py({"task": "Faire quelque chose"}, mock_context)
        assert result.success is False
        assert result.error_code == "AGENT_DEPTH_LIMIT"
```

---

## P2.10 Roadmap d'Implémentation Partie 2

### Phase 1 — Infrastructure de Base (Semaine 1)

- [ ] Créer la structure `backend/python/` complète (arborescence §P2.2)
- [ ] Implémenter `core/context.py`, `core/workspace.py`, `core/security.py`, `core/exceptions.py`
- [ ] Implémenter `core/models/todo.py`
- [ ] Configurer le Dockerfile Python sidecar
- [ ] Ajouter les services `python-sidecar` et `sandbox-runner` au `docker-compose.yml`
- [ ] Configurer le volume `user_workspaces` et le réseau `sandbox-net`
- [ ] Implémenter et tester `WorkspaceManager` (tests unitaires)

### Phase 2 — Fonctions Filesystem (Semaine 2)

**Ordre d'implémentation recommandé** (du plus simple au plus complexe) :

- [ ] `write_py` → `read_py` → `ls_py` (indépendants, faciles à tester)
- [ ] `edit_py` (dépend de `read_py` + diff)
- [ ] `multi_edit_py` (compose `edit_py`)
- [ ] Tests unitaires complets pour toutes les fonctions filesystem
- [ ] **Test critique sécurité** : path traversal bloqué sur toutes les fonctions

### Phase 3 — Fonctions Web & Todo (Semaine 3)

- [ ] `web_fetch_py` (httpx + BeautifulSoup + markdownify)
- [ ] `web_search_py` (SearXNG d'abord, puis DuckDuckGo fallback)
- [ ] `todo_read_py` + `todo_write_py` (MongoDB Motor)
- [ ] Connexion MongoDB dans `core/database.py`
- [ ] Tests avec mocks HTTP (httpx MockTransport)

### Phase 4 — Fonctions Système & Agent (Semaine 4)

- [ ] `bash_py` (OS detection + subprocess + sandbox Docker)
- [ ] `bash/command_validator.py` (blacklist étendue)
- [ ] `agent_py` (appel API Node.js interne + compteur profondeur)
- [ ] Tests d'intégration `bash_py` (nécessite Docker)

### Phase 5 — Seed & Intégration Complète (Semaine 5)

- [ ] `native/registry.py` avec `seed_native_functions()`
- [ ] Appel du seed dans le lifespan FastAPI au démarrage
- [ ] Vérification que les 11 fonctions apparaissent dans Phil > Fonctions > Bibliothèque
- [ ] Test end-to-end : agent utilise `web_search_py` + `write_py` dans le prototypage
- [ ] Vérification isolation multi-utilisateur (user A ne voit pas les fichiers de user B)
- [ ] Rate limiting opérationnel sur toutes les fonctions

### Phase 6 — Documentation & Tests de Charge (Semaine 6)

- [ ] Fichiers `SKILL.md` pour chaque groupe de fonctions (filesystem, web, todo, bash, agent)
- [ ] Tests de charge : 10 utilisateurs simultanés utilisant les fonctions filesystem
- [ ] Validation sécurité : pentest basique (path traversal, SSRF, injection NoSQL, fork bomb)
- [ ] Documentation opérationnelle : comment ajouter une nouvelle fonction native

---

## Variables d'Environnement Nouvelles (à ajouter au .env)

```bash
# Sidecar Python
PYTHON_SIDECAR_URL=http://python-sidecar:8001

# Workspace
WORKSPACE_ROOT=/app/users                    # Dans le container
WORKSPACE_ROOT_HOST=./backend/python/users   # Sur l'hôte (pour dev)

# Recherche web
SEARXNG_URL=http://searxng:8080              # Recommandé (self-hosted)
BRAVE_SEARCH_API_KEY=                        # Optionnel
SEARCH_ENGINE=auto                           # auto | searxng | brave | duckduckgo

# Sécurité sandbox
MAX_AGENT_DEPTH=3
SANDBOX_MAX_EXEC_TIME=30
SANDBOX_MAX_MEMORY_MB=256
```

---

*Document préparé pour l'Agent Architecte et les Agents Développeurs — Mars 2026*
*Suite de : Plan — Fonctions Personnalisées pour Agents IA (Partie 1)*
