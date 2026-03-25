

# Rapport d'Architecture : Sandboxing des Tools Utilisateurs

## Application d'Orchestration d'Agents IA

*Date : Juin 2025 — Projection Architecture 2026*
*Statut : Recommandations Architecturales*

---

## 1. Résumé Exécutif

L'approche **"1 container Docker persistant par utilisateur"** proposée par vos architectes est **fonctionnelle mais sous-optimale**. Elle pose des problèmes majeurs de **consommation de ressources au repos**, de **scalabilité**, et de **surface d'attaque permanente**. Ce rapport propose une architecture alternative basée sur des **containers éphémères à la demande**, plus alignée avec les pratiques de 2026 et votre stack existante.

---

## 2. Analyse Critique de la Solution Proposée

### 2.1 Architecture proposée : Container persistant par utilisateur

```
Utilisateur → Création compte → Container Alpine dédié (persistant)
                                    ├── Runtime TS/Python
                                    ├── Tools custom
                                    └── Volume persistant
```

### 2.2 Points positifs

| Aspect | Évaluation |
|--------|-----------|
| Isolation forte | ✅ Chaque user dans son namespace |
| Simplicité conceptuelle | ✅ 1 user = 1 container, facile à raisonner |
| Compatible stack Docker existante | ✅ Pas de nouvelle techno |
| Alpine léger (~5 MB base) | ✅ Empreinte image minimale |

### 2.3 Problèmes critiques identifiés

```
❌ RESSOURCES : 500 users = 500 containers idle en permanence
               Même au repos : ~10-30 MB RAM + PID + network namespace par container
               → 5-15 GB RAM gaspillés pour des containers qui ne font RIEN 95% du temps

❌ SCALABILITÉ : Docker daemon unique = bottleneck
                 Gestion de milliers de containers persistants = ingérable
                 docker ps → timeout avec 2000+ containers

❌ SÉCURITÉ : Surface d'attaque PERMANENTE
              Un container idle reste un vecteur d'attaque 24/7
              Processus long-running = plus de temps pour une exploitation
              Network namespace permanent = risque de lateral movement

❌ DÉMARRAGE À FROID : Si on éteint pour économiser → latence au réveil
                       Si on garde allumé → gaspillage
                       Dilemme sans bonne solution

❌ MAINTENANCE : Mise à jour de l'image = recréer TOUS les containers
                 Drift de configuration entre containers anciens et nouveaux
                 Monitoring de centaines de containers zombie
```

### 2.4 Verdict

> **La solution fonctionne pour 10-50 utilisateurs en phase MVP.** Elle devient un cauchemar opérationnel au-delà. L'architecture doit être pensée pour scaler dès maintenant, sans sur-ingénierie, mais en choisissant le bon pattern.

---

## 3. Solution Recommandée : Containers Éphémères à la Demande

### 3.1 Principe fondamental

```
NE PAS maintenir de container vivant.
Spawner un container à chaque EXÉCUTION de Tool, puis le détruire.
```

### 3.2 Architecture cible

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND REACT                       │
│                   (Map / Nodes / Tool Editor)                │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket / REST
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND NODE.JS / TS                      │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Tool        │  │ Sandbox      │  │ Agent             │  │
│  │ Registry    │  │ Orchestrator │  │ Orchestrator      │  │
│  │ (MongoDB)   │  │ (Core)       │  │ (existant)        │  │
│  └──────┬──────┘  └──────┬───────┘  └───────────────────┘  │
│         │                │                                   │
│         │    ┌───────────┴────────────┐                     │
│         │    │   Execution Engine     │                     │
│         │    │                        │                     │
│         │    │  ┌──────────────────┐  │                     │
│         │    │  │ Container Pool   │  │                     │
│         │    │  │ Manager          │  │                     │
│         │    │  └────────┬─────────┘  │                     │
│         │    └───────────┼────────────┘                     │
└─────────┼────────────────┼──────────────────────────────────┘
          │                │
          ▼                ▼
