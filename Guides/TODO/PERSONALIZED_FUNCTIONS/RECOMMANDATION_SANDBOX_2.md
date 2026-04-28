# Rapport d’architecture — Sandboxing local de Tools IA pour une plateforme d’orchestration d’agents  
**Contexte 2026 — stack Node.js / TypeScript / React / MongoDB / Docker, avec exécution possible de Python**

---

## 1. Résumé exécutif

La proposition consistant à **créer un conteneur Docker par utilisateur dès l’ouverture du compte** est **compréhensible** mais **non optimale comme stratégie principale** pour une plateforme d’orchestration d’agents IA en 2026.

### Verdict
- **Oui**, Docker joue un rôle utile dans l’architecture.
- **Non**, le modèle **“1 container persistant par user créé à l’inscription”** n’est pas le meilleur choix en termes de :
  - coût machine,
  - densité,
  - maintenance,
  - sécurité,
  - montée en charge,
  - hygiène d’exécution,
  - reproductibilité des runs.

### Recommandation principale
Mettre en place une architecture de sandboxing **hybride**, avec séparation nette entre :

1. **Sandbox d’exécution éphémère par run / job / tool invocation**  
   → pour exécuter le code utilisateur de façon fiable, isolée, reproductible.

2. **Workspace persistant par utilisateur / projet**  
   → pour stocker code, dépendances déclaratives, artefacts, git, skills, configuration.

### Solution recommandée en 2026, locale, gratuite, compatible avec votre stack
**Docker/OCI pour l’isolation + microVM ou sandbox renforcée selon criticité**, orchestré par votre backend Node.js.

En pratique, selon votre niveau de maturité :

#### Option pragmatique immédiate
- **Workspace persistant** : volume par utilisateur/projet
- **Exécution** : conteneurs **éphémères** Docker rootless, non privilégiés, read-only autant que possible
- **Runtimes** : images distinctes TS/Node et Python
- **Sécurité** : seccomp, AppArmor, capabilities minimales, cgroups, réseau restreint, fs temporaire
- **Timeout / quotas / kill automatique**

#### Option optimale 2026 si vous voulez élever fortement la sécurité
- **Workspace persistant** : idem
- **Exécution** : **microVM Firecracker** ou sandbox gVisor/Kata Containers pour les runs non fiables
- **Orchestration** : votre backend Node.js pilote ces sandboxes
- **Avantage** : meilleure isolation noyau que Docker seul

### Recommandation architecturale ferme
Ne pas confondre :
- **environnement de développement utilisateur**
- **environnement d’exécution d’un Tool**
- **environnement de build / install de dépendances**
- **stockage persistant des projets**

Ces quatre préoccupations doivent être séparées.

---

## 2. Contexte produit et contraintes

Votre plateforme :
- Frontend : **React**
- Backend : **Node.js / TypeScript**
- Persistance : **MongoDB dans Docker**
- Exécution actuelle de certains tools via **SDK de providers LLM cloud**
- Besoin futur :
  - import / création / modification de tools utilisateur
  - exécution de tools “maison”
  - support futur de **skills**
  - support futur de **projets git**
  - exécution possible en **TypeScript** et **Python**
  - sandboxing **local**, **gratuit**, et **fiable**

Le sujet n’est pas simplement “comment lancer du code”, mais comment garantir :
- isolation inter-utilisateurs,
- contrôle des ressources,
- auditabilité,
- reproductibilité,
- gestion des dépendances,
- montée en charge,
- sécurité face à du code non fiable.

---

## 3. Ce qui a changé avec les bonnes pratiques IA 

En 2026, les systèmes inspirés des patterns Anthropic les plus robustes convergent sur plusieurs principes :

### 3.1 Les tools doivent être traités comme des capacités contrôlées
Les agents ne doivent pas exécuter librement du code sans :
- politiques d’accès,
- validation des entrées,
- journalisation,
- gouvernance des sorties,
- isolation de l’exécution.

### 3.2 Séparation stricte entre raisonnement, orchestration et exécution
Un agent ne “possède” pas directement l’OS.
Il :
- décide,
- propose une invocation de tool,
- passe par une couche d’orchestration,
- qui autorise, exécute, observe, limite et journalise.

