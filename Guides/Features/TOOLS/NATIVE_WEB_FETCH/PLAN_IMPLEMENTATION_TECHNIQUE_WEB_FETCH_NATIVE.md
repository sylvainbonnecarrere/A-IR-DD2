# Plan d'implementation technique - refonte native `web_fetch_py`

## 1. Qualification du chantier

- **Categorie concernee**: **fonction native applicative**
- **Design domain**:
  - catalogue seed natif
  - `user_tools` comme source d'autorite
  - `toolSelection` comme contrat canonique d'appel
- **Runtime domain**:
  - `POST /api/sandbox/run`
  - `SandboxService`
  - `ExecutionOrchestrator`
  - `DockerSandboxRunner`
  - wrapper Python natif
  - `backend/python/runner.py`
- **Autorite d'execution / observabilite**:
  - `user_tool_runs`
  - artefacts filesystem sous `output/`

Le chantier ne touche **ni** les fonctions custom workflow-scoped **ni** les tools provider/cloud.

---

## 2. Decision technique retenue

## 2.1 Solution cible

Refonte de `web_fetch_py` en **version unique HTTP-only**, avec:

1. `curl_cffi` pour le transport HTTP
2. `trafilatura` pour l'extraction principale Markdown
3. fallback `readability-lxml` puis `BeautifulSoup`
4. `privateContext` pour proxy et headers invisibles
5. artefacts standards `json` + `file` + `log`

## 2.2 Hors scope explicite

Exclus de cette implementation:

- Playwright
- Crawlee
- browser fallback
- Splash
- cache externe
- LLM embarque dans le tool
- nouveau runner
- changement de schema Mongo

---

## 3. Objectifs fonctionnels

Le nouveau `web_fetch_py` doit:

1. recuperer une page HTTPS de facon robuste
2. appliquer une garde SSRF stricte
3. retourner un contenu **LLM-friendly** en Markdown
4. produire des artefacts auditables
5. ne jamais exposer de secret dans `args`, `outputs`, ou les journaux visibles
6. lever explicitement les erreurs pour garder `user_tool_runs.status` coherent

---

## 4. Invariants d'architecture a preserver

1. `user_tools` reste l'unique autorite catalogue
2. `toolSelection` reste l'unique contrat d'appel agent
3. `web_fetch_py` reste un **tool natif readonly**
4. les dependances Python natives restent gerees par **`platform_provision`**
5. l'execution continue de passer par `ExecutionOrchestrator`
6. `user_tool_runs` reste l'autorite des erreurs, timings et artefacts
7. `privateContext` ne doit jamais etre persiste tel quel
8. aucun changement de semantique `tool` / `tool_result` en UI

---

## 5. Cheminement logique detaille de l'execution

## 5.1 Sequence complete runtime

```text
V2AgentNode / FunctionEditorTab
  -> toolSelectionResolver
  -> POST /api/sandbox/run
  -> sandbox.routes.ts
  -> SandboxService.runFunction()
  -> resolveVersionedExecutionTarget()
  -> ensureBuildReadyForTool()
  -> NativePythonProvisioningService (si requis)
  -> ensureRuntimeReadyForRun()
  -> ExecutionOrchestrator.execute()
  -> UserToolRunService.createQueuedRun()
  -> UserToolRunService.markRunning()
  -> DockerSandboxRunner.execute()
  -> runtimeWrappers.buildPythonNativeWrapper()
  -> backend/python/runner.py
  -> FUNCTION_REGISTRY["web_fetch_py"]
  -> native.web_fetch_py.run(context, args)
  -> ecriture artifacts sous output/web_fetch/*
  -> retour JSON wrapper
  -> ExecutionOrchestrator.collectOutputArtifacts()
  -> UserToolRunService.completeRun() / failRun() / timeoutRun()
  -> reponse API /api/sandbox/run
  -> affichage ToolCallBlock / rehydratation runs
```

## 5.2 Etapes logiques dans `web_fetch_py.run(context, args)`

Pipeline cible:

1. **ValidateInput**
   - verifie presence `url`
   - borne `timeout_seconds`
   - borne `max_content_chars`

2. **ValidateSecurity**
   - HTTPS only
   - hostname valide
   - blocage loopback / private / reserved
   - verification URL finale apres redirects

3. **ResolvePrivateOptions**
   - lit `context.private_context["web_fetch"]`
   - extrait `proxy`, `extra_headers`
   - n'injecte rien dans le resultat

