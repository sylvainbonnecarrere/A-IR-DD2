# Plan de correction detaille - 2026-04-20

## 1. Objectif

Ce document transforme le plan de correction valide en plan d'execution professionnel, axe par axe, avec:

- analyse du code actuel,
- proposition de correction robuste et conforme aux principes SOLID,
- analyse des composants impactes et des risques de regression,
- jalons de tests pour valider chaque etape.

Le point de depart factuel reste le rapport consolide dans [RETOUR_TESTS_2026-04-20_DEMARRAGE_ET_HELLO_TEST.md](RETOUR_TESTS_2026-04-20_DEMARRAGE_ET_HELLO_TEST.md).

## 2. Vue d'ensemble des 6 axes

### Axe 1 - Assainissement Docker et base runtime

But: remettre a niveau les images de base Node et Python, supprimer les digests obsoletes et traiter les vulnerabilites remontees par Docker DX.

### Axe 2 - Stabilisation du bootstrap d'authentification

But: supprimer les `401` en cascade au demarrage et restaurer une sequence auth -> refresh -> chargement config -> hydratation workspace deterministe.

### Axe 3 - Revalidation fonctionnelle des parcours critiques

But: rejouer les scenarios critiques dans un environnement stabilise, avec des tests de non-regression cibles.

### Axe 4 - Correction robuste du scenario `web_search_py`

But: eliminer le symptome `reponse vide sans appel d'outil` lorsque le scope outil est present et que le backend LMStudio retourne HTTP `200`.

### Axe 5 - Correction de la trace `Input {}`

But: garantir que la trace d'execution dans l'UI reflete fidelement les arguments reels transmis au tool.

### Axe 6 - Reprise fiable apres veille et restauration visuelle du workflow

But: garantir qu'un utilisateur qui revient sur la page apres une longue veille retrouve immediatement sa carte du workflow sans disparition transitoire des agents deja sauvegardes.

## 3. Impact global et ordre d'execution

### 3.1 Composants impactes

- Docker runtime:
  - [backend/docker/runtime/node/Dockerfile](backend/docker/runtime/node/Dockerfile)
  - [backend/docker/runtime/python/Dockerfile](backend/docker/runtime/python/Dockerfile)
  - [backend/docker/runtime/python-provisioning/Dockerfile](backend/docker/runtime/python-provisioning/Dockerfile)
- Bootstrap auth et hydratation:
  - [contexts/AuthContext.tsx](contexts/AuthContext.tsx)
  - [utils/apiClient.ts](utils/apiClient.ts)
  - [App.tsx](App.tsx)
  - services associes de chargement runtime
- Tool calling local:
  - [components/V2AgentNode.tsx](components/V2AgentNode.tsx)
  - [services/adapters/LocalLLMAdapter.ts](services/adapters/LocalLLMAdapter.ts)
  - [services/llm/AgentLoop.ts](services/llm/AgentLoop.ts)
  - [services/lmStudioService.ts](services/lmStudioService.ts)
- Trace d'execution outil:
  - [components/workflow/ToolCallBlock.tsx](components/workflow/ToolCallBlock.tsx)
  - persistance ou reconstruction des `ToolCallRecord`
- Reprise de session et rehydratation apres veille:
  - [App.tsx](App.tsx)
  - [contexts/AuthContext.tsx](contexts/AuthContext.tsx)
  - [utils/apiClient.ts](utils/apiClient.ts)
  - [hooks/useWorkspaceHydration.ts](hooks/useWorkspaceHydration.ts)

### 3.2 Ordre valide

1. Docker
2. Auth/bootstrap
3. Reruns fonctionnels et TNR de socle
4. `web_search_py`
5. `Input {}`
6. reprise apres veille / resume navigateur

Cet ordre reste le bon car il traite d'abord le socle technique, puis la session applicative, puis les parcours fonctionnels, puis la qualite de la trace.

## 4. Axe 1 - Docker et supply chain

### 4.1 Analyse du code actuel

Etat observe:

- [backend/docker/runtime/node/Dockerfile](backend/docker/runtime/node/Dockerfile) epingle `debian:bookworm-slim` sur les deux stages avec un digest devenu obsolete.
- [backend/docker/runtime/python/Dockerfile](backend/docker/runtime/python/Dockerfile) combine:
  - un builder `python:3.12-slim-bookworm` avec digest obsolete et vulnerabilites `high`,
  - un stage final `debian:bookworm-slim` egalement obsolete.