### 3.3 Les environnements d’exécution doivent être jetables
Les runs doivent idéalement être :
- éphémères,
- versionnés,
- reconstruisibles,
- immuables au maximum,
plutôt que des environnements persistants “sales”.

### 3.4 La sécurité ne doit pas dépendre d’un seul mécanisme
Docker seul n’est pas une frontière de sécurité suffisante pour du code hostile.
Il faut additionner :
- isolation runtime,
- restrictions système,
- restrictions réseau,
- politiques de secrets,
- contrôle des ressources,
- vérification de provenance des dépendances.

---

## 4. Analyse de l'ancienne solution proposée : “un conteneur Docker par utilisateur à la création du compte”

## 4.1 Les avantages
Cette approche a des points positifs :

- **simple à comprendre**
- **facile à prototyper**
- permet de donner une impression de “machine utilisateur”
- facilite un workspace persistant
- s’insère naturellement dans votre stack existante Docker
- pratique pour préparer plus tard skills + projets git

## 4.2 Les défauts majeurs

### A. Mauvaise densité / gaspillage des ressources
Un conteneur persistant par utilisateur :
- consomme stockage,
- multiplie les processus dormants,
- complexifie le lifecycle,
- devient coûteux si beaucoup d’utilisateurs ne s’en servent pas activement.

Pour 10 utilisateurs, c’est acceptable.
Pour 1 000 ou 10 000, cela devient rapidement une dette.

### B. Pollution de l’environnement
Si le conteneur est persistant :
- dépendances installées “à la main”,
- fichiers temporaires,
- modifications locales,
- state imprévisible,
rendent les exécutions non reproductibles.

### C. Sécurité imparfaite
Docker n’est pas une VM.
Un conteneur utilisateur persistant :
- augmente la surface d’attaque,
- conserve potentiellement des payloads malveillants,
- rend plus difficile la rotation des environnements,
- complexifie les politiques de patching.

### D. Mauvais découplage dev / run
Le besoin réel n’est pas toujours “une machine par user”.
Il faut souvent :
- un espace de travail persistant,
- et des **exécutions jetables**.

Créer un conteneur persistant mélange ces deux besoins.

### E. Montée en charge et gestion opérationnelle
Il faudra gérer :
- start/stop/restart,
- compatibilité image,
- migration de versions,
- nettoyage,
- quotas disque,
- dépendances cassées,
- corruption de workspace.

### F. Risque d’escalade via dépendances
L’utilisateur installera potentiellement :
- packages npm,
- packages pip,
- binaires,
- scripts shell.

Un conteneur persistant devient alors une cible de persistence malware.

---

## 5. Conclusion sur cette solution

### Est-elle optimale ?
**Non**, pas en tant que modèle principal.

### Est-elle exploitable ?
**Oui**, mais à condition de la transformer en :
- **workspace persistant léger**
- + **jobs d’exécution éphémères**
- + **politiques de sécurité sérieuses**

Autrement dit :
> **Ne créez pas un “container-machine” permanent par utilisateur pour tout faire.**  
> Créez plutôt un **espace de travail persistant**, et lancez des **sandboxes jetables** à chaque exécution.

---

## 6. Architecture recommandée

# 6.1 Vue d’ensemble

```text
React UI
  |
  v
Node.js / TypeScript Backend
  |
  +--> MongoDB (users, maps, nodes, agents, tools, runs, policies, secrets metadata)
  |
  +--> Workspace Manager
  |      - code utilisateur
  |      - manifests package.json / requirements.txt / pyproject.toml
  |      - projets git
  |      - assets / skills
  |
  +--> Tool Registry
  |      - metadata tool
  |      - runtime: ts | python
  |      - schema input/output
  |      - permissions
  |      - versioning
  |
  +--> Execution Orchestrator
         |
         +--> Sandbox Runner (Docker rootless / gVisor / Firecracker)
         |      - run éphémère
         |      - quotas CPU/mémoire/disque
         |      - timeout
         |      - réseau limité
         |      - logs/exit code/artifacts
         |
         +--> Secret Broker
         +--> Policy Engine
         +--> Observability
```
---
## 6.1 Architecture cible

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
---