┌──────────────┐  ┌─────────────────────────────────────────┐
│   MongoDB    │  │            DOCKER ENGINE                 │
│              │  │                                         │
│ • Users      │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│ • Tools code │  │  │ sandbox │ │ sandbox │ │ sandbox │  │
│ • Workflows  │  │  │ user-A  │ │ user-B  │ │ user-A  │  │
│ • Configs    │  │  │ tool-X  │ │ tool-Y  │ │ tool-Z  │  │
│ • Results    │  │  │ (25s)   │ │ (3s)    │ │ (10s)   │  │
│              │  │  │ 💀 auto │ │ 💀 auto │ │ 💀 auto │  │
│              │  │  └─────────┘ └─────────┘ └─────────┘  │
│              │  │                                         │
│              │  │  Image préchauffée : sandbox-runtime    │
│              │  │  ├── Node 22 + ts-node                  │
│              │  │  ├── Python 3.12 + pip cache            │
│              │  │  └── ~150 MB optimisée                  │
└──────────────┘  └─────────────────────────────────────────┘
```

### 3.3 Flux d'exécution d'un Tool custom

```
                    Temps total cible : < 2 secondes
                    
User clique "Run"
       │
       ▼
[1] Backend reçoit la requête (Tool ID + inputs)
       │
       ▼
[2] Tool Registry → récupère le code source depuis MongoDB
       │
       ▼
[3] Sandbox Orchestrator :
       ├── Détecte le langage (TS ou Python)
       ├── Sélectionne l'image runtime appropriée
       ├── Prépare le payload d'exécution
       │
       ▼
[4] Container Pool Manager :
       ├── Option A : Prend un container PRÉ-CHAUFFÉ du pool ⚡ (~200ms)
       ├── Option B : Crée un nouveau container à la volée (~800ms)
       │
       ▼
[5] Injection & Exécution :
       ├── Monte le code en volume tmpfs (jamais COPY)
       ├── Injecte les variables d'environnement (inputs, API keys)
       ├── Exécute avec timeout strict (30s par défaut)
       ├── Capture stdout/stderr en streaming → WebSocket vers le front
       │
       ▼
[6] Récupération résultat :
       ├── Parse stdout JSON structuré
       ├── Stocke le résultat dans MongoDB
       ├── Retourne au frontend via WebSocket
       │
       ▼
[7] Nettoyage :
       ├── Container DÉTRUIT (docker rm -f)
       ├── Volume tmpfs libéré
       └── Métriques enregistrées
```

---

## 4. Implémentation Technique Détaillée

### 4.1 Image Runtime Sandboxée

```dockerfile
# Dockerfile.sandbox-runtime
FROM node:22-alpine AS base

# Python support
RUN apk add --no-cache python3 py3-pip

# Créer un user non-root
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox

# Pré-installer les dépendances courantes pour les Tools
RUN npm install -g tsx typescript@5 \
    && pip install --break-system-packages \
       requests numpy pandas httpx pydantic

# Répertoire d'exécution
WORKDIR /sandbox
RUN chown sandbox:sandbox /sandbox

# Script d'entrée générique
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER sandbox

# Pas de CMD : sera fourni au runtime
ENTRYPOINT ["/entrypoint.sh"]
```

```bash
#!/bin/sh
# entrypoint.sh — Point d'entrée universel

set -e

LANG="${SANDBOX_LANG:-typescript}"
CODE_FILE="/sandbox/tool.${SANDBOX_EXT:-ts}"
TIMEOUT="${SANDBOX_TIMEOUT:-30}"

# Écriture du code injecté via variable d'environnement
echo "$SANDBOX_CODE" > "$CODE_FILE"

# Exécution avec timeout
case "$LANG" in
  typescript)
    timeout "$TIMEOUT" tsx "$CODE_FILE"
    ;;
  python)
    timeout "$TIMEOUT" python3 "$CODE_FILE"
    ;;
  *)
    echo '{"error": "Unsupported language"}' >&2
    exit 1
    ;;
esac
```

### 4.2 Sandbox Orchestrator — Code Backend

```typescript
// src/sandbox/SandboxOrchestrator.ts

import Docker from 'dockerode';
import { EventEmitter } from 'events';
import { Tool, ExecutionResult, SandboxConfig } from '../types';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ─── Configuration des limites par défaut ───
const DEFAULT_LIMITS: SandboxConfig = {
  memory:      128 * 1024 * 1024,  // 128 MB
  memorySwap:  128 * 1024 * 1024,  // Pas de swap
  cpuQuota:    50_000,              // 50% d'un CPU
  cpuPeriod:   100_000,
  pidsLimit:   64,                  // Max 64 processus
  timeout:     30_000,              // 30 secondes
  networkMode: 'none',             // PAS DE RÉSEAU par défaut
  readonlyFs:  true,
};