- [backend/docker/runtime/python-provisioning/Dockerfile](backend/docker/runtime/python-provisioning/Dockerfile) repose directement sur `python:3.12-slim-bookworm` avec les memes alertes.

Analyse architecture:

- Le design est deja plutot sain: builder distinct, runtime aminci, suppression de `pip` dans le runtime Python, suppression de `npm` dans le runtime Node.
- La faiblesse actuelle n'est pas conceptuelle mais operationnelle: la gouvernance des bases images n'est pas centralisee.
- Le choix des digests est duplique entre fichiers, ce qui viole partiellement le principe DRY et augmente le risque d'ecarts.

### 4.2 Correction cible SOLID et robuste

Approche recommandee:

- Introduire une politique explicite de gestion des images de base.
- Centraliser les versions/digests dans un point de verite unique si possible via `ARG` documentes ou un fichier de build/release dedie.
- Conserver l'approche multi-stage actuelle, car elle est coherente avec SRP:
  - stage builder = construction runtime,
  - stage final = execution minimale.

Correction robuste attendue:

1. Mettre a jour les digests obsoletes vers des digests sains et actuels.
2. Rescanner localement apres rebuild.
3. Verifier que les images finales restent minimales et fonctionnelles.
4. Si les vulnerabilites Python persistent malgre le refresh digest:
   - verifier si elles sont portees par la base officielle elle-meme,
   - envisager une montee de tag patch Python compatible,
   - documenter les exceptions si certaines CVE ne sont pas encore resolues upstream.

Principe SOLID applique:

- Single Responsibility: separer la gestion de version des images de la logique des Dockerfiles.
- Open/Closed: permettre la mise a jour des bases sans reecrire la logique runtime.
- Dependency Inversion: dependre d'une politique de versionnement explicite plutot que de valeurs dupliquees inline.

### 4.3 Risques de regression

- Changement involontaire de bibliotheques systeme attendues par Node/Python.
- Changement de comportement des images base upstream.
- Regressions silencieuses sur les probes de sante runtime ou l'execution sandbox.

### 4.4 Tests et jalons

Jalon A1.1 - Mise a jour des bases

- Modifier les 3 Dockerfiles.
- Verifier que Docker DX ne signale plus `outdated_digest`.

Tests:

- Build image Node runtime.
- Build image Python runtime.
- Build image Python provisioning.
- Scan Docker DX ou equivalent.

Jalon A1.2 - Validation de non-regression runtime

Tests:

- Executer la suite backend sante runtime existante autour de [backend/src/__tests__/runtime-health.service.test.ts](backend/src/__tests__/runtime-health.service.test.ts).
- Verifier les images inspectees par les tests de runtime.
- Verifier le chargement des imports critiques `duckduckgo_search` pour `web_search_py`.

Critere de sortie:

- Images reconstruites.
- Digests obsoletes supprimes.
- Vulnerabilites reduites ou qualifiees.
- TNR runtime au vert.

## 5. Axe 2 - Bootstrap d'authentification

### 5.1 Analyse du code actuel

Etat observe dans [contexts/AuthContext.tsx](contexts/AuthContext.tsx):

- Le contexte gere trop de responsabilites:
  - hydration locale,
  - stockage session,
  - chargement des cles LLM,
  - chargement des profils LLM locaux,
  - construction des runtime configs,
  - gestion des erreurs auth.
- `fetchLLMApiKeys()` injecte explicitement un bearer token, ce qui contourne partiellement l'intercepteur global.
- `loadLocalLLMProfiles()` peut appeler l'API protegee pendant les phases sensibles de restauration.
- `refreshRuntimeConfigState()` orchestre plusieurs chargements mais sans machine d'etat explicite.

Etat observe dans [utils/apiClient.ts](utils/apiClient.ts):

- L'intercepteur lit et ecrit directement `auth_data_v1` dans `localStorage`.
- Le refresh token flow repose sur un singleton `refreshRequestPromise`, ce qui est bien, mais la logique de degradation session reste couplee au transport HTTP.
- Le client dispatch des evenements globaux de session, ce qui cree un couplage implicite entre couche HTTP et React.