## 6.3 Flux d"exécution d'un Tool natif ou utilisateur par une node agent sur la carte du workflow

Temps total cible : < 2 secondes
                    
Agent utilise un des Tools activés de sa configuration
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
---

## 7. Modèle recommandé : Workspace persistant + sandbox éphémère

## 7.1 Workspace persistant
Chaque utilisateur ou projet dispose d’un espace de travail persistant contenant :
- code source tool
- manifests de dépendances
- configuration
- dépôts git clonés
- assets
- versions des tools
- logs de build optionnels

### Implémentation possible
- volume Docker
- répertoire host dédié
- éventuellement stockage objet local plus tard pour artefacts

### Important
Le workspace **n’est pas le runtime**.  
Il ne doit pas être considéré comme l’environnement d’exécution sûr.

---

## 7.2 Sandbox d’exécution éphémère
À chaque exécution de tool :
1. le backend résout la version du tool,
2. monte le code depuis le workspace en lecture seule si possible,
3. injecte des inputs validés,
4. lance un conteneur ou une microVM éphémère,
5. récupère logs, outputs et artefacts,
6. détruit l’environnement.

### Bénéfices
- reproductibilité,
- nettoyage automatique,
- limitation de persistence malveillante,
- patching plus simple,
- meilleure auditabilité.

---

## 8. Choix de sandboxing local et gratuit en 2026

## 8.1 Firecracker microVM
### Niveau
**Excellente isolation, très pertinente pour sandboxing hostile**

Si vous cherchez le meilleur compromis “local + gratuit + sécurité forte”, **Firecracker** est une très bonne réponse en 2026.

### Avantages
- isolation de type microVM, nettement plus forte qu’un conteneur seul,
- démarrage rapide,
- très adapté aux workloads éphémères,
- robuste pour exécuter du code utilisateur.

### Inconvénients
- plus complexe à opérer,
- intégration plus technique,
- nécessite une vraie couche d’orchestration.

### Mon avis
Si votre produit vise sérieusement l’exécution de code utilisateur “maison”, avec à terme git + skills + potentiellement agents plus autonomes, **Firecracker devient la cible idéale** pour les runs non fiables.


---

## 9. Recommandation concrète

## Recommandation cible
### Court terme
**Docker rootless renforcé + exécution éphémère par run**

### Moyen terme
**Segmenter les niveaux de risque :**
- tools internes de confiance → Docker rootless
- tools utilisateur non approuvés → gVisor ou Firecracker

### Long terme
**Firecracker pour tout code utilisateur non fiable**, Docker restant pour les services système et les runtimes internes.

---

## 10. Le choix de distribution Alpine : une mauvaise idée

## 10.1 Pourquoi Alpine séduit
- image légère
- démarrage rapide
- faible empreinte

## 10.2 Pourquoi Alpine n’est pas toujours le meilleur choix
En 2026, Alpine reste utile, mais pour des sandboxes de développement/exécution user code :
- certaines dépendances Python et Node natives sont plus pénibles avec `musl`
- compatibilité binaire plus délicate qu’avec des images basées glibc
- debug parfois plus complexe
- build de modules natifs plus fragile

### Mon avis
Pour des tools utilisateur TypeScript/Python avec dépendances variées, je recommande plutôt :
- **Debian slim**

- Avantages :

Compatibilité :

glibc évite les problèmes avec les bibliothèques Python/Node.js.
Moins de risques de bugs liés à musl (Alpine) ou à l'absence de shell (Distroless).

Débogage facilité :

Vous aurez besoin de déboguer les sandboxes (ex: logs, inspection des processus).
bash, apt, et les outils GNU sont indispensables pour cela.

Équilibre taille/sécurité :

70 Mo est un compromis acceptable pour des sandboxes éphémères.
Vous pouvez encore réduire la taille en supprimant les paquets inutiles après installation.



### Stratégie raisonnable
- **Node runtime** : `node:<version>-bookworm-slim` ou équivalent slim
- **Python runtime** : `python:<version>-slim`
- images de build séparées des images de run

Donc :
> **Je ne recommande pas Alpine comme choix par défaut mais Debian Slim** pour vos sandboxes utilisateurs si vous attendez de la souplesse côté dépendances.