// ─── Limites par tier utilisateur ───
const TIER_LIMITS: Record<string, Partial<SandboxConfig>> = {
  free: {
    memory:   64 * 1024 * 1024,
    timeout:  10_000,
    cpuQuota: 25_000,
  },
  pro: {
    memory:   256 * 1024 * 1024,
    timeout:  60_000,
    cpuQuota: 100_000,
    networkMode: 'sandbox-net', // Réseau restreint pour appels API
  },
  enterprise: {
    memory:   512 * 1024 * 1024,
    timeout:  120_000,
    cpuQuota: 200_000,
    networkMode: 'sandbox-net',
  },
};

export class SandboxOrchestrator extends EventEmitter {

  // ─── Exécution principale ───
  async executeTool(
    userId: string,
    tool: Tool,
    inputs: Record<string, unknown>,
    userTier: string = 'free'
  ): Promise<ExecutionResult> {

    const config = {
      ...DEFAULT_LIMITS,
      ...TIER_LIMITS[userTier],
    };

    const startTime = Date.now();
    let container: Docker.Container | null = null;

    try {
      // 1. Validation du code AVANT exécution
      this.validateToolCode(tool.code, tool.language);

      // 2. Créer le container éphémère
      container = await docker.createContainer({
        Image: 'sandbox-runtime:latest',
        Env: [
          `SANDBOX_LANG=${tool.language}`,
          `SANDBOX_EXT=${tool.language === 'typescript' ? 'ts' : 'py'}`,
          `SANDBOX_TIMEOUT=${Math.floor(config.timeout / 1000)}`,
          `SANDBOX_CODE=${tool.code}`,
          `TOOL_INPUTS=${JSON.stringify(inputs)}`,
          // Injecter les API keys si le tool les requiert
          ...this.resolveApiKeys(userId, tool.requiredSecrets),
        ],
        HostConfig: {
          Memory:      config.memory,
          MemorySwap:  config.memorySwap,
          CpuQuota:    config.cpuQuota,
          CpuPeriod:   config.cpuPeriod,
          PidsLimit:   config.pidsLimit,
          NetworkMode: config.networkMode,
          ReadonlyRootfs: config.readonlyFs,
          // Monter un tmpfs pour les écritures temporaires
          Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=32m' },
          // Interdire l'escalade de privilèges
          SecurityOpt: ['no-new-privileges:true'],
          CapDrop: ['ALL'],
          // Pas d'accès au Docker socket !
          AutoRemove: false, // On gère nous-mêmes pour capturer les logs
        },
        // Labels pour le monitoring et le cleanup
        Labels: {
          'sandbox.user':    userId,
          'sandbox.tool':    tool.id,
          'sandbox.created': new Date().toISOString(),
          'managed-by':      'sandbox-orchestrator',
        },
      });

      // 3. Démarrer et attendre
      await container.start();

      // 4. Attendre la fin avec timeout applicatif
      const waitResult = await Promise.race([
        container.wait(),
        this.timeoutPromise(config.timeout),
      ]);

      // 5. Récupérer les logs
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
      });

      const { stdout, stderr } = this.parseLogs(logs);