4. **FetchDocument**
   - session `curl_cffi`
   - timeout
   - redirects limites
   - collecte `status_code`, `final_url`, `content_type`

5. **ExtractMainContent**
   - `trafilatura.extract(...)`
   - fallback `readability-lxml`
   - fallback `BeautifulSoup`
   - calcule `fallback_used`

6. **NormalizeOutput**
   - tronque proprement
   - calcule `excerpt`
   - calcule `word_count`
   - assemble payload final

7. **PersistArtifacts**
   - ecrit `result.json`
   - ecrit `content.md`
   - ecrit `raw.html` si explicitement demande

8. **RaiseExplicitFailure**
   - tout echec structurel leve une exception
   - jamais de faux succes metier

---

## 6. Design pattern SOLID recommande

## 6.1 Pattern global

Le package Python doit suivre un **Pipeline / Strategy hybride**:

- **Facade**: `main.py`
  - point d'entree unique `run(context, args)`
- **Strategy**: `extraction.py`
  - strategie principale `trafilatura`
  - fallback(s) encapsules
- **Adapter**: `http_client.py`
  - encapsule `curl_cffi`
- **Policy Object**: `security.py`
  - centralise les regles SSRF / URL
- **Writer**: `artifacts.py`
  - encapsule l'ecriture des artefacts

## 6.2 Application SOLID

### S - Single Responsibility

- `main.py`: orchestration uniquement
- `http_client.py`: fetch uniquement
- `security.py`: validation / policy uniquement
- `extraction.py`: transformation HTML -> Markdown
- `artifacts.py`: I/O disque uniquement

### O - Open/Closed

- ajout futur d'un nouvel extracteur sans modifier `main.py`
- ajout futur d'une nouvelle sanitation security sans casser les appels

### L - Liskov

- les extracteurs doivent partager un contrat simple:
  - `extract(html: str, max_chars: int) -> ExtractionResult`

### I - Interface Segregation

- pas de mega-module utilitaire
- contrats petits et explicites

### D - Dependency Inversion

Dans la mesure du possible, `main.py` depend de fonctions pures:

- `validate_url(...)`
- `fetch_page(...)`
- `extract_markdown(...)`
- `write_artifacts(...)`

Cela simplifie les tests cibles et limite le mocking complexe.

---

## 7. Arborescence cible

```text
backend/
  python/
    native/
      web_fetch_py_old.py
      web_fetch_py/
        __init__.py
        main.py
        http_client.py
        extraction.py
        security.py
        artifacts.py
        constants.py
        errors.py
        types.py
```

## 7.1 Responsabilites

- `__init__.py`
  - `from .main import run`

- `constants.py`
  - valeurs bornes et constantes

- `errors.py`
  - classes d'erreurs locales

- `types.py`
  - types locaux Python

- `security.py`
  - garde SSRF
  - verification URL finale

- `http_client.py`
  - fetch HTTP
  - proxy optionnel

- `extraction.py`
  - extraction Markdown
  - fallback(s)

- `artifacts.py`
  - ecriture `output/web_fetch/*`

- `main.py`
  - compose toutes les etapes

---

## 8. Contrat d'entree / sortie

## 8.1 Input public (`args`)

```json
{
  "url": "https://example.com/article",
  "timeout_seconds": 20,
  "max_content_chars": 500000,
  "include_html_snapshot": false,
  "extract_schema": null
}
```

## 8.2 Input prive (`privateContext`)

```json
{
  "web_fetch": {
    "proxy": "http://user:pass@host:port",
    "extra_headers": {
      "Accept-Language": "fr-FR,fr;q=0.9"
    }
  }
}
```

## 8.3 Regles de contrat

1. pas de proxy dans `args`
2. pas de headers sensibles dans `args`
3. pas de credentials dans `outputs.result`
4. pas de persistance brute du `privateContext`
5. pas d'appel LLM dans la fonction native

## 8.4 Output cible

```json
{
  "url": "https://example.com/article",
  "final_url": "https://example.com/article",
  "status_code": 200,
  "content_type": "text/html; charset=utf-8",
  "title": "Titre",
  "markdown": "# Titre\n\nContenu...",
  "excerpt": "Resume court",
  "word_count": 1234,
  "language": "fr",
  "used_strategy": "http_curl_cffi_trafilatura",
  "fallback_used": false,
  "truncated": false,
  "warnings": []
}
```

---

## 9. Contrat d'erreur

## 9.1 Principe

Le tool **doit lever** une exception des qu'un echec empeche un resultat exploitable.

Cela garantit:

- wrapper natif -> `success: false`
- `ExecutionOrchestrator` -> `failRun()` / `timeoutRun()`
- `user_tool_runs.status` coherent

## 9.2 Classes d'erreurs recommandees

```text
WebFetchValidationError
WebFetchSecurityError
WebFetchNetworkError
WebFetchTimeoutError
WebFetchExtractionError
```

## 9.3 Mapping attendu

- erreurs de dependances -> `dependency_missing`
- erreurs d'execution -> `sandbox_runtime_error`
- timeout sandbox -> `timeout`

Le detail metier reste dans le message / traceback.

---

## 10. Politique runtime cible

```json
{
  "networkMode": "restricted",
  "timeoutSeconds": 30,
  "maxMemoryMb": 384,
  "writablePaths": ["output/web_fetch"],
  "secretAliases": []
}
```

Justification:

- reseau sortant requis
- extraction HTML plus lourde que l'ancienne version
- ecriture artefacts bornee et explicitement tracee

---

## 11. Evolution du seed natif

## 11.1 Changements cibles

1. `codePath`
   - ancien: `backend/python/native/web_fetch_py.py`
   - nouveau: `backend/python/native/web_fetch_py/main.py`

2. `dependencies`
   - supprimer `requests`
   - ajouter:
     - `curl_cffi`
     - `trafilatura`
     - `readability-lxml`
     - `beautifulsoup4`
     - `lxml`
   - `tiktoken` a confirmer pendant implementation

3. `inputSchema`
   - supprimer `headers`
   - remplacer `timeout` par `timeout_seconds`
   - remplacer `max_content_length` par `max_content_chars`

4. `outputSchema`
   - ajouter `markdown`, `final_url`, `used_strategy`, `fallback_used`, `warnings`

5. `healthCheck.criticalPythonImports`
   - `curl_cffi`
   - `trafilatura`
   - `readability`
   - `bs4`
   - `lxml`

## 11.2 Risque seed / read model

Le seed actuel est encore exprime dans une forme legacy-compatible.
L'implementation devra respecter la transformation de seeding existante sans changer le contrat global du catalogue.

---

## 12. Strategie d'artefacts

## 12.1 Arborescence

```text
output/
  web_fetch/
    result.json
    content.md
    raw.html
    debug.log
```

## 12.2 Regles

- `result.json` -> kind `json`
- `content.md` -> kind `file`
- `raw.html` -> kind `file`
- `debug.log` -> kind `log`

## 12.3 Ecriture conforme

Toujours via:

```python
context.workspace_path("output", "web_fetch", "result.json")
```

Jamais via un chemin absolu hardcode.

---

## 13. Jalons d'implementation pour le developpeur

## J0 - Baseline et TNR

### Objectif

Geler le comportement actuel et preparer les points de controle.

### Fichiers

```text
backend/src/__tests__/native-python-provisioning.service.test.ts
backend/src/__tests__/sandbox.routes.test.ts
backend/src/__tests__/execution-orchestrator.test.ts
```

### Actions

1. identifier les tests existants impactes
2. dupliquer les fixtures `web_fetch_py` vers la future arborescence packagee
3. ajouter les premiers TNR avant refonte

### Critere d'acceptation

- le baseline est explicite
- les futurs points de rupture sont couverts

---

## J1 - Refactor package natif et registre

### Objectif

Passer de `web_fetch_py.py` a un package Python sans casser le runtime.

### Fichiers

```text
backend/python/native/web_fetch_py.py
backend/python/native/web_fetch_py_old.py
backend/python/native/web_fetch_py/__init__.py
backend/python/native/web_fetch_py/main.py
backend/python/runner.py
```

### Actions

1. renommer l'ancien fichier en `web_fetch_py_old.py`
2. creer le package `web_fetch_py/`
3. exposer `run` via `__init__.py`
4. verifier l'import dans `runner.py`

### Critere d'acceptation

- `FUNCTION_REGISTRY["web_fetch_py"]` pointe vers le nouveau package
- aucun autre natif n'est impacte

---

## J2 - Security layer + input validation

### Objectif

Introduire la couche de garde sans encore complexifier le fetch.

### Fichiers

```text
backend/python/native/web_fetch_py/security.py
backend/python/native/web_fetch_py/errors.py
backend/python/native/web_fetch_py/constants.py
backend/python/native/web_fetch_py/types.py
backend/python/native/web_fetch_py/main.py
```

### Actions

1. valider `url`
2. forcer HTTPS only
3. bloquer hostnames / IPs internes
4. borner timeout et taille