---

## 11. Architecture technique détaillée recommandée

## 11.1 Composants backend

### A. Tool Registry
Stocke dans MongoDB :
- id tool
- owner
- version
- runtime (`typescript`, `python`)
- entrypoint
- schema input/output
- permissions réseau
- permissions FS
- variables nécessaires
- stratégie de build
- hash de contenu
- statut de validation

### B. Workspace Manager
Gère :
- création de workspace user/projet
- checkout git
- lecture/écriture contrôlée
- manifests de dépendances
- snapshots
- quotas disque

### C. Build Service
Responsable de :
- installation dépendances
- cache npm/pip
- création d’artefacts versionnés
- génération éventuelle d’image OCI dédiée
- scan de sécurité

### D. Execution Orchestrator
Responsable de :
- planification des runs
- allocation sandbox
- injection input
- politique d’accès
- timeout
- collecte logs
- destruction sandbox

### E. Policy Engine
Décide :
- accès réseau oui/non
- domaines autorisés
- temps CPU max
- mémoire max
- disque max
- accès à secrets
- nombre de forks / threads
- possibilité ou non d’appeler git

### F. Secret Broker
Les secrets ne doivent jamais être stockés dans le code user.
Le broker fournit :
- secrets à la demande,
- scope minimal,
- durée de vie courte,
- redaction dans logs.

---

## 11.2 Runtimes supportés

### Runtime TypeScript
Deux modèles :

#### Modèle A — exécution TS via transpilation préalable
- build avec `tsc` ou `esbuild`
- run en Node.js sur JS généré
- plus stable, plus prévisible

#### Modèle B — exécution directe via runtime TS
- plus confortable pour dev
- moins optimal en prod

### Recommandation
- **dev** : support TS direct si besoin
- **run prod** : transpiler en JS et exécuter sur Node

### Runtime Python
- environnements isolés par run
- dépendances installées à partir de lockfile si possible
- support `requirements.txt` au début
- viser ensuite `pyproject.toml` + lock

---

## 12. Cycle de vie d’un tool utilisateur

## 12.1 Création / import
L’utilisateur :
- crée ou importe un tool
- choisit runtime TS ou Python
- édite code et manifest
- déclare schéma d’entrée/sortie
- déclare permissions nécessaires

## 12.2 Validation statique
Le système :
- parse le manifest
- lint minimal
- vérifie entrypoint
- vérifie taille, fichiers interdits, binaires interdits
- inspecte imports sensibles

## 12.3 Build
Le système :
- installe dépendances dans un environnement build isolé
- produit un artefact
- calcule hash / version
- journalise provenance

## 12.4 Exécution
Le système :
- crée sandbox éphémère
- monte artefact et input
- injecte secrets autorisés
- exécute
- capture sortie standard, erreurs, fichiers de sortie
- détruit la sandbox

## 12.5 Audit
MongoDB stocke :
- qui a exécuté quoi
- version du tool
- hash
- policy appliquée
- durée
- consommation
- résultat

---

## 13. Gestion des dépendances

La partie la plus dangereuse vient souvent des dépendances.

## Recommandations
- imposer fichiers déclaratifs :
  - `package.json` + lockfile
  - `requirements.txt` ou lock Python
- interdire installation interactive arbitraire en prod run
- séparer :
  - phase build/install
  - phase run
- maintenir caches de packages partagés mais contrôlés
- scanner dépendances
- limiter ou bloquer scripts post-install si possible
- versionner les artefacts produits

### Très important
Ne laissez pas un tool exécuter `npm install` ou `pip install` à chaud dans son run normal, sauf sandbox dédiée de build.

---

## 14. Réseau : point critique

Par défaut :
- **pas d’accès réseau**

Ensuite, policy explicite :
- aucun réseau
- réseau sortant limité à liste blanche
- DNS contrôlé
- blocage accès metadata locales
- interdiction du réseau interne Docker
- pas d’accès à MongoDB
- pas d’accès aux services backend internes

### Pourquoi
Le principal risque d’un code utilisateur n’est pas juste “casser la sandbox”, mais :
- exfiltrer des secrets,
- scanner votre réseau interne,
- appeler des endpoints sensibles,
- miner ou relayer du trafic.