      // 6. Construire le résultat
      return {
        success:   waitResult.StatusCode === 0,
        output:    this.parseOutput(stdout),
        logs:      stderr,
        duration:  Date.now() - startTime,
        exitCode:  waitResult.StatusCode,
      };

    } catch (error: any) {
      // Timeout ou erreur système
      if (error.message === 'SANDBOX_TIMEOUT') {
        // Kill forcé
        if (container) await container.kill().catch(() => {});
        return {
          success:  false,
          output:   null,
          logs:     `Execution timeout after ${config.timeout}ms`,
          duration: Date.now() - startTime,
          exitCode: 124,
        };
      }
      throw error;

    } finally {
      // 7. TOUJOURS nettoyer le container
      if (container) {
        await container.remove({ force: true }).catch((err) => {
          console.error(`Failed to remove container: ${err.message}`);
        });
      }
    }
  }

  // ─── Validation statique du code ───
  private validateToolCode(code: string, language: string): void {
    const FORBIDDEN_PATTERNS = [
      /require\s*\(\s*['"]child_process['"]\s*\)/,
      /require\s*\(\s*['"]cluster['"]\s*\)/,
      /import\s+.*from\s+['"]child_process['"]/,
      /process\.exit/,
      /eval\s*\(/,
      /Function\s*\(/,
      /import\s+os/,         // Python
      /import\s+subprocess/, // Python
      /import\s+shutil/,     // Python
      /__import__/,          // Python
    ];

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) {
        throw new Error(
          `Forbidden pattern detected: ${pattern.source}`
        );
      }
    }

    // Limite de taille du code
    if (Buffer.byteLength(code, 'utf8') > 512 * 1024) {
      throw new Error('Tool code exceeds 512KB limit');
    }
  }

  // ─── Helpers ───
  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SANDBOX_TIMEOUT')), ms)
    );
  }

  private resolveApiKeys(
    userId: string,
    secrets: string[]
  ): string[] {
    // Récupérer les secrets chiffrés depuis MongoDB
    // et les injecter comme variables d'environnement
    return secrets.map(s => `SECRET_${s.toUpperCase()}=***`);
  }

  private parseLogs(buffer: Buffer): { stdout: string; stderr: string } {
    // Docker multiplexe stdout/stderr avec un header de 8 bytes
    // Implémentation simplifiée
    return {
      stdout: buffer.toString('utf8'),
      stderr: '',
    };
  }

  private parseOutput(stdout: string): unknown {
    try {
      // On attend un JSON en dernière ligne
      const lines = stdout.trim().split('\n');
      return JSON.parse(lines[lines.length - 1]);
    } catch {
      return stdout;
    }
  }
}
```

### 4.3 Pool de Containers Pré-chauffés (Optimisation Cold Start)

```typescript
// src/sandbox/ContainerPool.ts

/**
 * Maintient un pool PETIT de containers "chauds" déjà démarrés
 * en attente d'injection de code. Réduit le cold start de ~800ms à ~200ms.
 *
 * Différence clé avec l'approche "1 container/user" :
 * - Les containers du pool sont VIERGES et INTERCHANGEABLES
 * - Ils ne contiennent AUCUNE donnée utilisateur
 * - Le pool est petit (5-20 containers) vs N containers
 */

import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

interface PooledContainer {
  container: Docker.Container;
  language: 'typescript' | 'python';
  createdAt: Date;
}

export class ContainerPool {
  private pool: Map<string, PooledContainer[]> = new Map();
  
  private readonly POOL_SIZE = {
    typescript: 5,  // 5 containers TS chauds
    python: 3,      // 3 containers Python chauds
  };

  private readonly MAX_AGE_MS = 5 * 60 * 1000; // Recycler après 5 min

  constructor() {
    // Remplir le pool au démarrage
    this.warmUp();
    // Maintenance périodique
    setInterval(() => this.maintain(), 30_000);
  }

  async warmUp(): Promise<void> {
    for (const [lang, size] of Object.entries(this.POOL_SIZE)) {
      const existing = this.pool.get(lang)?.length ?? 0;
      const needed = size - existing;
      
      for (let i = 0; i < needed; i++) {
        const pooled = await this.createWarmContainer(
          lang as 'typescript' | 'python'
        );
        
        if (!this.pool.has(lang)) this.pool.set(lang, []);
        this.pool.get(lang)!.push(pooled);
      }
    }
    
    console.log(`[Pool] Warmed up: TS=${this.pool.get('typescript')?.length}, PY=${this.pool.get('python')?.length}`);
  }

  /**
   * Récupère un container chaud du pool OU en crée un à la volée
   */
  async acquire(language: 'typescript' | 'python'): Promise<Docker.Container> {
    const available = this.pool.get(language);

    if (available && available.length > 0) {
      const pooled = available.shift()!;
      // Remplacer de façon asynchrone (ne pas bloquer)
      this.replenishAsync(language);
      return pooled.container;
    }

    // Fallback : création à la volée
    const fresh = await this.createWarmContainer(language);
    return fresh.container;
  }

  private async createWarmContainer(
    language: 'typescript' | 'python'
  ): Promise<PooledContainer> {
    const container = await docker.createContainer({
      Image: 'sandbox-runtime:latest',
      Env: [`SANDBOX_LANG=${language}`],
      // Le container démarre et attend sur stdin
      Cmd: ['sleep', '300'], // Reste vivant 5 min max
      HostConfig: {
        Memory:         128 * 1024 * 1024,
        MemorySwap:     128 * 1024 * 1024,
        CpuQuota:       50_000,
        CpuPeriod:      100_000,
        PidsLimit:      64,
        NetworkMode:    'none',
        ReadonlyRootfs: true,
        Tmpfs:          { '/tmp': 'rw,noexec,nosuid,size=32m' },
        SecurityOpt:    ['no-new-privileges:true'],
        CapDrop:        ['ALL'],
      },
      Labels: {
        'sandbox.pool':    'warm',
        'sandbox.lang':    language,
        'managed-by':      'sandbox-orchestrator',
      },
    });

    await container.start();

    return {
      container,
      language,
      createdAt: new Date(),
    };
  }

  private async replenishAsync(language: 'typescript' | 'python') {
    try {
      const pooled = await this.createWarmContainer(language);
      if (!this.pool.has(language)) this.pool.set(language, []);
      this.pool.get(language)!.push(pooled);
    } catch (err) {
      console.error(`[Pool] Failed to replenish ${language}:`, err);
    }
  }

  private async maintain(): Promise<void> {
    const now = Date.now();
    
    for (const [lang, containers] of this.pool.entries()) {
      const expired = containers.filter(
        c => now - c.createdAt.getTime() > this.MAX_AGE_MS
      );
      
      for (const old of expired) {
        await old.container.remove({ force: true }).catch(() => {});
        const idx = containers.indexOf(old);
        if (idx >= 0) containers.splice(idx, 1);
      }
    }

    // Re-remplir
    await this.warmUp();
  }

  async shutdown(): Promise<void> {
    for (const [, containers] of this.pool.entries()) {
      for (const c of containers) {
        await c.container.remove({ force: true }).catch(() => {});
      }
    }
    this.pool.clear();
  }
}
```

### 4.4 Contrat d'interface pour les Tools utilisateurs

```typescript
// Template TypeScript fourni aux utilisateurs dans l'éditeur de Tools

// ═══ TOOL TEMPLATE (TypeScript) ═══
// Les inputs sont injectés via la variable d'environnement TOOL_INPUTS
// La sortie DOIT être un JSON valide écrit sur stdout (dernière ligne)

interface ToolContext {
  inputs: Record<string, unknown>;
  secrets: Record<string, string>;
}

function getContext(): ToolContext {
  return {
    inputs: JSON.parse(process.env.TOOL_INPUTS || '{}'),
    secrets: Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => k.startsWith('SECRET_'))
        .map(([k, v]) => [k.replace('SECRET_', '').toLowerCase(), v!])
    ),
  };
}