Etat observe dans [App.tsx](App.tsx):

- L'hydratation du workspace depend de plusieurs conditions auth simultanees.
- `hydrateWorkspace()` efface des etats et lance ensuite une requete protegee `/api/user/workspace`.
- La sequence globale reste difficile a raisonner car la source d'autorite de l'etat session est partagee entre `AuthContext`, `apiClient` et `localStorage`.

Diagnostic principal:

- Le systeme souffre d'un manque de separation des responsabilites entre:
  - gestion de session,
  - transport HTTP,
  - chargement des ressources applicatives.
- C'est la cause la plus probable des `401` en cascade et du bootstrap fragile.

### 5.2 Correction cible SOLID et robuste

Approche recommandee:

- Introduire une orchestration de session explicite, idealement sous forme de `SessionBootstrapService` ou `useSessionBootstrap` dedie.
- Ramener `AuthContext` a un role de facade React mince.
- Garder `apiClient` comme transport, sans lui laisser la responsabilite implicite de l'orchestration produit.

Refactorisation cible:

1. Extraire la lecture/ecriture `AUTH_STORAGE_KEY` dans un repository de session unique.
2. Extraire la logique de refresh token dans un `AuthSessionService` ou equivalent.
3. Extraire le chargement post-auth des ressources runtime dans un service `RuntimeBootstrapService`.
4. Faire de [App.tsx](App.tsx) un simple consommateur d'un etat `sessionReadyForWorkspaceHydration`.

Flux cible:

1. Restaurer session locale.
2. Valider ou rafraichir le token si necessaire.
3. Charger les ressources auth-dependantes.
4. Declarer la session `ready`.
5. Hydrater le workspace.

Principe SOLID applique:

- Single Responsibility: un service de session, un service de bootstrap runtime, un client HTTP transport.
- Interface Segregation: eviter que `AuthContext` porte toute la politique auth.
- Dependency Inversion: React doit dependre d'abstractions de session et non de `localStorage` ou d'evenements `window` disperses.

### 5.3 Risques de regression

- Deconnecter accidentellement le guest mode.
- Introduire des deadlocks de chargement si les etats de bootstrap sont mal modelises.
- Casser les chargements LLM existants en cas de decouplage incomplet.

### 5.4 Tests et jalons

Strategie de decoupage recommandee:

- traiter l'axe 2 en plusieurs lots tres bornes,
- verrouiller chaque lot par TNR avant d'ouvrir le suivant,
- ne pas melanger dans un meme commit:
  - stockage session,
  - refresh token,
  - bootstrap runtime,
  - hydratation workspace.

### 5.4.1 Todo-list A2.1 - Repository de session unique

But:

- extraire la lecture/ecriture/suppression de `auth_data_v1` hors de [contexts/AuthContext.tsx](contexts/AuthContext.tsx) et [utils/apiClient.ts](utils/apiClient.ts),
- obtenir un point d'acces unique au stockage session.

Travaux:

- creer un `SessionStorageRepository` ou equivalent,
- remplacer les acces directs a `localStorage` dans [contexts/AuthContext.tsx](contexts/AuthContext.tsx),
- remplacer les acces directs a `localStorage` dans [utils/apiClient.ts](utils/apiClient.ts),
- conserver strictement le contrat de donnees actuel pour eviter toute migration implicite.

Tests de non-regression obligatoires:

- etendre [tests/unitaires/AuthContext.test.tsx](tests/unitaires/AuthContext.test.tsx) pour couvrir la restauration de session via le repository,
- garder verts les tests guest/auth de [tests/J4.4-AuthGuestIsolation.TNR.test.tsx](tests/J4.4-AuthGuestIsolation.TNR.test.tsx),
- garder verts les tests du client HTTP dans [tests/unitaires/apiClient.test.ts](tests/unitaires/apiClient.test.ts).

Tests fonctionnels cibles:

- login puis refresh navigateur,
- fermeture/reouverture onglet avec session persistante,
- mode guest intact sans token.

Critere de sortie A2.1:

- plus aucun acces direct a `auth_data_v1` hors repository,
- aucun changement visible de comportement en mode guest,
- refresh token existant toujours operationnel.

### 5.4.2 Todo-list A2.2 - Service de session et refresh token

But:

- isoler la logique de refresh token et de degradation de session du transport HTTP.

Travaux:

- extraire la logique `refreshRequestPromise` dans un `AuthSessionService` ou equivalent,
- laisser [utils/apiClient.ts](utils/apiClient.ts) comme simple consommateur de service,
- standardiser les evenements de session emis vers React,
- verifier que la degradation de session ne purge que quand le refresh a reellement echoue.

Tests de non-regression obligatoires:

- renforcer [tests/unitaires/apiClient.test.ts](tests/unitaires/apiClient.test.ts) avec un cas de `401` simultanes ne declenchant qu'un seul refresh,
- couvrir le cas `refresh_failed` sans boucle infinie,
- garder verts les tests `auth:session-refreshed` et `auth:session-degraded` existants.

Tests fonctionnels cibles:

- session expiree avec backend joignable puis refresh reussi,
- session expiree avec refresh invalide puis retour a un etat degrade propre,
- absence de cascade de `401` repetes dans la console au demarrage.

Critere de sortie A2.2:

- un seul refresh pour plusieurs `401` concurrents,
- degradation de session propre et explicite,
- plus de logique metier de session dispersee dans l'intercepteur HTTP.

### 5.4.3 Todo-list A2.3 - Bootstrap runtime post-auth

But:

- sortir du contexte auth le chargement fragile des ressources runtime dependantes de la session.

Travaux:

- introduire un `RuntimeBootstrapService` ou un hook `useSessionBootstrap`,
- deplacer le chargement des cles LLM et des profils locaux hors du coeur de [contexts/AuthContext.tsx](contexts/AuthContext.tsx),
- formaliser les etats `loading`, `restoring-session`, `ready`, `degraded` avec des transitions explicites,
- interdire les appels proteges tant que la session n'est pas declaree prete.

Tests de non-regression obligatoires:

- etendre [tests/unitaires/AuthContext.test.tsx](tests/unitaires/AuthContext.test.tsx) pour verifier qu'une session restauree passe bien par `restoring-session` puis `ready`,
- ajouter un test garantissant qu'un echec de chargement runtime ne casse pas le mode guest,
- verifier qu'aucun appel protege n'est emis avant etat `ready`.

Tests fonctionnels cibles:

- login complet avec chargement cles API + profils locaux,
- restauration de session apres refresh navigateur,
- session invalide au boot avec retour degrade propre et sans blocage UI.

Critere de sortie A2.3:

- [contexts/AuthContext.tsx](contexts/AuthContext.tsx) redevient une facade mince,
- le chargement runtime est deterministe,
- plus de couplage implicite entre hydratation locale et appels API proteges.

### 5.4.4 Todo-list A2.4 - Hydratation workspace apres session prete

But:

- faire de [App.tsx](App.tsx) un simple consommateur d'un etat session stabilise pour recharger le workspace.

Travaux:

- conditionner l'appel a `/api/user/workspace` a un signal explicite `sessionReadyForWorkspaceHydration`,
- supprimer les wipes React/UI sur simple variation de token quand l'utilisateur reste identique,
- consolider la logique de rehydratation actuellement repartie entre [App.tsx](App.tsx) et [hooks/useWorkspaceHydration.ts](hooks/useWorkspaceHydration.ts),
- eviter les doubles chemins de bootstrap concurrents.

Tests de non-regression obligatoires:

- ajouter un TNR autour de [App.tsx](App.tsx) pour verifier que `/api/user/workspace` n'est appelee qu'apres session stable,
- ajouter un TNR sur refresh token reussi sans vidage visuel parasite,
- garder verts les tests de workflows/auth deja existants.

Tests fonctionnels cibles:

- login puis hydratation workspace sans cascade `401`,
- refresh navigateur avec restauration workspace immediate,
- reprise de session apres expiration du token sans disparition transitoire des donnees UI.

Critere de sortie A2.4:

- hydratation workspace strictement dependante d'un etat session stable,
- plus de reset visuel parasite lors d'un refresh token,
- parcours login -> refresh -> workspace deterministe.

### 5.4.5 Gate de validation entre lots

Avant d'ouvrir le lot suivant, exiger:

- TNR unitaires verts sur auth et api client,
- verification manuelle guest mode,
- verification manuelle login/logout,
- verification manuelle refresh token,
- absence de nouvelle cascade `401` au demarrage.