---

## 15. Système de fichiers

### Recommandations
- root filesystem en lecture seule
- workspace monté en lecture seule pendant run si possible
- dossier output séparé en écriture
- `tmpfs` limité pour temporaire
- quotas disque
- pas de montage du Docker socket
- aucun montage host sensible
- artefacts de sortie filtrés

### À proscrire absolument
- montage `/var/run/docker.sock`
- conteneurs privilégiés
- user root
- bind mount trop large du host

---

## 16. Sécurité des secrets

### Règles
- secrets stockés hors code utilisateur
- secrets chiffrés au repos
- injection uniquement au moment du run
- expiration courte
- permissions minimales
- audit des usages
- masquage en logs
- séparation secrets user / secrets plateforme / secrets provider

### Bon pattern
Le tool demande une capacité logique :
- `openai:invoke`
- `github:repo-read`
- `webhook:send`

Le backend résout ensuite le secret autorisé, sans exposition inutile.

---

## 17. Gouvernance des tools et agents

Inspiré des meilleurs patterns agentiques 2026 :

### Les agents ne doivent pas pouvoir :
- créer librement un tool exécutable sans validation,
- élever eux-mêmes leurs permissions,
- appeler n’importe quel outil réseau,
- obtenir des secrets non approuvés.

### Mettre en place :
- versionning des tools,
- approbation optionnelle avant publication,
- niveaux de confiance :
  - interne approuvé
  - partenaire
  - utilisateur privé
  - non vérifié
- politiques d’exécution selon niveau de confiance

---

## 18. MongoDB : ce qu’il faut stocker

Collections recommandées :

### `users_settings`
- profil
- quotas
- préférences
- références workspace

### `projects`
- owner
- git config
- branches
- permissions

### `user_tools`
- metadata
- runtime
- versions
- manifest
- policy
- hash

### `user_tool_runs`
- tool version
- user
- inputs
- outputs metadata
- logs refs
- statut
- ressources consommées

### `maps`
- graph métier

### `nodes`
- config node

### `agent_instances_`
- config agent
- tools autorisés
- mémoire / policy

### `secrets_metadata`
- alias
- owner
- scope
- date rotation

---

## 19. Préconisations d’implémentation par phases

## Phase 1 — MVP robuste
Objectif : livrer vite sans dette de sécurité trop grave.

### À faire
- workspace persistant par user/projet
- exécution tool en conteneur éphémère
- runtime Node + Python séparés
- Docker rootless
- user non root
- read-only fs
- timeout / memory / cpu quotas
- réseau désactivé par défaut
- logs centralisés
- versioning des tools
- schémas d’entrée/sortie validés
- stockage des artefacts dans workspace/output

### À éviter
- conteneur persistant utilisé aussi pour exécution
- Alpine par défaut pour tous les cas
- accès réseau global
- installation de dépendances en run

---

## Phase 2 — Industrialisation
- cache de builds npm/pip
- lockfiles obligatoires
- scan dépendances
- allowlist réseau
- secret broker
- policy engine
- snapshots workspace
- support git
- queue d’exécution
- retries contrôlés
- métriques d’usage

---

## Phase 3 — Sécurité renforcée
- gVisor ou Firecracker pour code non fiable
- attestation d’artefacts
- signature d’images
- analyse statique plus poussée
- sandbox de build distincte de sandbox de run
- niveaux de confiance des tools
- approbation humaine sur capacités sensibles

---

## 20. Réponse directe à votre question

## “Créer un container Docker par utilisateur dès qu’il ouvre un compte, est-ce une bonne solution ?”

### Réponse courte
**Pas comme solution principale.**

### Pourquoi
Parce que cela mélange :
- persistance,
- dev,
- build,
- exécution,
dans un seul objet opérationnel.

C’est pratique au début, mais c’est moins fiable, moins sûr et moins scalable.

---

## 21. Ce que je recommande à la place

## Solution optimale locale, gratuite, compatible avec votre stack en 2026