### Critere d'acceptation

- URL invalide -> erreur explicite
- URL interne -> erreur explicite
- parametres hors bornes -> rejet

---

## J3 - HTTP client `curl_cffi`

### Objectif

Remplacer `requests` par `curl_cffi` dans une couche dediee.

### Fichiers

```text
backend/python/native/web_fetch_py/http_client.py
backend/python/native/web_fetch_py/main.py
```

### Actions

1. encapsuler la session HTTP
2. ajouter proxy optionnel via `privateContext`
3. limiter redirects
4. remonter `status_code`, `final_url`, `content_type`

### Critere d'acceptation

- fetch simple OK
- timeout remonte proprement
- proxy non expose dans le resultat

---

## J4 - Extraction pipeline Markdown

### Objectif

Mettre en place le pipeline `trafilatura` + fallback(s).

### Fichiers

```text
backend/python/native/web_fetch_py/extraction.py
backend/python/native/web_fetch_py/main.py
```

### Actions

1. extraction primaire `trafilatura`
2. fallback `readability-lxml`
3. fallback `BeautifulSoup`
4. calcul `fallback_used`, `excerpt`, `word_count`

### Critere d'acceptation

- HTML "propre" -> markdown exploitable
- HTML bruite -> fallback actif
- page vide / extraction vide -> erreur explicite

---

## J5 - Artefacts et output model

### Objectif

Standardiser l'I/O runtime et les artefacts.

### Fichiers

```text
backend/python/native/web_fetch_py/artifacts.py
backend/python/native/web_fetch_py/main.py
backend/src/__tests__/execution-orchestrator.test.ts
```

### Actions

1. ecrire `result.json`
2. ecrire `content.md`
3. ecrire `raw.html` seulement si demande
4. s'assurer que l'orchestrateur les detecte

### Critere d'acceptation

- artefacts visibles dans `metadata.artifacts`
- kinds conformes (`file`, `json`, `log`)

---

## J6 - Seed, provisioning et readiness

### Objectif

Connecter le nouveau package au catalogue natif et au provisioning.

### Fichiers

```text
backend/src/seeds/nativeFunctions.seed.ts
backend/src/services/nativePythonProvisioning.service.ts
backend/src/__tests__/native-python-provisioning.service.test.ts
```

### Actions

1. mettre a jour `codePath`
2. mettre a jour `dependencies`
3. mettre a jour `criticalPythonImports`
4. verifier `buildStatus` / `validationStatus`

### Critere d'acceptation

- provisioning OK
- readiness `runnable` conforme

---

## J7 - Integration sandbox et TNR final

### Objectif

Verifier le chemin complet backend runtime.

### Fichiers

```text
backend/src/routes/sandbox.routes.ts
backend/src/services/sandbox.service.ts
backend/src/__tests__/sandbox.routes.test.ts
```

### Actions

1. execution par `toolSelection`
2. passage `privateContext`
3. verification des erreurs structurees
4. verification runs / artefacts

### Critere d'acceptation

- run complet editor + workflow OK
- erreurs coherentes avec ledger

---

## 14. Plan de tests unitaire / service / TNR

## 14.1 Philosophie de test

Dans la stack actuelle, prioriser:

1. **service tests backend Jest**
2. **route tests backend Jest**
3. **tests orchestrateur / provisioning**

Ne pas introduire un outillage Python de test supplementaire pour ce chantier sauf decision explicite.

## 14.2 Matrice de tests

| Niveau | Cible | But |
|---|---|---|
| TNR service | `NativePythonProvisioningService` | garantir provisioning + imports |
| TNR runtime | `ExecutionOrchestrator` | garantir collecte artefacts |
| TNR route | `sandbox.routes` | garantir contrat API |
| Unit logique | `security.py` via sandbox/integration ciblée | garantir garde SSRF |
| Unit logique | `extraction.py` via sandbox/integration ciblée | garantir fallback extraction |

---

## 15. Tests a ajouter / adapter

## 15.1 Provisioning

### Cible

`backend/src/__tests__/native-python-provisioning.service.test.ts`

### Cas

1. provisionne `web_fetch_py` avec nouvelles deps
2. valide imports critiques `curl_cffi`, `trafilatura`, `readability`, `bs4`, `lxml`
3. marque la version `built`
4. marque `failed` si import critique manquant

### Exemple de test attendu