Jalon A2 global - Bootstrap d'authentification stabilise

Tests de synthese:

- [tests/unitaires/AuthContext.test.tsx](tests/unitaires/AuthContext.test.tsx),
- [tests/unitaires/apiClient.test.ts](tests/unitaires/apiClient.test.ts),
- [tests/J4.4-AuthGuestIsolation.TNR.test.tsx](tests/J4.4-AuthGuestIsolation.TNR.test.tsx),
- test semi-integration front simulant login puis hydratation sans cascade de `401`.

Critere de sortie:

- Suppression des `401` repetes au demarrage.
- Chargement fiable des profils LLM, des cles API et du workspace.

## 6. Axe 3 - Revalidation fonctionnelle des parcours critiques

### 6.1 Analyse du code actuel

Le projet dispose deja de TNR utiles:

- tests runtime health backend,
- tests `LocalLLMAdapter`,
- tests `AgentLoop`,
- tests `V2AgentNode`.

Le probleme n'est pas l'absence totale de tests mais le manque de jalonnement explicite entre:

- socle runtime,
- bootstrap session,
- tool calling local,
- restitution UI.

### 6.2 Correction cible SOLID et robuste

Approche recommandee:

- Construire une matrice de validation par couches.
- Chaque correction de couche doit avoir son jeu de TNR avant d'autoriser la suivante.

Organisation recommande:

1. TNR socle Docker/runtime.
2. TNR auth/bootstrap.
3. TNR tool calling local `hello_test`.
4. TNR tool calling local `web_search_py`.
5. TNR trace UI `tool` / `tool_result`.

Cette approche applique une forme de `Test Pyramid` pragmatique avec un principe d'isolation forte des causes de regression.

### 6.3 Risques de regression

- QA redonne un faux negatif si l'environnement Docker n'est pas a jour.
- Les tests de haut niveau deviennent trompeurs si les prerequis de couche inferieure ne sont pas gates.

### 6.4 Tests et jalons

Jalon A3.1 - Matrice de prerequis

Tests:

- runtime health backend,
- builds Docker,
- verification imports natifs critiques.

Jalon A3.2 - Matrice auth et workspace

Tests:

- login,
- restore session,
- refresh,
- hydratation workspace.

Jalon A3.3 - Matrice tools locaux

Tests:

- `hello_test` avec trace complete.
- `web_search_py` avec appel outil observable.
- test de non-repetition sur echec deterministe.

Critere de sortie:

- chaque etage est valide avant d'ouvrir le suivant.

## 7. Axe 4 - `web_search_py` et reponse vide sans appel d'outil

### 7.1 Analyse du code actuel

Etat observe:

- Le frontend indique un scope outil coherent dans [components/V2AgentNode.tsx](components/V2AgentNode.tsx).
- [services/adapters/LocalLLMAdapter.ts](services/adapters/LocalLLMAdapter.ts) collecte tout le flux texte puis parse les blocs `<tool_call>`.
- [services/llm/AgentLoop.ts](services/llm/AgentLoop.ts) transforme une reponse vide sans tool call en erreur terminale visible.
- [services/lmStudioService.ts](services/lmStudioService.ts) supporte deux modes:
  - tools natifs si le modele supporte le function calling,
  - sinon simple streaming texte.

Lecture du symptome:

- Ici, le symptome n'est pas `selectedCount: 0`.
- Ce n'est pas non plus un `HTTP 500` backend ou un echec sandbox explicite.
- Le point faible probable est la robustesse de la couche d'adaptation locale lorsque le modele:
  - repond hors protocole,
  - emet peu ou pas de contenu exploitable,
  - ou prend trop longtemps puis termine sur une sortie vide.

Faiblesse de conception actuelle:

- `LocalLLMAdapter` concentre a la fois:
  - enrichment prompt,
  - collecte streaming,
  - interpretation metier du flux,
  - normalisation d'erreur.
- Il manque probablement une politique plus explicite de classification des sorties locales:
  - vide,
  - texte libre,
  - tool block valide,
  - tool block malforme,
  - flux incomplet/timeboxed.

### 7.2 Correction cible SOLID et robuste

Approche recommandee:

- Introduire une couche dediee de normalisation des sorties locales, distincte du transport et distincte de l'orchestration `AgentLoop`.
- Faire porter a l'adapter le role de collecte, mais deleguer la classification finale a un composant specialise.

Refactorisation cible:

1. Extraire un `LocalLLMResponseClassifier` ou equivalent.
2. Distinguer clairement:
   - `empty_stream`,
   - `plain_text_without_tool`,
   - `strict_tool_call`,
   - `malformed_tool_call`,
   - `timeout_or_aborted_stream`.
3. Enrichir les traces pour stocker la raison precise de l'echec visible.
4. Ajouter une strategie de tolerance definie:
   - soit forcer strictement les blocs,
   - soit accepter un mode de secours pour certaines formulations simples si cela est produit-safe.

Principe SOLID applique:

- Single Responsibility: l'adapter ne doit pas porter seul collecte, parsing et politique produit.
- Open/Closed: de nouveaux comportements de modeles locaux doivent pouvoir etre classes sans reouvrir tout `AgentLoop`.
- Strategy Pattern: classification de sortie interchangeable selon fournisseur local ou famille de modeles.

### 7.3 Risques de regression

- Rendre le parseur trop permissif et reintroduire des faux positifs.
- Rendre le protocole trop strict et bloquer des modeles qui fonctionnaient deja.
- Masquer un vrai probleme reseau derriere une erreur produit trop generique.

### 7.4 Tests et jalons

Jalon A4.1 - Classification locale exhaustive

Tests:

- Etendre [tests/services/LocalLLMAdapter.test.ts](tests/services/LocalLLMAdapter.test.ts) avec:
  - flux vide,
  - texte libre sans tool,
  - tool block valide `web_search_py`,
  - tool block malforme,
  - flux interrompu/timeout.

Jalon A4.2 - Non-regression orchestration

Tests:

- Etendre [tests/services/AgentLoop.test.ts](tests/services/AgentLoop.test.ts) pour verifier:
  - propagation de la bonne erreur terminale,
  - absence de tempete de retries,
  - execution observable quand `web_search_py` est effectivement appele.

Jalon A4.3 - Validation UI workflow card

Tests:

- Etendre [tests/components/V2AgentNode.agentloop.test.tsx](tests/components/V2AgentNode.agentloop.test.tsx).
- Verifier le message visible pour chaque type d'echec.
- Verifier le cas nominal `web_search_py` avec trace `tool` puis `tool_result`.

Critere de sortie:

- le scenario `web_search_py` ne doit plus finir par une erreur vide opaque lorsque le modele renvoie une sortie exploitable.

## 8. Axe 5 - Correction de `Input {}`

### 8.1 Analyse du code actuel

Etat observe:

- [components/workflow/ToolCallBlock.tsx](components/workflow/ToolCallBlock.tsx) affiche simplement `toolCall.arguments`.
- Si `Input {}` apparait, le probleme n'est probablement pas le composant de rendu seul.
- La cause probable est plus amont:
  - arguments absents dans le `ToolCallRecord`,
  - arguments ecrases lors de la persistance/reconstruction,
  - mismatch entre `tool_call` parse et `tool_result` rattache.

Point important:

- Le rendu est actuellement passif et fidele a sa prop.
- La correction doit donc viser la source de verite des `ToolCallRecord`, pas seulement l'UI.

### 8.2 Correction cible SOLID et robuste

Approche recommandee:

- Definir un contrat explicite de trace d'execution outil.
- Garantir qu'un `ToolCallRecord` complet porte toujours:
  - id outil,
  - nom outil,
  - arguments originaux,
  - resultat,
  - executionId,
  - eventuels artefacts.

Refactorisation cible:

1. Identifier le point unique de construction du `ToolCallRecord` nominal.
2. Introduire une fabrique ou mapper unique pour les traces outil.
3. Bannir les reconstructions partielles ad hoc dans plusieurs composants.
4. Ajouter une validation defensive:
   - si les arguments attendus sont absents mais que le prompt ou le parse les contenait, logguer une anomalie structuree.

Principe SOLID applique:

- Single Responsibility: un seul constructeur de trace outil.
- DRY: plus de duplication des projections de `ToolCallRecord`.
- Liskov/consistance de contrat: qu'il s'agisse d'un run live ou persiste, la trace UI doit recevoir le meme shape.

### 8.3 Risques de regression