// ═══ VOTRE CODE ICI ═══
async function execute(ctx: ToolContext): Promise<unknown> {
  const { inputs, secrets } = ctx;
  
  // Exemple :
  return {
    result: `Hello ${inputs.name}`,
    timestamp: new Date().toISOString(),
  };
}

// ═══ EXÉCUTION (ne pas modifier) ═══
execute(getContext())
  .then(result => console.log(JSON.stringify(result)))
  .catch(err => {
    console.error(err.message);
    process.exit(1);
  });
```

```python
# Template Python fourni aux utilisateurs

# ═══ TOOL TEMPLATE (Python) ═══
import os, json, sys

def get_context():
    return {
        "inputs": json.loads(os.environ.get("TOOL_INPUTS", "{}")),
        "secrets": {
            k.replace("SECRET_", "").lower(): v
            for k, v in os.environ.items()
            if k.startswith("SECRET_")
        },
    }

# ═══ VOTRE CODE ICI ═══
def execute(ctx: dict):
    inputs = ctx["inputs"]
    
    # Exemple :
    return {
        "result": f"Hello {inputs.get('name', 'World')}",
    }

# ═══ EXÉCUTION (ne pas modifier) ═══
if __name__ == "__main__":
    try:
        result = execute(get_context())
        print(json.dumps(result))
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
```

---

## 5. Sécurité — Défense en Profondeur

### 5.1 Les 6 couches de sécurité

```
┌───────────────────────────────────────────────────┐
│  COUCHE 6 : Rate Limiting & Quotas               │
│  → Max 10 exécutions/min/user (free)              │
│  → Max 3 containers simultanés/user               │
├───────────────────────────────────────────────────┤
│  COUCHE 5 : Validation Statique du Code           │
│  → Patterns interdits (child_process, eval, os)   │
│  → Taille max du code (512 KB)                    │
│  → AST analysis pour TS (optionnel, phase 2)      │
├───────────────────────────────────────────────────┤
│  COUCHE 4 : Isolation Container                   │
│  → User non-root (sandbox:sandbox)                │
│  → CapDrop ALL                                    │
│  → no-new-privileges                              │
│  → ReadOnly rootfs + tmpfs limité                 │
├───────────────────────────────────────────────────┤
│  COUCHE 3 : Limites de Ressources                 │
│  → Memory hard limit (128 MB)                     │
│  → CPU quota (50%)                                │
│  → PID limit (64)                                 │
│  → Timeout strict (30s)                           │
├───────────────────────────────────────────────────┤
│  COUCHE 2 : Isolation Réseau                      │
│  → NetworkMode: none (défaut)                     │
│  → Réseau dédié avec egress rules (tier pro)      │
│  → Pas d'accès au réseau Docker interne           │
├───────────────────────────────────────────────────┤
│  COUCHE 1 : Isolation Host                        │
│  → Seccomp profile restrictif                     │
│  → AppArmor / SELinux profile                     │
│  → Pas de mount du Docker socket                  │
│  → Pas de mode privileged                         │
└───────────────────────────────────────────────────┘
```

### 5.2 Profil Seccomp personnalisé

```json
// sandbox-seccomp.json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1,
  "archMap": [
    { "architecture": "SCMP_ARCH_X86_64", "subArchitectures": ["SCMP_ARCH_X86"] }
  ],
  "syscalls": [
    {
      "names": [
        "read", "write", "close", "fstat", "lseek", "mmap", "mprotect",
        "munmap", "brk", "access", "pipe", "select", "sched_yield",
        "dup", "dup2", "nanosleep", "getpid", "getuid", "getgid",
        "geteuid", "getegid", "getcwd", "openat", "readlink",
        "stat", "lstat", "poll", "epoll_create1", "epoll_ctl",
        "epoll_wait", "futex", "exit_group", "exit",
        "clock_gettime", "clock_getres", "getrandom",
        "newfstatat", "fcntl", "ioctl", "writev", "readv",
        "rt_sigaction", "rt_sigprocmask", "rt_sigreturn",
        "execve", "arch_prctl", "set_tid_address",
        "set_robust_list", "prlimit64", "sigaltstack"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

### 5.3 Réseau restreint pour les Tools nécessitant Internet (tier Pro)

```bash
#!/bin/bash
# setup-sandbox-network.sh

# Créer un réseau isolé avec restrictions
docker network create \
  --driver bridge \
  --internal=false \
  --opt com.docker.network.bridge.enable_icc=false \
  --opt com.docker.network.bridge.enable_ip_masquerade=true \
  --subnet 172.30.0.0/16 \
  sandbox-net

# Règles iptables : autoriser uniquement HTTPS sortant
iptables -I DOCKER-USER -s 172.30.0.0/16 -p tcp --dport 443 -j ACCEPT
iptables -I DOCKER-USER -s 172.30.0.0/16 -p tcp --dport 80  -j ACCEPT
iptables -I DOCKER-USER -s 172.30.0.0/16 -j DROP

# Bloquer l'accès aux métadonnées cloud et réseau interne
iptables -I DOCKER-USER -s 172.30.0.0/16 -d 169.254.169.254 -j DROP
iptables -I DOCKER-USER -s 172.30.0.0/16 -d 10.0.0.0/8      -j DROP
iptables -I DOCKER-USER -s 172.30.0.0/16 -d 172.16.0.0/12    -j DROP
iptables -I DOCKER-USER -s 172.30.0.0/16 -d 192.168.0.0/16   -j DROP
```

---

## 6. Gestion de la Persistance des Tools

### 6.1 Schéma MongoDB

```typescript
// src/models/Tool.ts

interface ITool {
  _id: ObjectId;
  userId: ObjectId;                          // Propriétaire
  
  // ─── Métadonnées ───
  name: string;
  description: string;
  version: string;                           // Semver
  language: 'typescript' | 'python';
  visibility: 'private' | 'shared' | 'marketplace';
  tags: string[];
  
  // ─── Code source ───
  code: string;                              // Le code du tool
  entryFunction: string;                     // Nom de la fonction principale
  
  // ─── Interface ───
  inputSchema: JSONSchema7;                  // Schéma JSON des inputs
  outputSchema: JSONSchema7;                 // Schéma JSON des outputs attendus
  requiredSecrets: string[];                 // Clés API nécessaires
  
  // ─── Exécution ───
  sandboxConfig: {
    timeout: number;                         // Override du timeout
    memoryMB: number;                        // Override mémoire
    networkAccess: boolean;                  // Besoin réseau ?
    dependencies: string[];                  // npm/pip packages additionnels
  };
  
  // ─── Historique ───
  versions: Array<{
    version: string;
    code: string;
    createdAt: Date;
    changelog: string;
  }>;
  
  // ─── Stats ───
  stats: {
    totalExecutions: number;
    avgDuration: number;
    successRate: number;
    lastExecutedAt: Date;
  };
  
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.2 Gestion des dépendances personnalisées (Phase 2)

```typescript
// Quand un tool déclare des dépendances npm/pip non incluses
// dans l'image de base → Build d'une image dérivée cachée

interface DependencyResolver {
  /**
   * Vérifie si une image avec ces dépendances existe déjà
   * Sinon, build une image dérivée et la cache
   */
  resolveImage(
    baseImage: string,
    language: 'typescript' | 'python',
    dependencies: string[]
  ): Promise<string>; // Retourne le nom de l'image à utiliser
}

// L'image dérivée est taguée avec un hash des dépendances :
// sandbox-runtime:ts-<sha256(deps)>
// Permet le cache : même deps = même image, pas de rebuild
```

---

## 7. Monitoring & Cleanup

### 7.1 Garbage Collector de sécurité

```typescript
// src/sandbox/GarbageCollector.ts

/**
 * Filet de sécurité : détruit tout container sandbox
 * qui aurait survécu au cleanup normal
 */
export class SandboxGarbageCollector {
  
  private readonly MAX_CONTAINER_AGE_MS = 5 * 60 * 1000; // 5 min max
  
  start(intervalMs: number = 30_000): void {
    setInterval(() => this.sweep(), intervalMs);
  }

  private async sweep(): Promise<void> {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: ['managed-by=sandbox-orchestrator'],
      },
    });

    const now = Date.now();

    for (const info of containers) {
      const age = now - info.Created * 1000;
      
      // Pool containers vivants depuis trop longtemps
      if (age > this.MAX_CONTAINER_AGE_MS) {
        console.warn(
          `[GC] Killing stale sandbox container ${info.Id.slice(0, 12)} ` +
          `(age: ${Math.round(age / 1000)}s, ` +
          `user: ${info.Labels['sandbox.user'] || 'pool'})`
        );
        
        const container = docker.getContainer(info.Id);
        await container.remove({ force: true }).catch(() => {});
      }
    }
  }
}
```

### 7.2 Métriques essentielles

```typescript
// Métriques à stocker dans MongoDB pour le dashboard admin

