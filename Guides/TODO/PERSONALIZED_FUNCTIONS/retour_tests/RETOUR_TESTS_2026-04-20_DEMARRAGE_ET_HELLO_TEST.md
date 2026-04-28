# Retour Tests - 2026-04-20

## 1. Contexte

- Deux agents testes avec des LLMs on-premise.
- Agent 1: LMStudio.
- Agent 2: Ollama.
- Ce fichier consolide les incidents de tests fonctionnels, de demarrage/authentification et de securite Docker releves pendant la session.

## 2. Test 1 - `hello_test` sur agent LMStudio

### 2.1 Resultat observe

- Le test semble avoir fonctionne.
- La fenetre agent affiche un resultat outil avec `executionId`.
- La reponse finale du LLM devient: `Bonjour Syl.`

### 2.2 Sortie observee

```text
Execution: utr-69e62accaf001003b75122eb
Input
📋
{}
Output (succès)
📋
{
  "result": "Ton nom est maintenant enregistré dans ma mémoire"
}
Résultat outil: hello_test
[executionId=utr-69e62accaf001003b75122eb] { "result": "Ton nom est maintenant enregistré dans ma mémoire" }
Bonjour Syl.
```

### 2.3 Points a surveiller

- Le tool semble bien execute.
- Le `tool_result` est visible dans la fenetre agent.
- Le champ `Input` affiche `{}` alors que le scenario semblait impliquer un prenom transmis au tool.
- Ce point devra etre analyse plus tard pour verifier si:
  - l'argument reel n'est pas transmis au backend,
  - l'UI affiche un resume vide par erreur,
  - ou le tool n'a pas besoin d'argument au moment du run reel.

## 3. Erreurs au demarrage et a la connexion

### 3.1 Ressources HTTP en echec `401 Unauthorized`

```text
Failed to load resource: the server responded with a status of 401 (Unauthorized)
localhost:3001/api/local-llm-profiles:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
localhost:3001/api/user/workspace:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
localhost:3001/api/llm/get-all-api-keys:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
localhost:3001/api/auth/refresh:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
localhost:3001/api/llm/get-all-api-keys:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
localhost:3001/api/llm/get-all-api-keys:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

### 3.2 Erreurs console associees

```text
AuthContext.tsx:302 [AuthContext] Local LLM profile load failed: Error: API Error: 401 Unauthorized
    at apiRequest (localLLMProfileService.ts:71:15)
    at async AuthContext.tsx:293:30
    at async Promise.all (:4000/index 1)
    at async AuthContext.tsx:317:38

apiClient.ts:183 [apiClient] Refresh token flow failed. Object
apiClient.ts:190 [apiClient] 401 Unauthorized — le token est peut-être expiré. Object
apiClient.ts:183 [apiClient] Refresh token flow failed. Object
apiClient.ts:190 [apiClient] 401 Unauthorized — le token est peut-être expiré. Object

App.tsx:407 [App] Workspace hydration error: AxiosError: Request failed with status code 401
    at settle (axios.js?v=3ad5d86a:1319:7)
    at XMLHttpRequest.onloadend (axios.js?v=3ad5d86a:1682:7)
    at Axios.request (axios.js?v=3ad5d86a:2328:41)
    at async hydrateWorkspace (App.tsx:402:37)

apiClient.ts:190 [apiClient] 401 Unauthorized — le token est peut-être expiré. Object
apiClient.ts:190 [apiClient] 401 Unauthorized — le token est peut-être expiré. Object

AuthContext.tsx:278 [AuthContext] Fetch error: Request failed with status code 401
```

## 4. Regroupement par symptome

### 4.1 Refresh token / session

- Echec sur `/api/auth/refresh`
- Logs repetes `Refresh token flow failed`
- Logs repetes `401 Unauthorized — le token est peut-être expiré`

### 4.2 Hydratation workspace apres connexion

- Echec sur `/api/user/workspace`
- Log `Workspace hydration error`

### 4.3 Chargement profils LLM locaux

- Echec sur `/api/local-llm-profiles`
- Log `Local LLM profile load failed`

### 4.4 Chargement cles API / configuration LLM

- Echec sur `/api/llm/get-all-api-keys`
- Plusieurs occurrences consecutives

## 5. Hypotheses a analyser plus tard

- Token d'acces absent, expire ou ecrase au demarrage.
- Refresh token absent, invalide ou non synchronise avec la session.
- Appels proteges declenches trop tot avant restauration auth complete.
- Strategie de retry frontend trop bruyante sur certains endpoints proteges.
- Desynchronisation entre `AuthContext`, `apiClient` et l'hydratation `App.tsx`.

## 6. Suite prevue

- Ajouter au besoin les autres problemes constates dans la meme logique de consolidation.
- Prioriser ensuite l'analyse et la correction en commencant par les bases Docker et leurs vulnerabilites.

## 7. Test 2 - `web_search_py` sur agent LMStudio

### 7.1 Demande utilisateur

```text
Bonjour, peux tu chercher sur internet quel temps il fera demain à Paris ?
```

### 7.2 Reponse observee dans le chat agent

```text
[Erreur LLM] Le modele local a retourne une reponse vide sans appel d'outil.
```

### 7.3 Logs frontend observes

```text
[V2AgentNode] Local AgentLoop tool scope Object
agentId: "69b2c89103adee7d771528d0"
agentName: "Lidar"
configuredToolIds: ['69b1455e8ac9fe4d5dd39dcf']
loadedFunctionCount: 12
nodeId: "node-69c4370a13838934fa95757b"
selectedCount: 1
selectedTools: [{…}]
[[Prototype]]: Object

