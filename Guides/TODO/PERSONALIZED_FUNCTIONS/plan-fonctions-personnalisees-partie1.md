# Plan — Fonctions Personnalisées pour Agents IA
## Module Phil > Fonctions Personnalisées · Intégration Archi > Prototypage

> **Destinataires** : Agent Architecte + Agents Développeurs  
> **Stack** : TypeScript / React (frontend) · Node.js / Python (backend)  
> **Périmètre** : Conception UI/UX, architecture technique, contrats d'API, sécurité d'exécution, intégration au système existant  
> **Version** : 1.0 — Mars 2026

---

## Table des Matières

**PARTIE 1 — Interface & Architecture du Module**

- [1. Vue d'Ensemble & Positionnement](#1-vue-densemble--positionnement)
- [2. Page Phil > Fonctions Personnalisées](#2-page-phil--fonctions-personnalisées)
  - [2.1 Onglet « Bibliothèque »](#21-onglet--bibliothèque-)
  - [2.2 Onglet « Éditeur »](#22-onglet--éditeur-)
  - [2.3 Console d'Exécution Sécurisée](#23-console-dexécution-sécurisée)
- [3. Intégration Archi > Prototypage](#3-intégration-archi--prototypage)
- [4. Contrats de Données & API Backend](#4-contrats-de-données--api-backend)
- [5. Architecture d'Exécution Sécurisée](#5-architecture-dexécution-sécurisée)
- [6. Flux de Données Complet](#6-flux-de-données-complet)
- [7. Composants React — Spécifications Détaillées](#7-composants-react--spécifications-détaillées)
- [8. Implémentation Backend Node.js / Python](#8-implémentation-backend-nodejs--python)
- [9. Sécurité & Gouvernance](#9-sécurité--gouvernance)
- [10. Tests & Observabilité](#10-tests--observabilité)
- [11. Roadmap d'Implémentation](#11-roadmap-dimplémentation)

**PARTIE 2 — Fonctions Natives par Défaut** *(à compléter)*

---

# PARTIE 1 — Interface & Architecture du Module

---

## 1. Vue d'Ensemble & Positionnement

### 1.1 Objectif du Module

Le module **Phil > Fonctions Personnalisées** est le registre central et l'atelier de création des fonctions/tools disponibles pour les agents de l'application. Il remplit trois rôles :

1. **Bibliothèque** — inventaire complet de toutes les fonctions (natives + utilisateur), avec contrôle d'activation
2. **Atelier** — éditeur de code + console d'exécution sécurisée pour créer et tester des fonctions
3. **Source de vérité** — pont vers **Archi > Prototypage** qui consomme la liste des fonctions activées

### 1.2 Relation avec l'existant

```
┌─────────────────────────────────────────────────────────────────┐
│                     ÉTAT ACTUEL (existant)                      │
│                                                                 │
│  Archi > Prototypage                                            │
│  └─ Onglet "Appel de fonctions"                                 │
│       └─ Formulaire simple : nom / description / schéma JSON    │
│            (fonctions créées inline, stockées localement)       │
└─────────────────────────────────────────────────────────────────┘

                          ↓  ÉVOLUTION

┌─────────────────────────────────────────────────────────────────┐
│                     CIBLE (ce plan)                             │
│                                                                 │
│  Phil > Fonctions Personnalisées   ←──── SOURCE DE VÉRITÉ       │
│  ├─ Onglet Bibliothèque                                         │
│  │    └─ Liste toutes les fonctions (natives + custom)          │
│  │    └─ Toggle activer/désactiver par fonction                 │
│  └─ Onglet Éditeur + Console sécurisée                          │
│         └─ Créer / modifier / tester TypeScript ou Python       │
│                                                                 │
│       ↕  API REST  /api/functions                               │
│                                                                 │
│  Archi > Prototypage                                            │
│  └─ Onglet "Appel de fonctions"                                 │
│       └─ Charge uniquement les fonctions ACTIVÉES depuis Phil   │
│       └─ Conserve la saisie de nom/description/schéma custom    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Règles de Nommage (existantes, à respecter)

| Langage | Convention | Exemple |
|---|---|---|
| TypeScript / React | camelCase libre | `getWeatherForecast` |
| Python backend | suffixe `_py` obligatoire | `analyze_sentiment_py` |

### 1.4 Principes de Conception pour les Agents Développeurs

- **Découplage** : Phil > Fonctions Personnalisées ne connaît pas les agents ; Archi > Prototypage ne stocke pas de code de fonctions ; Bos > Carte du workflow > un agent IA ne ne stocke pas de code de fonctions ; 
- **Activation par flag** : une fonction existe dans le registre indépendamment de son activation ; l'activation ne concerne que sa visibilité dans le prototypage ou dans la bibliothèque de fonction d'un agent instancié sur la carte du workflow
- **Immutabilité des fonctions natives** : les fonctions livrées par défaut sont `readonly` dans l'éditeur mais peuvent être dupliquées pour être personnalisées
- **Convention > Configuration** : le suffixe `_py` suffit à router l'exécution vers Python sans configuration supplémentaire

---

## 2. Page Phil > Fonctions Personnalisées

### 2.1 Layout Général

```
┌──────────────────────────────────────────────────────────────────────┐
│  Phil > Fonctions Personnalisées                          [+ Nouvelle]│
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌─────────────────────────────────────┐   │
│  │  📚 Bibliothèque     │  │  ✏️  Éditeur                        │   │
│  └──────────────────────┘  └─────────────────────────────────────┘   │
│                                                                      │
│  [Contenu de l'onglet actif]                                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

### 2.1 Onglet « Bibliothèque »

#### 2.1.1 Wireframe

```
┌─ Bibliothèque ───────────────────────────────────────────────────────┐
│                                                                      │
│  🔍 [Rechercher une fonction...]   [Tout] [TypeScript] [Python]      │
│     Filtre : [Toutes] [Actives] [Natives] [Personnalisées]           │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ ● get_weather_forecast_py           Python  Météo  [Natif]   │    │
│  │   Récupère les prévisions météo pour une ville et une durée  │    │
│  │   Paramètres : city(str), days(int)   Retourne : WeatherData │    │
│  │                          [Voir] [Dupliquer]  ◉ Activée       │    │
│  ├──────────────────────────────────────────────────────────────┤    │
│  │ ● searchWeb_ts                   TypeScript  Recherche [Natif]│   │
│  │   Effectue une recherche web et retourne les N premiers ...  │    │
│  │   Paramètres : query(str), maxResults(int)  Retourne : [...]  │    │
│  │                          [Voir] [Dupliquer]  ○ Désactivée    │    │
│  ├──────────────────────────────────────────────────────────────┤    │
│  │ ● my_custom_analysis_py          Python  Analyse  [Custom]   │    │
│  │   Ma fonction d'analyse personnalisée                        │    │
│  │   Paramètres : data(obj), mode(str)    Retourne : Report     │    │
│  │                    [Voir] [Modifier] [Supprimer]  ◉ Activée  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Affichage : 3 / 47 fonctions   [< 1 2 3 ... >]                     │
└──────────────────────────────────────────────────────────────────────┘
```

#### 2.1.2 Carte de Fonction — Détail des Éléments

Chaque carte expose :

| Élément | Description |
|---|---|
| **Indicateur de statut** | Point coloré : vert = active, gris = inactive |
| **Nom** | Affiché tel quel, avec badge langage (TypeScript / Python) |
| **Tags de catégorie** | Météo, Recherche, Fichier, Données, IA, Custom… |
| **Badge origine** | `[Natif]` (readonly) ou `[Custom]` (éditable) |
| **Description courte** | 1 ligne, tronquée avec tooltip |
| **Résumé des paramètres** | Liste compacte : `param(type)` |
| **Type de retour** | Schéma de sortie résumé |
| **Actions contextuelles** | Selon origine (voir tableau ci-dessous) |
| **Toggle Activée/Désactivée** | Switch immédiat, persisté en base |

**Actions selon le type de fonction :**

| Action | Natif | Custom |
|---|---|---|
| Voir (lecture seule) | ✅ | ✅ |
| Modifier | ❌ | ✅ |
| Dupliquer (crée une copie Custom) | ✅ | ✅ |
| Supprimer | ❌ | ✅ |
| Activer / Désactiver | ✅ | ✅ |

#### 2.1.3 Comportement du Toggle d'Activation

```
Toggle ON  → fonction visible dans Archi > Prototypage > Appel de fonctions
Toggle OFF → fonction masquée du prototypage (mais toujours dans la bibliothèque)
```

Le toggle envoie immédiatement un `PATCH /api/functions/:id/activation` sans rechargement de page. Un toast de confirmation est affiché.

---

### 2.2 Onglet « Éditeur »

#### 2.2.1 Wireframe — Vue d'ensemble

```
┌─ Éditeur ────────────────────────────────────────────────────────────┐
│                                                                      │
│  MÉTADONNÉES                                                         │
│  ┌────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ Nom * [________________]   │  │ Langage  [TypeScript ▼]        │  │
│  └────────────────────────────┘  └────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Description * [____________________________________________]   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Tags  [Recherche ×] [IA ×]  [+ Ajouter tag]                   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──── Schéma d'entrée (JSON Schema) ─┐  ┌── Schéma de sortie ────┐  │
│  │ {                                  │  │ {                      │  │
│  │   "type": "object",               │  │   "type": "object",    │  │
│  │   "required": ["query"],          │  │   "properties": { ... }│  │
│  │   "properties": {                 │  │ }                      │  │
│  │     "query": { "type": "string" } │  │                        │  │
│  │   }                               │  │ [Valider ✓]            │  │
│  │ }  [Valider ✓]                    │  │                        │  │
│  └───────────────────────────────────┘  └────────────────────────┘  │
│                                                                      │
│  ┌─ Éditeur de Code ────────────────────────── [TypeScript] ──────┐  │
│  │  1  // Fonction custom TypeScript                              │  │
│  │  2  export async function myFunction(                          │  │
│  │  3    params: MyFunctionParams,                                │  │
│  │  4    context: FunctionContext                                 │  │
│  │  5  ): Promise<MyFunctionResult> {                             │  │
│  │  6    // Votre code ici                                        │  │
│  │  7  }                                                          │  │
│  │                                                    [Plein écran]│  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Console d'Exécution ──────────────────────────────────────────┐  │
│  │  [Voir §2.3]                                                   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│           [Annuler]  [Sauvegarder]  [Sauvegarder & Activer]         │
└──────────────────────────────────────────────────────────────────────┘
```

#### 2.2.2 Éditeur de Code — Spécifications

L'éditeur embarqué est **Monaco Editor** (le même moteur que VS Code), configuré avec :

| Fonctionnalité | Détail |
|---|---|
| **Coloration syntaxique** | TypeScript et Python natifs |
| **IntelliSense TypeScript** | Types `FunctionContext`, `FunctionResult` injectés automatiquement |
| **Linting Python** | Pyflakes via WebAssembly (pas de round-trip serveur) |
| **Autocomplétion** | Types locaux + globals de l'application |
| **Thème** | Dark par défaut, adaptable au thème de l'application |
| **Raccourcis** | `Ctrl+S` = Sauvegarder, `Ctrl+Enter` = Exécuter |
| **Taille** | Resizable, mode plein écran disponible |
| **Template automatique** | Squelette de code injecté à la création selon le langage choisi |

**Template TypeScript injecté à la création :**

```typescript
import type { FunctionContext, FunctionResult } from '@app/functions';

// Paramètres typés automatiquement depuis votre JSON Schema d'entrée
interface Params {
  // Vos paramètres ici
}

/**
 * NOM_FONCTION
 * DESCRIPTION_FONCTION
 */
export async function NOM_FONCTION(
  params: Params,
  context: FunctionContext
): Promise<FunctionResult> {
  const { logger, http, cache } = context;

  // Votre code ici
  logger.info('Exécution de NOM_FONCTION', { params });

  return {
    success: true,
    data: {}
  };
}
```

**Template Python injecté à la création :**

```python
"""
NOM_FONCTION_py
DESCRIPTION_FONCTION
"""
from typing import Any
from app.functions import FunctionContext, FunctionResult


async def NOM_FONCTION_py(
    params: dict[str, Any],
    context: FunctionContext
) -> FunctionResult:
    """
    Paramètres attendus (depuis JSON Schema):
      - param1 (type): description
    
    Retourne:
      FunctionResult avec data conforme au schéma de sortie
    """
    logger = context.logger
    logger.info(f"Exécution de NOM_FONCTION_py", extra={"params": params})

    # Votre code ici

    return FunctionResult(success=True, data={})
```

---

### 2.3 Console d'Exécution Sécurisée

#### 2.3.1 Objectif & Contraintes

La console permet à l'utilisateur de **tester sa fonction en isolation complète** avant de la sauvegarder ou l'activer. Elle doit être :

- **Sécurisée** : aucun accès aux données de production, aucun effet de bord persistant
- **Rapide** : feedback < 3 secondes pour les fonctions simples
- **Fidèle** : environnement identique à l'exécution réelle en production
- **Pédagogique** : logs clairs, affichage des erreurs avec stack trace, métriques

#### 2.3.2 Wireframe de la Console

```
┌─ Console d'Exécution ──────────────────────────────────────────────┐
│                                                                    │
│  Paramètres d'entrée (JSON)          ┌── Résultat ───────────────┐ │
│  ┌──────────────────────────────┐    │ ✅ Succès — 234 ms        │ │
│  │ {                            │    │                           │ │
│  │   "query": "test recherche", │    │ {                         │ │
│  │   "maxResults": 5            │    │   "results": [...],       │ │
│  │ }                            │    │   "total": 5              │ │
│  │                              │    │ }                         │ │
│  └──────────────────────────────┘    └───────────────────────────┘ │
│                                                                    │
│  ┌── Logs d'exécution ─────────────────────────────────────────┐  │
│  │ [INFO]  12:34:01  Démarrage sandbox (Python 3.12)           │  │
│  │ [INFO]  12:34:01  Paramètres validés ✓                      │  │
│  │ [INFO]  12:34:01  logger.info: Exécution de search_web_py   │  │
│  │ [INFO]  12:34:01  HTTP GET https://api.search.com/... 200   │  │
│  │ [INFO]  12:34:01  Résultat validé contre outputSchema ✓     │  │
│  │ [INFO]  12:34:01  Exécution terminée — 234 ms               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Sandbox : 🟢 Python 3.12 · Isolation: Docker  [Effacer]          │
│                         [▶  Exécuter]  [⏹  Arrêter]               │
└────────────────────────────────────────────────────────────────────┘
```

#### 2.3.3 Architecture du Sandbox d'Exécution

**Choix technique recommandé 2026 : conteneurs Docker éphémères via l'API Docker Engine**

Le backend Node.js pilote la création et destruction de containers Docker ultra-légers (basés sur des images pré-construites) pour chaque exécution de test.

```
Utilisateur clique [Exécuter]
       │
       ▼
Frontend → POST /api/functions/sandbox/run
       │
       ▼
SandboxService (Node.js)
  ├─ Valide le code (lint statique)
  ├─ Valide les paramètres d'entrée contre inputSchema
  ├─ Crée un container Docker éphémère :
  │    Image : app-sandbox-python:3.12 ou app-sandbox-node:22
  │    Limites : CPU=0.5, RAM=256MB, timeout=15s
  │    Réseau : bridge isolé (accès HTTP whitelist uniquement)
  │    Volume : /tmp/sandbox/{jobId}/ (read-write, purge après exec)
  ├─ Injecte le code + les paramètres
  ├─ Exécute et stream les logs via WebSocket
  ├─ Récupère stdout/stderr
  ├─ Détruit le container immédiatement
  └─ Retourne résultat + logs + métriques
```

**Alternatives selon l'infrastructure disponible :**

| Option | Isolation | Latence démarrage | Complexité | Recommandation |
|---|---|---|---|---|
| **Docker éphémère** | ⭐⭐⭐⭐⭐ | ~800ms | Moyenne | ✅ **Recommandé** |
| **gVisor / runsc** | ⭐⭐⭐⭐⭐ | ~1.2s | Haute | Si haute sécurité requise |
| **Pyodide (WASM)** | ⭐⭐⭐ | ~200ms | Faible | Python pur sans I/O |
| **vm2 / isolated-vm** | ⭐⭐⭐ | ~50ms | Faible | TypeScript uniquement |
| **Firecracker microVM** | ⭐⭐⭐⭐⭐ | ~125ms | Très haute | Production à grande échelle |

**Recommandation 2026** : Docker éphémère pour Python, `isolated-vm` pour TypeScript (car la librairie `isolated-vm` est mature, maintenue et très performante pour Node.js).

#### 2.3.4 Implémentation — SandboxService Node.js

```typescript
// backend/src/functions/sandbox/sandbox.service.ts

import Docker from 'dockerode';
import { v4 as uuid } from 'uuid';

export interface SandboxRunRequest {
  code: string;
  language: 'typescript' | 'python';
  params: Record<string, unknown>;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  timeoutMs?: number;
}

export interface SandboxRunResult {
  success: boolean;
  data?: unknown;
  error?: string;
  logs: SandboxLogEntry[];
  durationMs: number;
  memoryUsedMb?: number;
}

export class SandboxService {
  private docker = new Docker();
  private readonly IMAGES = {
    python: 'app-sandbox-python:3.12',
    typescript: 'app-sandbox-node:22'
  };

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    const jobId = uuid();
    const startTime = Date.now();
    const logs: SandboxLogEntry[] = [];

    // 1. Validation statique du code
    const lintResult = await this.lintCode(request.code, request.language);
    if (!lintResult.valid) {
      return {
        success: false,
        error: `Erreur de syntaxe : ${lintResult.errors.join('\n')}`,
        logs: [{ level: 'ERROR', message: lintResult.errors.join('\n'), timestamp: new Date() }],
        durationMs: Date.now() - startTime
      };
    }

    // 2. Validation des paramètres d'entrée
    const paramValidation = validateAgainstSchema(request.params, request.inputSchema);
    if (!paramValidation.valid) {
      return {
        success: false,
        error: `Paramètres invalides : ${paramValidation.errors.join(', ')}`,
        logs: [],
        durationMs: Date.now() - startTime
      };
    }

    // 3. Création du container Docker éphémère
    const container = await this.docker.createContainer({
      Image: this.IMAGES[request.language],
      Cmd: this.buildCommand(request, jobId),
      Env: [
        `FUNCTION_INPUT=${JSON.stringify(request.params)}`,
        `JOB_ID=${jobId}`,
        `SANDBOX=true`
      ],
      HostConfig: {
        Memory: 256 * 1024 * 1024,   // 256 MB
        NanoCpus: 500_000_000,        // 0.5 CPU
        NetworkMode: 'sandbox-net',   // Réseau isolé
        AutoRemove: true,
        ReadonlyRootfs: true,
        Tmpfs: { [`/tmp/sandbox/${jobId}`]: 'rw,noexec,size=50m' },
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL']
      }
    });

    try {
      await container.start();

      // 4. Stream des logs en temps réel
      const logStream = await container.logs({
        follow: true, stdout: true, stderr: true, timestamps: true
      });

      // Parser les logs et les envoyer au frontend via WebSocket
      await this.streamLogs(logStream, logs, jobId);

      // 5. Récupération du résultat
      const result = await this.collectResult(jobId);

      return {
        ...result,
        logs,
        durationMs: Date.now() - startTime
      };

    } catch (error: any) {
      // Le container est auto-supprimé (AutoRemove: true)
      return {
        success: false,
        error: error.message,
        logs,
        durationMs: Date.now() - startTime
      };
    }
  }

  // Sandbox TypeScript avec isolated-vm (sans Docker, plus rapide)
  async runTypeScript(
    code: string,
    params: Record<string, unknown>,
    timeoutMs = 10000
  ): Promise<SandboxRunResult> {
    const ivm = await import('isolated-vm');
    const isolate = new ivm.Isolate({ memoryLimit: 64 }); // 64 MB
    const context = await isolate.createContext();
    const startTime = Date.now();
    const logs: SandboxLogEntry[] = [];

    // Injection des utilitaires sandboxés
    await context.global.set('_params', new ivm.ExternalCopy(params).copyInto());
    await context.global.set('_log', new ivm.Reference((level: string, msg: string) => {
      logs.push({ level: level as any, message: msg, timestamp: new Date() });
    }));

    const wrappedCode = `
      const logger = {
        info: (msg) => _log('INFO', msg),
        warn: (msg) => _log('WARN', msg),
        error: (msg) => _log('ERROR', msg),
      };
      ${code}
      // Exécution de la fonction principale
      (async () => {
        const result = await NOM_FONCTION(_params, { logger });
        return JSON.stringify(result);
      })()
    `;

    try {
      const script = await isolate.compileScript(wrappedCode);
      const resultRef = await script.run(context, {
        timeout: timeoutMs,
        promise: true
      });
      const resultJson = await resultRef.copy();
      const data = JSON.parse(resultJson);

      return {
        success: true,
        data,
        logs,
        durationMs: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        logs,
        durationMs: Date.now() - startTime
      };
    } finally {
      isolate.dispose();
    }
  }
}
```

#### 2.3.5 Images Docker Sandbox Pré-construites

```dockerfile
# docker/sandbox-python/Dockerfile
FROM python:3.12-slim

# Utilisateur non-root
RUN useradd -m -u 1000 sandbox
USER sandbox
WORKDIR /sandbox

# Dépendances autorisées dans le sandbox
COPY requirements-sandbox.txt .
RUN pip install --no-cache-dir --user -r requirements-sandbox.txt

# Runner d'exécution
COPY runner.py .

ENTRYPOINT ["python", "-u", "runner.py"]
```

```
# requirements-sandbox.txt (dépendances autorisées dans le sandbox)
httpx==0.27.*          # HTTP client async
pydantic==2.*          # Validation
pandas==2.*            # Données
numpy==1.*             # Calcul
beautifulsoup4==4.*    # HTML parsing
python-dateutil==2.*   # Dates
```

---

## 3. Intégration Archi > Prototypage

### 3.1 Comportement Modifié

La section **Appel de fonctions** dans **Archi > Prototypage** évolue pour devenir un **sélecteur** qui puise dans le registre de **Phil > Fonctions Personnalisées**.

#### Avant (comportement actuel)

```
Onglet "Appel de fonctions"
  [☐] Activer les appels de fonction
  Si coché :
    [+ Ajouter une fonction]
      → Formulaire inline : nom / description / schéma entrée / schéma sortie
```

#### Après (cible)

```
Onglet "Appel de fonctions"
  [☐] Activer les appels de fonction
  Si coché :
    ┌─ Fonctions disponibles (depuis Phil > Fonctions Personnalisées) ──┐
    │  🔍 [Rechercher...]                  [Gérer les fonctions ↗]      │
    │                                                                   │
    │  [☐] get_weather_forecast_py  Python  Météo  — Natif              │
    │  [☑] searchWeb_ts             TypeScript  Recherche  — Natif      │
    │  [☑] my_custom_analysis_py    Python  Analyse  — Custom           │
    │                                                                   │
    │  ⚠️  2 fonctions désactivées non visibles. Gérer →               │
    └───────────────────────────────────────────────────────────────────┘
    
    ╔═ Fonctions sélectionnées pour cet agent ══════════════════════════╗
    ║  searchWeb_ts                                          [Détails ▼]║
    ║  my_custom_analysis_py                                [Détails ▼]║
    ╚═══════════════════════════════════════════════════════════════════╝
    
    [+ Créer une nouvelle fonction →] (redirige vers Phil > Éditeur)
```

### 3.2 Lien Bidirectionnel

```
Phil > Fonctions Personnalisées
  Toggle activation → met à jour le flag `isActive` en base
                   → l'onglet Prototypage recharge la liste filtrée

Archi > Prototypage
  Clic sur [Gérer les fonctions ↗] → ouvre Phil > Fonctions (nouvelle tab ou modal)
  Clic sur [+ Créer une nouvelle fonction →] → ouvre Phil > Éditeur (nouvelle tab)
```

### 3.3 Persistance de la Sélection

Quand un agent est créé/sauvegardé via le prototypage, la liste des fonctions sélectionnées est stockée avec l'agent sous forme de `functionIds[]`. Au moment de l'exécution, le **FunctionRegistry** résout ces IDs en manifestes complets.

---

## 4. Contrats de Données & API Backend

### 4.1 Modèle de Données — `CustomFunction`

```typescript
// shared/types/custom-function.types.ts

export type FunctionLanguage = 'typescript' | 'python';
export type FunctionOrigin   = 'native' | 'custom';
export type FunctionCategory = 
  | 'search' | 'weather' | 'file' | 'data' | 'ai' | 'web'
  | 'calendar' | 'email' | 'database' | 'utility' | 'custom';

export interface CustomFunction {
  id:           string;                  // UUID v4
  name:         string;                  // ex: "search_web_py"
  description:  string;                  // Affiché à l'agent dans son contexte
  language:     FunctionLanguage;
  origin:       FunctionOrigin;
  category:     FunctionCategory;
  tags:         string[];
  
  code:         string;                  // Code source complet
  inputSchema:  JSONSchema;              // JSON Schema des paramètres
  outputSchema: JSONSchema;              // JSON Schema du retour
  
  isActive:     boolean;                 // Visible dans Prototypage ?
  isReadonly:   boolean;                 // true pour les fonctions natives
  
  version:      string;                  // semver ex: "1.0.0"
  checksum:     string;                  // SHA256 du code (intégrité)
  
  createdAt:    string;                  // ISO 8601
  updatedAt:    string;
  createdBy:    string;                  // userId
  
  testCases?:   FunctionTestCase[];      // Cas de test sauvegardés
  lastTestResult?: SandboxRunResult;     // Dernier résultat de test
}

export interface FunctionTestCase {
  id:          string;
  name:        string;
  params:      Record<string, unknown>;
  expectedOutput?: unknown;
  lastRunAt?:  string;
  lastPassed?: boolean;
}
```

### 4.2 API REST — Endpoints

```
GET    /api/functions                     Liste toutes les fonctions (filtres: language, origin, isActive, category)
GET    /api/functions/:id                 Détail d'une fonction
POST   /api/functions                     Créer une nouvelle fonction
PUT    /api/functions/:id                 Modifier une fonction custom
DELETE /api/functions/:id                 Supprimer une fonction custom
POST   /api/functions/:id/duplicate       Dupliquer (natif → custom)

PATCH  /api/functions/:id/activation      { isActive: boolean }
POST   /api/functions/sandbox/run         Exécuter en sandbox (test)
GET    /api/functions/sandbox/:jobId/logs Stream SSE des logs d'exécution

GET    /api/functions/active              Liste uniquement les fonctions actives (pour Prototypage)
POST   /api/functions/validate            Valider code + schémas sans sauvegarder
```

### 4.3 Format de Réponse Standard

```typescript
// GET /api/functions/active (consommé par Archi > Prototypage)
{
  "functions": [
    {
      "id": "fn_abc123",
      "name": "search_web_py",
      "description": "Effectue une recherche web et retourne les résultats structurés",
      "language": "python",
      "category": "search",
      "inputSchema": {
        "type": "object",
        "required": ["query"],
        "properties": {
          "query":      { "type": "string",  "description": "Termes de recherche" },
          "maxResults": { "type": "integer", "default": 5, "minimum": 1, "maximum": 20 }
        }
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "results": { "type": "array",   "items": { "$ref": "#/$defs/SearchResult" } },
          "total":   { "type": "integer" }
        }
      },
      "isActive":   true,
      "isReadonly": true
    }
  ],
  "total": 12
}
```

---

## 5. Architecture d'Exécution Sécurisée

### 5.1 Flux d'Exécution en Production (hors sandbox)

Quand un agent invoque une fonction en production (pas en mode test), le flux est :

```
Agent (LLM) génère un tool_call
       │
       ▼
AgentExecutionService (Node.js)
  ├─ Résout l'ID de fonction → FunctionRegistry
  ├─ Valide les arguments → Ajv + JSON Schema
  ├─ Détermine le runtime (suffixe _py → Python, sinon Node)
  │
  ├─ TypeScript → TypeScriptFunctionRunner
  │     └─ eval sécurisé via isolated-vm (même sandbox que les tests)
  │
  └─ Python → PythonFunctionRunner
        ├─ Mode subprocess (fonctions one-shot, < 100ms attendu)
        │    └─ spawn('python3', [runner.py], { env: FUNCTION_INPUT=... })
        └─ Mode FastAPI sidecar (fonctions fréquentes ou avec état)
              └─ POST http://python-sidecar:8001/execute
```

### 5.2 Matrix de Routage Runtime

```typescript
// backend/src/functions/runtime-router.ts

export class RuntimeRouter {
  static resolve(fn: CustomFunction): RuntimeType {
    if (fn.language === 'python') {
      // Convention de nommage : _py suffix → Python runner
      if (!fn.name.endsWith('_py')) {
        throw new Error(`Fonction Python "${fn.name}" doit se terminer par "_py"`);
      }
      return 'python';
    }
    return 'typescript';
  }

  static selectPythonMode(fn: CustomFunction): 'subprocess' | 'sidecar' {
    // Sidecar pour les fonctions à longue durée ou fréquentes
    if (fn.tags.includes('heavy') || fn.tags.includes('persistent')) return 'sidecar';
    return 'subprocess'; // Default : subprocess one-shot
  }
}
```

### 5.3 Python Runner — subprocess

```typescript
// backend/src/functions/runners/python.runner.ts

export class PythonRunner {
  
  async execute(
    fn: CustomFunction,
    params: Record<string, unknown>
  ): Promise<FunctionExecutionResult> {
    
    return new Promise((resolve, reject) => {
      const proc = spawn('python3', ['-c', this.wrapCode(fn.code, fn.name)], {
        env: {
          ...process.env,
          FUNCTION_INPUT:  JSON.stringify(params),
          FUNCTION_NAME:   fn.name,
          PYTHONPATH:      process.env.PYTHON_FUNCTIONS_PATH,
          SANDBOX:         'false'  // Production, pas de sandbox
        },
        timeout: fn.timeout ?? 30_000,
        cwd: process.env.FUNCTIONS_WORKDIR
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', chunk => stdout += chunk.toString());
      proc.stderr.on('data', chunk => stderr += chunk.toString());

      proc.on('close', code => {
        if (code !== 0) {
          reject(new FunctionExecutionError(fn.name, stderr));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          resolve({ success: true, data: result.data, durationMs: result.duration_ms });
        } catch {
          reject(new FunctionExecutionError(fn.name, `Sortie non-JSON : ${stdout}`));
        }
      });
    });
  }

  private wrapCode(code: string, fnName: string): string {
    return `
import sys, json, os, time, asyncio

${code}

if __name__ == '__main__':
    params = json.loads(os.environ.get('FUNCTION_INPUT', '{}'))
    start = time.time()
    
    from app.functions import FunctionContext
    ctx = FunctionContext.from_env()
    
    if asyncio.iscoroutinefunction(${fnName}):
        result = asyncio.run(${fnName}(params, ctx))
    else:
        result = ${fnName}(params, ctx)
    
    duration_ms = int((time.time() - start) * 1000)
    print(json.dumps({"data": result if isinstance(result, dict) else vars(result), "duration_ms": duration_ms}))
`;
  }
}
```

---

## 6. Flux de Données Complet

```
CRÉATION D'UNE FONCTION (utilisateur)
──────────────────────────────────────
User: Phil > Fonctions > Onglet Éditeur
  │
  ├─ Remplit : nom, description, langage, tags
  ├─ Saisit inputSchema + outputSchema (JSON Schema)
  ├─ Écrit le code dans Monaco Editor
  ├─ [Optionnel] Clique Exécuter dans la Console
  │     └─ POST /api/functions/sandbox/run → SandboxService
  │           └─ Docker/isolated-vm → résultat + logs → WebSocket
  │
  ├─ Clique [Sauvegarder & Activer]
  │     └─ POST /api/functions → FunctionController
  │           ├─ Validation code (lint)
  │           ├─ Validation schémas (Ajv)
  │           ├─ Calcul checksum SHA256
  │           ├─ Persistance BDD (PostgreSQL)
  │           └─ Invalidation cache Redis du FunctionRegistry
  │
  └─ Toast : "Fonction créée et activée ✓"

UTILISATION PAR UN AGENT (runtime)
────────────────────────────────────
Agent configuré dans Archi > Prototypage avec [search_web_py, my_fn_py]
  │
User envoie un message
  │
AgentRunner
  ├─ Charge les fonctions de l'agent → GET /api/functions/active?ids=[...]
  ├─ Injecte les définitions (nom + description + inputSchema) dans le contexte LLM
  │
LLM génère tool_call : { name: "search_web_py", arguments: { query: "..." } }
  │
AgentExecutionService
  ├─ RuntimeRouter → python/subprocess
  ├─ Validation arguments vs inputSchema
  ├─ PythonRunner.execute(fn, args)
  ├─ Validation résultat vs outputSchema
  └─ Retourne résultat → LLM continue la conversation
```

---

## 7. Composants React — Spécifications Détaillées

### 7.1 Arborescence des Composants

```
pages/
  PhilFunctionsPage.tsx                 ← Route /phil/functions
  
components/functions/
  FunctionsPageHeader.tsx               ← Titre + bouton "+ Nouvelle"
  FunctionsTabs.tsx                     ← Onglets Bibliothèque / Éditeur
  
  library/
    FunctionLibrary.tsx                 ← Conteneur onglet Bibliothèque
    FunctionSearchBar.tsx               ← Recherche + filtres
    FunctionCard.tsx                    ← Carte d'une fonction
    FunctionCardActions.tsx             ← Boutons Voir/Modifier/Dupliquer/Supprimer
    FunctionActivationToggle.tsx        ← Switch d'activation
    FunctionFilters.tsx                 ← Filtres langage/origine/statut
    
  editor/
    FunctionEditor.tsx                  ← Conteneur onglet Éditeur
    FunctionMetaForm.tsx                ← Formulaire nom/description/tags
    FunctionLanguageSelector.tsx        ← Sélecteur TypeScript/Python
    FunctionSchemaEditor.tsx            ← Éditeur JSON Schema (×2)
    FunctionCodeEditor.tsx              ← Wrapper Monaco Editor
    FunctionConsole.tsx                 ← Console d'exécution
    FunctionConsoleInput.tsx            ← Saisie des paramètres de test
    FunctionConsoleOutput.tsx           ← Affichage résultat + logs
    FunctionConsoleLogs.tsx             ← Liste des log entries

hooks/
  useFunctions.ts                       ← CRUD + liste fonctions
  useFunctionActivation.ts              ← Toggle activation
  useFunctionSandbox.ts                 ← Exécution en sandbox + logs SSE
  useFunctionEditor.ts                  ← État de l'éditeur (dirty, save, etc.)
```

### 7.2 Hook Principal — `useFunctions`

```typescript
// hooks/useFunctions.ts

export function useFunctions(filters?: FunctionFilters) {
  const [functions, setFunctions] = useState<CustomFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters?.language)  params.set('language', filters.language);
    if (filters?.origin)    params.set('origin',   filters.origin);
    if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive));
    if (filters?.search)    params.set('search',   filters.search);

    const data = await api.get<CustomFunction[]>(`/functions?${params}`);
    setFunctions(data);
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const create  = useCallback((fn: CreateFunctionDto) => api.post('/functions', fn).then(load), [load]);
  const update  = useCallback((id: string, fn: Partial<CustomFunction>) => api.put(`/functions/${id}`, fn).then(load), [load]);
  const remove  = useCallback((id: string) => api.delete(`/functions/${id}`).then(load), [load]);
  const toggle  = useCallback((id: string, isActive: boolean) =>
    api.patch(`/functions/${id}/activation`, { isActive }).then(() =>
      setFunctions(fns => fns.map(f => f.id === id ? { ...f, isActive } : f))
    ), []);

  return { functions, loading, error, create, update, remove, toggle, reload: load };
}
```

### 7.3 Hook Sandbox — `useFunctionSandbox`

```typescript
// hooks/useFunctionSandbox.ts

export function useFunctionSandbox() {
  const [status, setStatus]       = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [result, setResult]       = useState<unknown>(null);
  const [logs, setLogs]           = useState<SandboxLogEntry[]>([]);
  const [durationMs, setDuration] = useState<number | null>(null);

  const run = useCallback(async (request: SandboxRunRequest) => {
    setStatus('running');
    setLogs([]);
    setResult(null);

    // 1. Lancer l'exécution
    const { jobId } = await api.post<{ jobId: string }>('/functions/sandbox/run', request);

    // 2. Stream des logs via SSE
    const eventSource = new EventSource(`/api/functions/sandbox/${jobId}/logs`);
    
    eventSource.addEventListener('log', (e) => {
      const entry: SandboxLogEntry = JSON.parse(e.data);
      setLogs(prev => [...prev, entry]);
    });

    eventSource.addEventListener('result', (e) => {
      const { success, data, error, durationMs } = JSON.parse(e.data);
      setResult(data);
      setDuration(durationMs);
      setStatus(success ? 'success' : 'error');
      eventSource.close();
    });

    eventSource.addEventListener('error', () => {
      setStatus('error');
      eventSource.close();
    });

  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setLogs([]);
    setDuration(null);
  }, []);

  return { status, result, logs, durationMs, run, reset };
}
```

---

## 8. Implémentation Backend Node.js / Python

### 8.1 FunctionController (Express)

```typescript
// backend/src/functions/function.controller.ts

import { Router } from 'express';
import { FunctionService } from './function.service';
import { SandboxService }  from './sandbox/sandbox.service';
import { validateBody }    from '../middleware/validation';
import { createFunctionSchema, updateFunctionSchema } from './function.schemas';

const router = Router();
const service = new FunctionService();
const sandbox = new SandboxService();

router.get('/',           async (req, res) => {
  const fns = await service.findAll(req.query as FunctionFilters);
  res.json({ functions: fns, total: fns.length });
});

router.get('/active',     async (req, res) => {
  const fns = await service.findActive(req.query.ids as string[] | undefined);
  res.json({ functions: fns });
});

router.get('/:id',        async (req, res) => {
  const fn = await service.findById(req.params.id);
  if (!fn) return res.status(404).json({ error: 'Function not found' });
  res.json(fn);
});

router.post('/',          validateBody(createFunctionSchema), async (req, res) => {
  const fn = await service.create(req.body, req.user.id);
  res.status(201).json(fn);
});

router.put('/:id',        validateBody(updateFunctionSchema), async (req, res) => {
  const fn = await service.update(req.params.id, req.body, req.user.id);
  res.json(fn);
});

router.delete('/:id',     async (req, res) => {
  await service.delete(req.params.id, req.user.id);
  res.status(204).send();
});

router.post('/:id/duplicate', async (req, res) => {
  const fn = await service.duplicate(req.params.id, req.user.id);
  res.status(201).json(fn);
});

router.patch('/:id/activation', async (req, res) => {
  const fn = await service.setActive(req.params.id, req.body.isActive);
  res.json({ id: fn.id, isActive: fn.isActive });
});

router.post('/sandbox/run', async (req, res) => {
  const { jobId } = await sandbox.enqueue(req.body);
  res.json({ jobId });
});

// SSE stream des logs sandbox
router.get('/sandbox/:jobId/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const cleanup = sandbox.subscribeLogs(req.params.jobId, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    if (event.type === 'result') {
      cleanup();
      res.end();
    }
  });

  req.on('close', cleanup);
});

export default router;
```

### 8.2 FunctionContext Python — Objet injecté dans chaque fonction

```python
# backend/python/app/functions/context.py

from dataclasses import dataclass, field
from typing import Optional, Any
import os
import logging
import httpx


@dataclass
class FunctionContext:
    """
    Contexte injecté dans chaque fonction au moment de l'exécution.
    Fournit les utilitaires nécessaires sans exposer les internals de l'application.
    """
    logger:      logging.Logger     = field(default_factory=lambda: logging.getLogger("function"))
    http:        Optional[httpx.AsyncClient] = None
    job_id:      str = ""
    is_sandbox:  bool = False
    user_id:     Optional[str] = None
    agent_id:    Optional[str] = None

    # Utilitaires autorisés selon le mode (sandbox vs production)
    _allowed_hosts: list[str] = field(default_factory=list)

    def __post_init__(self):
        if self.http is None:
            # En sandbox, on utilise un client httpx avec transport mockable
            transport = MockTransport() if self.is_sandbox else None
            self.http = httpx.AsyncClient(
                timeout=10.0,
                transport=transport,
                headers={"User-Agent": "App-FunctionRunner/1.0"}
            )

    @classmethod
    def from_env(cls) -> "FunctionContext":
        return cls(
            job_id=os.environ.get("JOB_ID", ""),
            is_sandbox=os.environ.get("SANDBOX", "false").lower() == "true",
            user_id=os.environ.get("USER_ID"),
            agent_id=os.environ.get("AGENT_ID"),
        )


@dataclass
class FunctionResult:
    """Retour standardisé de toute fonction."""
    success: bool
    data:    Any = None
    error:   Optional[str] = None
    meta:    dict = field(default_factory=dict)
```

---

## 9. Sécurité & Gouvernance

### 9.1 Politique d'Exécution

| Contexte | Runtime | Isolation | Réseau | Filesystem |
|---|---|---|---|---|
| **Test (Console)** | Docker éphémère / isolated-vm | ⭐⭐⭐⭐⭐ | Whitelist seulement | `/tmp/sandbox/{jobId}` uniquement |
| **Production (Agent)** | subprocess / sidecar | ⭐⭐⭐ | Selon permissions de la fonction | `FUNCTIONS_WORKDIR` uniquement |
| **Fonction Native** | subprocess / sidecar | ⭐⭐⭐⭐ | Selon la fonction | Contrôlé par le système |

### 9.2 Validation Multi-Couche

```
Couche 1 — Lint statique       : analyse syntaxique avant sauvegarde
Couche 2 — JSON Schema         : validation inputSchema + outputSchema (Ajv)
Couche 3 — Analyse de contenu  : détection d'imports/patterns dangereux
Couche 4 — Sandbox d'exécution : isolation runtime avant mise en production
Couche 5 — Validation I/O      : vérification des args/résultats à chaque call
```

### 9.3 Patterns Interdits (détection statique)

```python
# backend/src/functions/security/code-analyzer.ts

const FORBIDDEN_PATTERNS = {
  python: [
    /import\s+os\.system/,
    /subprocess\.(?:call|run|Popen)/,
    /exec\s*\(/,
    /eval\s*\(/,
    /__import__/,
    /open\s*\([^)]*['"]\s*w/,   // Écriture fichier arbitraire
    /socket\./,                  // Accès socket raw
  ],
  typescript: [
    /process\.exit/,
    /child_process/,
    /require\s*\(\s*['"]fs['"]\)/,
    /require\s*\(\s*['"]child_process['"]\)/,
    /new\s+Function\s*\(/,
    /globalThis\[/,
  ]
};
```

---

## 10. Tests & Observabilité

### 10.1 Tests Requis

**Tests unitaires (jest / pytest) :**
- `FunctionService.create()` → validation des champs, checksum, persistance
- `SandboxService.run()` → mock Docker, vérification isolation
- `PythonRunner.execute()` → mock subprocess, parsing stdout
- `RuntimeRouter.resolve()` → convention de nommage `_py`
- `ToolCallParser` (existant) → régression sur les nouvelles fonctions

**Tests d'intégration :**
- Flux complet : création → activation → chargement dans Prototypage
- Exécution sandbox Python → résultat correct
- Exécution sandbox TypeScript → résultat correct
- Toggle activation → propagation correcte vers Archi > Prototypage

### 10.2 Métriques à Monitorer

| Métrique | Type | Seuil d'alerte |
|---|---|---|
| `function.sandbox.duration_ms` | Histogram | > 10s |
| `function.sandbox.error_rate` | Counter | > 10% / 5min |
| `function.execution.duration_ms` | Histogram | > p95 × 2 |
| `function.execution.error_rate` | Counter | > 5% / 5min |
| `function.container.startup_ms` | Histogram | > 3s |

---

## 11. Roadmap d'Implémentation

### Phase 1 — Socle (Semaine 1-2)

- [ ] Modèle de données `CustomFunction` + migration BDD
- [ ] API REST complète (`/api/functions` + `/api/functions/active`)
- [ ] `FunctionService` avec CRUD + activation toggle
- [ ] Chargement des fonctions natives depuis fichiers seed au démarrage
- [ ] Connexion Archi > Prototypage → `/api/functions/active`

### Phase 2 — Interface Bibliothèque (Semaine 3)

- [ ] Page `PhilFunctionsPage` avec onglets
- [ ] `FunctionLibrary` : liste, recherche, filtres
- [ ] `FunctionCard` avec `FunctionActivationToggle`
- [ ] Hook `useFunctions` + `useFunctionActivation`
- [ ] Mise à jour du panneau Prototypage : remplacer le formulaire inline par le sélecteur

### Phase 3 — Éditeur (Semaine 4)

- [ ] Intégration Monaco Editor (TypeScript + Python)
- [ ] `FunctionMetaForm` + `FunctionSchemaEditor`
- [ ] Templates de code auto-injectés
- [ ] Sauvegarde avec validation lint + schéma
- [ ] Duplication des fonctions natives

### Phase 4 — Console Sandbox (Semaine 5-6)

- [ ] Images Docker sandbox Python 3.12 + Node 22
- [ ] `SandboxService` avec Docker Engine API
- [ ] `isolated-vm` runner pour TypeScript
- [ ] SSE stream des logs sandbox
- [ ] Hook `useFunctionSandbox` + composants `FunctionConsole`

### Phase 5 — Polish & Production (Semaine 7-8)

- [ ] Analyse de sécurité du code (patterns interdits)
- [ ] Tests unitaires + intégration complets
- [ ] OpenTelemetry traces pour l'exécution des fonctions
- [ ] Documentation utilisateur embarquée (tooltips, guide in-app)
- [ ] Gestion des versions de fonctions (historique + rollback)

---

# PARTIE 2 — Fonctions Natives par Défaut

> *Cette partie sera complétée lors de la prochaine étape, une fois que vous aurez présenté les fonctions natives que vous souhaitez proposer par défaut dans l'application.*

---

*Document préparé pour l'Agent Architecte et les Agents Développeurs — Mars 2026*