interface SandboxMetrics {
  timestamp: Date;
  
  // Par exécution
  executionId: string;
  userId: string;
  toolId: string;
  language: string;
  duration: number;
  exitCode: number;
  memoryPeakMB: number;
  
  // Agrégées (cron toutes les minutes)
  activeContainers: number;
  poolSize: { typescript: number; python: number };
  queueDepth: number;
  avgStartupMs: number;
  executionsPerMinute: number;
}
```

---

## 8. Comparaison Synthétique des Approches

```
┌─────────────────────┬─────────────────────────┬─────────────────────────┐
│     Critère         │  Container Persistant   │  Container Éphémère     │
│                     │  (votre proposition)    │  (ma recommandation)    │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ RAM au repos        │  ❌ N × 10-30 MB        │  ✅ Pool × 10 MB        │
│ (500 users)         │  ~15 GB                 │  ~80 MB (8 containers)  │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ Scalabilité         │  ❌ Linéaire avec users  │  ✅ Linéaire avec usage │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ Surface d'attaque   │  ❌ Permanente           │  ✅ Transitoire (sec)   │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ Cold start          │  ✅ ~0ms (déjà up)       │  ⚡ ~200ms (pool chaud) │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ Maintenance image   │  ❌ Recréer N containers │  ✅ Rebuild 1 image     │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ Isolation inter-    │  ✅ Forte               │  ✅ Forte + éphémère    │
│ utilisateurs        │                         │                         │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ Complexité          │  ✅ Simple               │  ⚠️ Moyenne             │
│ d'implémentation    │                         │  (pool + lifecycle)     │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ Persistance state   │  ✅ Natif (volume)       │  ✅ Via MongoDB          │
│ utilisateur         │                         │  (plus propre)          │
├─────────────────────┼─────────────────────────┼─────────────────────────┤
│ Coût infra          │  ❌ Élevé               │  ✅ Minimal              │
│ (serveur 32 GB)     │  ~1000 users max        │  ~10000+ exéc/jour      │
└─────────────────────┴─────────────────────────┴─────────────────────────┘
```

---

## 9. Évolution vers Skills & Projets Git (Phase 2)

```
Phase 1 (maintenant) : Tools simples
  → 1 fichier, exécution ponctuelle, containers éphémères