lmStudioService.ts:326 [LMStudio] generateContentStream - endpoint: http://192.168.56.1:1234, model: qwen/qwen3.5-9b
useJournalQueue.ts:86 [JournalQueue] Skipping chat entry - save mode is 'manual' (use Save button)
```

### 7.4 Logs backend observes

```text
[LMStudio Proxy] {"timestamp":"2026-04-20T13:32:02.775Z","method":"POST","path":"/chat/completions","ip":"::1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36","endpoint":"http://localhost:11434","model":"ministral-3:8b","messagesCount":5,"stream":true}
[LMStudio Proxy] Chat completion request - Model: ministral-3:8b, Stream: true
[LMStudio Proxy] POST /chat/completions - 200 (3748ms)
[LMStudio Proxy] {"timestamp":"2026-04-20T13:33:30.508Z","method":"POST","path":"/chat/completions","ip":"::1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36","endpoint":"http://192.168.56.1:1234","model":"qwen/qwen3.5-9b","messagesCount":3,"stream":true}
[LMStudio Proxy] Chat completion request - Model: qwen/qwen3.5-9b, Stream: true
[LMStudio Proxy] POST /chat/completions - 200 (123935ms)
```

### 7.5 Constats factuels a conserver

- Le scope outil semble correctement resolu cote frontend pour cet agent:
  - `configuredToolIds` contient bien un identifiant.
  - `selectedCount` vaut `1`.
  - `selectedTools` n'est pas vide.
- Aucun message d'erreur manifeste n'apparait en console frontend hors la reponse LLM vide dans le chat.
- Le backend ne remonte pas d'erreur HTTP sur le proxy LMStudio pour cette tentative.
- La requete vers `qwen/qwen3.5-9b` aboutit avec HTTP `200`, mais apres une duree tres longue (`123935ms`).
- Le symptome visible pour l'utilisateur reste une reponse vide sans appel d'outil, donc sans execution observable de `web_search_py`.

### 7.6 Statut

- Incident ajoute a la liste des problemes a traiter plus tard.
- Aucune analyse de cause racine ni plan de correction lance a ce stade.

## 8. Problemes Docker remontes par Visual Studio Code

### 8.1 `backend/docker/runtime/node/Dockerfile`

```text
resource: /c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/docker/runtime/node/Dockerfile
code: outdated_digest
message: The image digest is out of date
line: 1

resource: /c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/docker/runtime/node/Dockerfile
code: outdated_digest
message: The image digest is out of date
line: 44
```

Constats:

- Les deux stages referencent `debian:bookworm-slim` avec le meme digest epingle.
- L'alerte porte sur l'obsolescence du digest, pas sur une vulnerabilite explicite remontee par l'extension dans ce fichier.

### 8.2 `backend/docker/runtime/python-provisioning/Dockerfile`

```text
resource: /c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/docker/runtime/python-provisioning/Dockerfile
code: outdated_digest
message: The image digest is out of date
line: 1

resource: /c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/docker/runtime/python-provisioning/Dockerfile
code: critical_high_vulnerabilities
message: The image contains 3 high vulnerabilities
line: 1
target: https://hub.docker.com/layers/library/python/3.12-slim-bookworm/images/sha256-762eacdf75b7ab27e4f4e852e50aaf9fb66105267208615ac0a81fceb9339bf1
```

Constats:

- L'image est basee directement sur `python:3.12-slim-bookworm` epinglee par digest.
- L'extension remonte a la fois un digest obsolete et `3` vulnerabilites de niveau `high` sur cette base.

### 8.3 `backend/docker/runtime/python/Dockerfile`

```text
resource: /c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/docker/runtime/python/Dockerfile
code: outdated_digest
message: The image digest is out of date
line: 1

resource: /c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/docker/runtime/python/Dockerfile
code: critical_high_vulnerabilities
message: The image contains 3 high vulnerabilities
line: 1
target: https://hub.docker.com/layers/library/python/3.12-slim-bookworm/images/sha256-762eacdf75b7ab27e4f4e852e50aaf9fb66105267208615ac0a81fceb9339bf1