### Architecture recommandée
- **1 ou plusieurs workflows persistants par utilisateur**
- **0 conteneur permanent si inactif**
- **1 sandbox éphémère par exécution**
- **1 sandbox de build distincte si nécessaire**
- **runtimes séparés Node/Python**
- **policies de sécurité centralisées**

### Technologie recommandée
#### Par ordre de pragmatisme
1. **Docker rootless durci**
2.  **Firecracker microVM** pour la cible sécurité optimale

### Mon choix final
- **MVP** : Docker rootless durci
- **Cible sérieuse 2026** : Firecracker pour exécutions user-generated

---

## 22. Préconisations concrètes si vous gardez Docker

Si vous restez sur Docker, voici les préconisations minimales :

### Isolation
- rootless Docker
- user non root
- `--cap-drop=ALL`
- `--security-opt=no-new-privileges:true`
- seccomp profile durci
- AppArmor/SELinux
- pids limit
- read-only root fs

### Ressources
- `--memory`
- `--cpus`
- `--pids-limit`
- stockage temporaire limité
- timeout par process
- watchdog backend

### Réseau
- `--network=none` par défaut
- réseau dédié filtré si nécessaire
- DNS contrôlé
- egress allowlist

### Fichiers
- volumes précis uniquement
- workspace RO
- dossier output RW
- tmpfs limité
- pas de montages host critiques

### Opérations
- destruction systématique après run
- logs structurés
- métriques run
- nettoyage automatique
- rotation images
- patch management

### Images
- Debian slim ou équivalent
- image build != image run
- base versionnée
- digest pinning

---

## 23. Points d’attention spécifiques aux Tools IA

Les tools IA ne sont pas juste du code arbitraire ; ils deviennent des capacités actionnables par les agents.

### Donc il faut :
- descriptions strictes des tools
- schémas d’entrée/sortie
- idempotence si possible
- permissions déclaratives
- observation complète, gestion des erreurs et stacktraces
- implémentation de hooks preToolUse et PostToolUse pour monitoring et gestion des erreurs
- garde-fous humains sur actions critiques
- limitation des effets de bord

C’est totalement aligné avec les meilleures pratiques agentiques 2026 observées chez les acteurs avancés comme Anthropic :  
**un agent fiable est d’abord un agent dont les tools sont bien gouvernés.**

---

## 24. Recommandation finale

### Je déconseille
Le modèle :
> “On crée un conteneur Alpine persistant par utilisateur dès la création de compte, et il servira de sandbox de développement/exécution.”

### Je recommande
Le modèle :
> “On crée un workspace persistant par utilisateur/projet, et chaque invocation de tool est exécutée dans une sandbox éphémère, isolée, limitée, auditée.”

### Stack cible recommandée
- Backend orchestration : **Node.js / TypeScript**
- UI : **React**
- Persistance : **MongoDB**
- Workspace : volumes / répertoires dédiés
- Runtime sandbox MVP : **Docker rootless durci**
- Runtime sandbox cible : **Firecracker** ou **gVisor**
- Runtimes tools :
  - **Node.js** pour tools TS compilés
  - **Python** pour tools Python
- Build service séparé
- Policy engine + secret broker + observability

---

## 25. Formulation de décision d’architecture

### ADR proposé
**Décision :**  
Adopter une architecture de sandboxing basée sur des **workspaces persistants** et des **environnements d’exécution éphémères**, plutôt qu’un conteneur persistant par utilisateur créé à l’inscription.

**Raisons :**
- meilleure isolation,
- meilleure reproductibilité,
- meilleur coût opérationnel,
- meilleure montée en charge,
- meilleure sécurité,
- meilleure séparation des responsabilités.

**Conséquences :**
- besoin d’un orchestrateur d’exécution,
- besoin d’un service de build,
- besoin d’une politique de secrets et réseau,
- amélioration nette de la fiabilité long terme.

---

Si tu veux, je peux maintenant te fournir l’un des livrables suivants :

1. **une version encore plus “rapport d’architecture formel” en Markdown prêt à copier/coller**,  
2. **une ADR complète**,  
3. **un schéma d’architecture Mermaid**,  
4. **une proposition d’implémentation Node.js/TypeScript concrète**,  
5. **un comparatif Docker vs gVisor vs Firecracker sous forme de tableau décisionnel**.