```ts
it('provisions web_fetch_py with curl_cffi and trafilatura and marks version built', async () => {
  // fixture native tool web_fetch_py
  // dependencies python = ['curl_cffi>=0.7', 'trafilatura>=2.0', ...]
  // fake runner returns success JSON
  // expect report.criticalModules to contain curl_cffi + trafilatura
  // expect currentVersion.buildStatus = 'built'
})
```

## 15.2 Orchestrateur / artefacts

### Cible

`backend/src/__tests__/execution-orchestrator.test.ts`

### Cas

1. detecte `output/web_fetch/result.json`
2. detecte `output/web_fetch/content.md`
3. detecte `output/web_fetch/raw.html` si snapshot active
4. persiste les kinds conformes

### Exemple de test attendu

```ts
it('captures web_fetch artifacts and persists them on the run', async () => {
  // fake docker runner writes output/web_fetch/result.json + content.md
  // expect result.metadata.artifacts to include json + file
  // expect completeRun called with outputs.artifacts
})
```

## 15.3 Route sandbox

### Cible

`backend/src/__tests__/sandbox.routes.test.ts`

### Cas

1. execute un natif via `toolSelection`
2. transmet `privateContext`
3. remonte une 409 si provisioning requis
4. remonte une erreur structuree si echec runtime

### Exemple de test attendu

```ts
it('passes privateContext to sandbox execution for native web_fetch_py', async () => {
  // POST /api/sandbox/run with toolSelection + privateContext.web_fetch.proxy
  // spy on ExecutionOrchestrator.execute
  // expect execute called with privateContext
})
```

## 15.4 TNR securite

### Cible

test backend dedie ou extension route/orchestrator

### Cas

1. `http://example.com` refuse
2. `https://127.0.0.1/...` refuse
3. `https://localhost/...` refuse
4. redirect final vers URL interne refuse

### Exemple de test attendu

```ts
it('fails native web_fetch_py on non-https or internal targets', async () => {
  // sandbox response should be failed / 500 depending slice tested
  // persisted run should not be completed
})
```

## 15.5 TNR non-fuite `privateContext`

### Cas

1. proxy present dans `privateContext`
2. resultat ne contient pas le proxy
3. stderr/outputs n'exposent pas les credentials

### Exemple de test attendu

```ts
it('does not expose proxy credentials in outputs.result', async () => {
  // expect JSON.stringify(output).not.toContain('user:pass')
})
```

---

## 16. Tests de non-regression obligatoires avant validation finale

Checklist TNR:

1. provisioning `web_fetch_py`
2. run manuel depuis `/api/sandbox/run`
3. run workflow via `toolSelection`
4. detection artefacts
5. statut `user_tool_runs` correct
6. absence de fuite `privateContext`
7. URL interne refusee
8. timeout remonte proprement

---

## 17. Critere definition of done

Le chantier est termine quand:

1. `web_fetch_py` pointe vers le nouveau package
2. le provisioning passe avec les nouvelles dependances
3. la route sandbox execute la fonction sans fallback legacy
4. `user_tool_runs` est `completed` en succes et `failed` en echec reel
5. les artefacts `output/web_fetch/*` sont detectes
6. les tests TNR passes couvrent provisioning, route, orchestrateur, securite
7. aucun secret de `privateContext` n'apparait dans les outputs ou journaux visibles

---

## 18. Risques residuels et parades

### Risque 1 - fragilite provisioning

Cause:

- `curl_cffi` plus sensible que `requests`

Parade:

- TNR provisioning strict
- imports critiques seeds

### Risque 2 - extraction vide

Cause:

- HTML atypique

Parade:

- fallback parser
- erreur explicite si contenu insuffisant

### Risque 3 - SSRF incomplet

Cause:

- validation initiale mais redirect finale insuffisamment couverte

Parade:

- verifier URL initiale et finale
- ajouter un test TNR dedie

### Risque 4 - fuite de secrets

Cause:

- logging brut du contexte prive

Parade:

- ne jamais serialiser `privateContext`
- tests de non-fuite

---

## 19. Recommendation finale au developpeur

Implementer la refonte selon l'ordre suivant:

1. TNR
2. package natif + registre
3. security layer
4. http client
5. extraction pipeline
6. artefacts
7. seed + provisioning
8. integration sandbox
9. TNR final

Le bon compromis d'architecture est:

- **Facade + Pipeline** pour l'orchestration
- **Strategy** pour l'extraction
- **Adapter** pour `curl_cffi`
- **Policy Object** pour la securite

Cette approche est:

- SOLID
- testable
- compatible avec le runtime reel
- sans regression sur la persistance ni la rehydratation UI