resource: /c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/docker/runtime/python/Dockerfile
code: outdated_digest
message: The image digest is out of date
line: 22
```

Constats:

- Le stage builder utilise `python:3.12-slim-bookworm` epingle par digest.
- Le stage final utilise `debian:bookworm-slim` epingle par digest.
- Les alertes combinent ici obsolescence de digests et vulnerabilites `high` sur la base Python du builder.

## 9. Complements importants pour la priorisation

- Les incidents Docker touchent les images de base servant au runtime Node et au runtime Python.
- Les deux Dockerfiles Python partagent la meme base `python:3.12-slim-bookworm`, ce qui suggere une remediation commune.
- Le Dockerfile runtime Python combine un builder Python vulnerable et un runtime Debian egalement signale comme obsolete sur son digest.

## 10. Validation effective de la phase Docker/runtime

### 10.1 Actions realisees

- Mise a jour conservative des digests de base sur:
  - `backend/docker/runtime/node/Dockerfile`
  - `backend/docker/runtime/python/Dockerfile`
  - `backend/docker/runtime/python-provisioning/Dockerfile`
- Conservation stricte des tags contractuels utilises par le backend:
  - `airdd2-runtime-node:bookworm-slim`
  - `airdd2-runtime-python:3.12-slim`
  - `airdd2-python-provisioning:3.12-slim`
- Rebuild des 3 images runtime.
- Validation de non-regression via les tests backend cibles du runtime et du sandbox Docker.

### 10.2 Resultats des validations fonctionnelles

- Rebuild des 3 images: succes.
- Verification runtime backend: images Node et Python detectees et valides.
- Suite backend runtime health: succes.
- Suite backend docker sandbox runner: succes.
- Image de provisioning Python executable correctement.

Conclusion fonctionnelle:

- La remise a niveau Docker/runtime est validee du point de vue non-regression.
- Aucun changement de contrat n'a ete introduit pour l'installation ou l'execution actuelle de l'application.

### 10.3 Qualification securite effective via Trivy

Le scan effectif a finalement pu etre qualifie via Trivy local, car Docker Scout etait detecte mais restait non authentifie en CLI.

Resultat global:

- `airdd2-runtime-node:bookworm-slim`: vulnerable `high/critical`
- `airdd2-runtime-python:3.12-slim`: vulnerable `high/critical`
- `airdd2-python-provisioning:3.12-slim`: vulnerable `high/critical`

### 10.4 Nature des vulnerabilites restantes

#### Runtime Node

Vulnerabilites principales detectees dans le socle Debian:

- `CVE-2026-0861` sur `libc-bin` et `libc6` - `HIGH`
- `CVE-2026-29111` sur `libsystemd0` et `libudev1` - `HIGH`
- `CVE-2025-69720` sur `libtinfo6`, `ncurses-base`, `ncurses-bin` - `HIGH`
- `CVE-2023-45853` sur `zlib1g` - `CRITICAL`, statut Trivy `will_not_fix`

Constat:

- Les vulnerabilites residuelles sont portees par le socle Debian reference par l'image epinglee, pas par une dependance Node ajoutee par notre code.

#### Runtime Python

Vulnerabilites principales detectees dans le socle Debian:

- `CVE-2026-0861` sur `libc-bin` et `libc6` - `HIGH`
- `CVE-2025-69720` sur `libncursesw6`, `libtinfo6`, `ncurses-base`, `ncurses-bin` - `HIGH`
- `CVE-2025-7458` sur `libsqlite3-0` - `CRITICAL`
- `CVE-2026-29111` sur `libsystemd0` et `libudev1` - `HIGH`
- `CVE-2023-45853` sur `zlib1g` - `CRITICAL`, statut Trivy `will_not_fix`

Constat:

- Les vulnerabilites residuelles sont egalement portees par la base systeme Debian de l'image runtime Python.
- Aucune derive n'indique ici un probleme specifique a `duckduckgo-search` ou aux dependances Python provisionnees par notre logique applicative.

#### Image Python provisioning

Vulnerabilites detectees similaires au runtime Python, avec en plus:

- `CVE-2026-28390` sur `libssl3` et `openssl` - `HIGH`
- Trivy indique une `FixedVersion` disponible `3.0.19-1~deb12u2` pour ces paquets.

Constat:

- L'image de provisioning porte un risque supplementaire lie a la presence d'OpenSSL non encore aligne sur la revision corrigee.
- Ce point est potentiellement corrigible par un durcissement cible de l'image de provisioning, mais cela sort du refresh conservative minimal deja valide.

### 10.5 Conclusion d'architecture pour la phase 1

- La partie `mise a jour Dockerfiles + rebuild + validation de non-regression` est terminee et validee.
- La partie `eradication complete des CVE high/critical` n'est pas terminee.
- La cause residuelle est majoritairement upstream/base-image, avec un cas de provisioning OpenSSL potentiellement traitable dans un lot dedie.

Position de cloture recommandee pour cette phase:

- Clore la phase 1 comme `socle runtime remis a niveau et qualifie`.
- Conserver comme dette securite explicite:
  - CVE Debian residuelles sur Node runtime
  - CVE Debian residuelles sur Python runtime
  - CVE OpenSSL de l'image Python provisioning a evaluer dans un lot de hardening cible