- Corriger l'UI sans corriger la source et seulement masquer le probleme.
- Casser l'affichage des runs persistants si le contrat change sans migration.

### 8.4 Tests et jalons

Jalon A5.1 - Contrat de trace outille

Tests:

- Completer [tests/components/ToolCallBlock.test.tsx](tests/components/ToolCallBlock.test.tsx) avec un cas ou les arguments non vides doivent etre visibles.
- Ajouter ou etendre les tests de persistance de run dans [tests/components/V2AgentNode.agentloop-persisted-run.test.tsx](tests/components/V2AgentNode.agentloop-persisted-run.test.tsx).

Jalon A5.2 - Cohabitation live et persiste

Tests:

- run live `hello_test` avec arguments non vides,
- rechargement du meme run depuis la persistance,
- verification que l'`Input` reste identique.

Critere de sortie:

- plus aucun cas connu ou un run avec arguments non vides s'affiche en `{}`.

## 9. Axe 6 - Reprise apres veille et disparition transitoire de la carte du workflow

### 9.1 Analyse du code actuel

Symptome terrain ajoute au plan:

- un utilisateur reste connecte sur la page "Carte du workflow",
- le poste part en veille longtemps,
- au reveil l'utilisateur est encore authentifie,
- mais les agents affiches sur la carte ont disparu de l'UI,
- un refresh navigateur recharge correctement les elements depuis le backend.

Lecture technique du symptome:

- les donnees ne sont pas perdues en base puisque `F5` restaure les agents,
- le probleme est donc un probleme de rehydratation front ou de divergence d'etat React/Zustand apres restauration de session,
- la disparition est transitoire cote UI, pas une suppression definitive cote persistance.

Cause racine la plus probable dans [App.tsx](App.tsx):

1. [utils/apiClient.ts](utils/apiClient.ts) declenche un refresh de token automatique apres `401`.
2. [contexts/AuthContext.tsx](contexts/AuthContext.tsx) recoit `auth:session-refreshed` et met a jour `accessToken` sans deconnexion utilisateur.
3. [App.tsx](App.tsx) contient un effet `useEffect(..., [isAuthenticated, accessToken])` qui fait immediatement:
  - `setWorkflowNodes([])`
  - `setAgents([])`
4. Cet effet vide donc la representation visuelle de la carte lors d'un simple renouvellement de token, meme si l'utilisateur reste connecte et meme si le workflow persiste en base.
5. Le code ne met en place aucun mecanisme explicite de reprise sur:
  - retour de visibilite onglet,
  - `focus`,
  - `pageshow`,
  - retour `online`,
  - resume apres veille.
6. Si la rehydratation immediate ne se rejoue pas proprement apres ce vidage, l'ecran reste vide jusqu'au prochain refresh navigateur manuel.

Faiblesse de conception actuelle:

- duplication de la source de verite entre:
  - etat React local `workflowNodes` / `agents` dans [App.tsx](App.tsx),
  - etats persistants dans `useDesignStore`,
  - hydratation auth/session dans `AuthContext`.
- le nettoyage UI est couple a la rotation du token, alors que la rotation du token n'est pas un changement de session produit.
- la reprise apres veille n'est pas modelisee comme un scenario de cycle de vie a part entiere.

### 9.2 Correction cible SOLID et robuste

Approche recommandee:

- dissocier strictement le nettoyage de session d'un simple refresh de token,
- centraliser la rehydratation du workspace dans un orchestrateur unique et idempotent,
- ajouter une logique de reprise explicite apres veille/retour focus/reseau.

Correction robuste attendue:

1. Modifier [App.tsx](App.tsx) pour que le vidage de `workflowNodes` et `agents` ne se produise plus sur chaque variation de `accessToken`.
2. Limiter ce nettoyage aux seules transitions reelles de session:
  - login,
  - logout,
  - changement d'utilisateur,
  - session degradee imposee.
3. Introduire un `WorkspaceResumeService` ou un hook dedie du type `useWorkspaceResume` qui:
  - ecoute `visibilitychange`, `pageshow`, `focus` et `online`,
  - detecte une session authentifiee revenue a l'etat `ready`,
  - relance une rehydratation gardee et debounced de `/api/user/workspace` si l'UI locale est vide ou suspecte.