Phase 2 (Skills) : Ajout de volumes éphémères par exécution
  → Le code d'un skill est cloné depuis Git dans un volume tmpfs
  → Le volume est monté read-only dans le container éphémère
  → Toujours éphémère, juste plus de fichiers à injecter

Phase 3 (Projets Git) : Ajout d'un build step
  → git clone → build → cache de l'image résultante
  → Image taguée : sandbox-project:<userId>-<repoHash>-<commitHash>
  → Le container d'exécution utilise cette image buildée
  → Le build lui-même tourne dans un container éphémère !

                    ┌──────────────────┐
                    │   Git Webhook    │
                    │   ou UI Trigger  │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Build Container │ (éphémère)
                    │  - git clone     │
                    │  - npm install   │
                    │  - tsc build     │
                    │  → docker commit │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Image Cachée    │
                    │  sandbox-project │
                    │  :userId-hash    │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Run Container   │ (éphémère)
                    │  Même pattern    │
                    │  que Phase 1     │
                    └──────────────────┘
```

---

## 10. Plan d'Implémentation

```
Semaine 1-2 : Foundation
  ├── Build de l'image sandbox-runtime
  ├── SandboxOrchestrator (exécution basique)
  ├── Tests : TS tool simple, Python tool simple
  └── Profil seccomp + security hardening