4. Reutiliser la logique de snapshot existante au lieu de dupliquer des reconstructions partielles.
5. A moyen terme, supprimer la duplication fragile entre etat React local et store design pour que la carte derive d'une seule source de verite.

Principe SOLID applique:

- Single Responsibility: la reprise apres veille ne doit pas etre cachee dans un effet generique auth.
- Open/Closed: de nouveaux signaux de reprise (resume OS, reconnect WebSocket, changement d'onglet) doivent pouvoir reutiliser le meme orchestrateur.
- Dependency Inversion: l'UI doit dependre d'un service de rehydratation de workspace, pas directement de mutations ad hoc liees au token.

### 9.3 Risques de regression

- conserver des donnees visuellement stalees lors d'un vrai changement d'utilisateur si le nettoyage devient trop conservateur,
- declencher trop de refetchs sur focus/reseau si la reprise n'est pas debounced,
- reintroduire des courses entre hydratation initiale, switch de workflow et reprise apres veille.

### 9.4 Tests et jalons

Jalon A6.1 - Stopper le wipe visuel sur refresh token

Tests:

- ajouter un test front autour de [App.tsx](App.tsx) ou d'un hook extrait pour verifier qu'un `auth:session-refreshed` ne vide pas la carte si la session reste valide,
- ajouter un test qui simule `accessToken` mis a jour avec utilisateur identique et verifie que les noeuds affiches restent presents.

Jalon A6.2 - Reprise explicite apres veille / retour focus

Tests:

- test de hook pour `visibilitychange` -> `visible`,
- test de hook pour `window.focus`,
- test de hook pour `online`,
- verification qu'un seul refetch garde de `/api/user/workspace` est lance.

Jalon A6.3 - TNR parcours utilisateur

Tests:

- scenario semi-integration: utilisateur authentifie avec 2 agents sur la carte, token expire, refresh token reussi, carte toujours visible,
- scenario semi-integration: onglet suspendu puis repris, workspace rehydrate sans refresh manuel,
- verification qu'un vrai logout continue de nettoyer integralement les etats.

Critere de sortie:

- aucun agent deja persiste ne disparait visuellement apres une longue veille tant que la session peut etre restauree,
- la carte se reconcilie automatiquement sans `F5`,
- le logout continue de purger correctement les etats.

## 10. Jalonnement d'execution recommande

### Phase 1 - Socle runtime

- Axe 1 complet.
- Sortie obligatoire: Docker et runtime health stables.

### Phase 2 - Session applicative

- Axe 2 complet.
- Sortie obligatoire: demarrage sans cascade `401`.

### Phase 3 - TNR de socle

- Axe 3 partiel: rejouer `hello_test` et parcours auth/workspace.

### Phase 4 - Tool calling local critique

- Axe 4 complet.
- Sortie obligatoire: `web_search_py` observable ou erreur classee proprement et actionnable.

### Phase 5 - Fidelite de trace

- Axe 5 complet.
- Sortie obligatoire: `Input` fiable en live et en persistance.

### Phase 6 - Reprise apres veille

- Axe 6 complet.
- Sortie obligatoire: aucune disparition transitoire de la carte apres veille ou refresh token.

## 11. Matrice de validation minimale

### Avant Phase 1

- Rapport de problemes consolide disponible.
- Dockerfiles identifies.

### Fin Phase 1

- images rebuildables,
- diagnostics Docker ameliores,
- runtime health au vert.

### Fin Phase 2

- login stable,
- refresh stable,
- profils LLM et workspace charges sans cascade `401`.

### Fin Phase 3

- `hello_test` rejoue avec succes.

### Fin Phase 4

- `web_search_py` rejoue avec comportement trace et comprehensible.

### Fin Phase 5

- trace `Input` fidele et stable.

### Fin Phase 6

- reprise apres veille stable,
- carte du workflow automatiquement rehydratee,
- aucun `F5` requis pour retrouver les agents persistes.

## 12. Recommandation de demarrage

Le prochain chantier concret doit commencer par l'Axe 1 avec un lot strictement borne:

1. mise a jour des digests,
2. rebuild des images,
3. rerun des tests runtime health,
4. verification des imports critiques Python.

Ce n'est qu'apres validation de ce socle qu'il devient pertinent de corriger le bootstrap auth puis `web_search_py`.