Semaine 3 : Pool & Performance
  ├── ContainerPool (warm containers)
  ├── Benchmarks cold start vs warm start
  └── Rate limiting par utilisateur

Semaine 4 : Intégration
  ├── API REST/WebSocket pour déclencher l'exécution
  ├── Streaming des logs vers le frontend
  ├── Stockage des résultats dans MongoDB
  └── GarbageCollector

Semaine 5 : Production Readiness
  ├── Monitoring & alerting
  ├── Tests de charge (100 exécutions concurrentes)
  ├── Tests de sécurité (escape attempts)
  └── Documentation utilisateur (Tool templates)
```

---

## 11. Conclusion & Recommandation Finale

| | |
|---|---|
| **Ne faites pas** | Un container persistant par utilisateur |
| **Faites** | Des containers éphémères avec un petit pool pré-chauffé |
| **Raison #1** | Vous payez les ressources à l'**usage**, pas au **nombre d'inscrits** |
| **Raison #2** | La sécurité est **structurellement meilleure** quand rien ne persiste |
| **Raison #3** | Le pattern s'étend naturellement aux Skills et projets Git |

> **L'architecture éphémère est le standard de l'industrie en 2026** (AWS Lambda, Cloudflare Workers, Fly Machines — tous éphémères). Votre Docker local peut reproduire ce pattern sans aucune dépendance cloud, gratuitement, avec la stack que vous avez déjà.