# Plan CI/CD GitHub pour A-IR-DD2

## 1. Objectif du document

Ce document definit le plan d'implementation CI/CD de reference pour A-IR-DD2.
Il est ecrit pour un agent codeur operant dans VS Code avec acces au depot, aux workflows GitHub Actions et aux scripts Node existants.

Le plan suit trois principes issus des bonnes pratiques CI/CD modernes:

- une pipeline n'est pas un simple script, mais un systeme gouverne, observable et reproductible ;
- les jobs sont atomiques, isoles et ordonnes par dependances explicites ;
- les artefacts, les secrets, les environnements et les approbations doivent etre modeles comme des objets de pipeline, pas comme des conventions implicites.

## 2. Contexte du projet

### 2.1 Nature du produit

A-IR-DD2 est un orchestrateur de workflows agentiques ambitieux, avec:

- un frontend React + TypeScript + Vite ;
- un backend Node.js + Express + TypeScript ;
- une persistance MongoDB ;
- des runtimes Docker dedies pour l'execution outillee Node/Python ;
- des tests Jest frontend et backend ;
- des validations runtime lourdes distinctes des tests applicatifs classiques.

### 2.2 Constat de l'existant

 Le depot possede deja des briques utiles:

- un workflow GitHub Actions monorepo dans `.github/workflows/ci.yml` ;
- des scripts `npm` cibles pour le frontend ;
- des scripts `npm` cibles pour le backend ;
- des scripts runtime backend plus couteux (`runtime:ci`, `runtime:scan`, `runtime:maintain`) ;
- des lockfiles root et backend, favorables a la reproductibilite.

### 2.3 Contraintes factuelles a respecter

- La version Node de reference applicative est `25.9.0`.
- Le frontend build avec `npm run build`.
- Le backend build avec `npm --prefix backend run build`.
- Le frontend a deja des slices de test exploitables en CI.
- Le backend n'est pas totalement autonome sans MongoDB disponible.
- Les validations runtime Docker ne doivent pas alourdir toutes les pull requests.

## 3. Invariants d'architecture pipeline

Ces invariants sont non negociables. Toute implementation qui les viole doit etre corrigee avant merge.

### 3.1 Reproductibilite

Le meme commit doit produire le meme resultat pipeline.

Regles:

- utiliser `npm ci`, jamais `npm install` en CI ;
- epingler les versions Node avec `actions/setup-node` ;
- s'appuyer sur `package-lock.json` root et backend ;
- eviter les dependances implicites a l'environnement local du runner ;
- injecter explicitement les variables d'environnement requises ;
- isoler les tests backend qui necessitent MongoDB via un service CI dedie.

### 3.2 Tracabilite

Chaque artefact et chaque execution doivent remonter au commit source.

Regles:

- nommer les artefacts avec le SHA court ou complet ;
- uploader les livrables et rapports utiles ;
- conserver les logs complets des jobs ;
- utiliser les metadata GitHub Actions standard (run id, run number, sha, ref) dans les noms et annotations.

### 3.3 Observabilite

Une pipeline utile doit permettre de comprendre un echec sans relancer aveuglement.

Regles:

- decouper les jobs par responsabilite ;
- journaliser clairement les versions, cibles et commandes ;
- uploader les rapports exploitables ;
- faire echouer le job sur le premier signal invalide, sans masquer la cause ;
- distinguer les jobs rapides, les jobs d'integration et les jobs runtime lourds.

### 3.4 Securite

La pipeline ne doit pas elargir le perimetre de risque du projet.

Regles:

- permissions GitHub minimales par workflow ;
- secrets scopes par environnement ;
- aucun secret echo dans les logs ;
- separation claire entre CI applicative et CD environnemental ;
- scans de dependances et scans runtime planifies.

## 4. Cible CI/CD recommandee

La cible retenue est une architecture GitHub Actions en couches.

### 4.1 Couche CI Pull Request rapide

But: fournir un feedback fiable en quelques minutes sur les changements courants.

Jobs cibles:

- `frontend-build`
- `frontend-component-tests`
- `frontend-hydration-integration`
- `frontend-canvas-non-regression`
- `backend-build`
- `backend-tests-mongo`

Contraintes:

- execution sur `pull_request` et `push` vers branches strategiques ;
- cache npm ;
- MongoDB provisionne explicitement pour le backend ;
- pas de runtime Docker lourd dans cette couche.

### 4.2 Couche CI securite continue

But: detecter rapidement les risques supply chain et les derivees de dependances.

Jobs cibles:

- `dependency-review` sur pull requests ;
- `npm-audit-root` ;
- `npm-audit-backend` ;
- `codeql` planifie ;
- `runtime-image-scan` planifie ou manuel.

### 4.3 Couche runtime technique separee

But: valider les images et le sandbox sans penaliser le cycle normal des PR.

Jobs cibles:

- `runtime-rebuild`
- `runtime-verify-provisioning`
- `runtime-scan`
- `node25-runtime-slice`

Contraintes:

- execution sur `workflow_dispatch`, `schedule` et `push` sur `main` ;
- possibilite de promotion future vers un runner self-hosted si necessaire ;
- logs et artefacts de diagnostic conserves.

### 4.4 Couche continuous delivery d'artefacts

But: produire des livrables de confiance, sans declencher un faux deploiement vers une cible encore non figee.

Livrables cibles:

- build frontend `dist/` ;
- build backend `backend/dist/` ;
- metadata de build ;
- option future de publication vers GitHub Releases ou GHCR.

### 4.5 Couche deployment par environnements

But: activer plus tard un vrai chemin `staging` puis `production` avec protections.

Regles:

- `staging` deployable depuis `main` ou `workflow_dispatch` ;
- `production` protegee par approbation humaine ;
- secrets distincts par environnement ;
- pas de deploiement auto vers prod sans environment protection.

## 5. Strategie de decoupage en workflows

Le depot doit converger vers les workflows suivants.

### 5.1 `ci.yml`

Responsabilite:

- controle principal des PR et pushes applicatifs.

Declencheurs:

- `pull_request`
- `push` sur `main` et `develop`
- `workflow_dispatch`

Contenu:

- build frontend ;
- tests frontend existants ;
- build backend ;
- tests backend avec Mongo.

### 5.2 `security.yml`

Responsabilite:

- hygiene supply chain et analyse de securite continue.

Declencheurs:

- `pull_request`
- `push` sur `main`
- `schedule`
- `workflow_dispatch`

Contenu:

- dependency review ;
- audits npm ;
- CodeQL ;
- scans runtime si cadence nocturne.

### 5.3 `runtime.yml`

Responsabilite:

- validation des images runtime Docker et du slice Node 25 / sandbox.

Declencheurs:

- `workflow_dispatch`
- `schedule`
- `push` sur `main` quand les scripts runtime changent.

Contenu:

- `npm run ci:node25:runtime` ;
- `npm --prefix backend run runtime:ci` ;
- `npm --prefix backend run runtime:scan`.

### 5.4 `release-artifacts.yml`

Responsabilite:

- produire et publier les artefacts de release.

Declencheurs:

- tag semantique ;
- `workflow_dispatch`.

Contenu:

- build frontend ;
- build backend ;
- upload artefacts ;
- publication release eventuelle.

### 5.5 `deploy.yml`

Responsabilite:

- deploiement par environnement, a n'activer qu'apres validation du mode d'hebergement.

Declencheurs:

- `workflow_dispatch`
- eventuellement `workflow_run` sur release validee.

## 6. Cartographie des jobs cibles

### 6.1 Jobs frontend

#### `frontend-build`

Commande:

```bash
npm ci
npm run build
```

But:

- verifier que le frontend est compilable ;
- produire `dist/` pour livraison.

#### `frontend-component-tests`

Commande:

```bash
npm ci
npm run test:components:ci
```

#### `frontend-hydration-integration`

Commande:

```bash
npm ci
npm run test:integration:hydration
```

#### `frontend-canvas-non-regression`

Commande:

```bash
npm ci
npm run test:canvas:non-regression
```

### 6.2 Jobs backend

#### `backend-build`

Commande:

```bash
npm --prefix backend ci
npm --prefix backend run build
```

But:

- garantir la coherence TypeScript backend ;
- preparer un futur artefact `backend/dist`.

#### `backend-tests-mongo`

Commande cible:

```bash
npm --prefix backend ci
npm --prefix backend test -- --runInBand
```

Prerequis:

- service MongoDB GitHub Actions ;
- variable `MONGODB_URI` explicite.

Hypothese de fonctionnement:

- le backend test setup se connecte a une vraie base Mongo ;
- sans Mongo provisionne, ce job donnera des faux echecs.

### 6.3 Jobs runtime

#### `node25-runtime-slice`

Commande:

```bash
npm ci
npm run ci:node25:runtime
```

But:

- verifier la ligne Node 25 et le slice de validation cible.

#### `runtime-ci`

Commande:

```bash
npm --prefix backend ci
npm --prefix backend run runtime:ci
```

#### `runtime-scan`

Commande:

```bash
npm --prefix backend ci
npm --prefix backend run runtime:scan
```

## 7. Ordonnancement logique en DAG

Le DAG cible est le suivant:

### Stage `validate`

Jobs paralleles:

- `frontend-component-tests`
- `frontend-hydration-integration`
- `frontend-canvas-non-regression`
- `backend-tests-mongo`
- `npm-audit-root`
- `npm-audit-backend`

### Stage `build`

Depend de `validate`:

- `frontend-build`
- `backend-build`

### Stage `package`

Depend de `build`:

- `upload-frontend-artifact`
- `upload-backend-artifact`

### Stage `runtime`

Depend selon workflow dedie:

- `node25-runtime-slice`
- `runtime-ci`
- `runtime-scan`

### Stage `release`

Depend de `package`:

- `release-artifacts`

### Stage `deploy`

Depend de `release` et d'une approbation environnementale:

- `deploy-staging`
- `deploy-production`

## 8. Implementation ultra detaillee pour un agent codeur VS Code

Cette section est la feuille de route d'execution.

## Jalon 0. Preparation et garde-fous

### Objectif

Verifier l'etat initial avant toute modification GitHub Actions.

### Taches

1. Lire les fichiers suivants:
	- `.github/workflows/ci.yml`
	- `package.json`
	- `backend/package.json`
	- `backend/src/__tests__/setup.ts`
	- `backend/docker/docker-compose.yml`
2. Confirmer les scripts npm effectivement disponibles.
3. Confirmer que Node 25.9.0 est la ligne officielle.
4. Confirmer que les tests backend necessitent MongoDB.
5. Verifier que `ci.yml` reste la source de verite pour les slices frontend et backend.

### Critere d'acceptation

- l'agent peut decrire precisement quels jobs sont deja couverts et lesquels manquent.

## Jalon 1. Unifier la CI applicative

### Objectif

Maintenir la CI monorepo coherent frontend + backend comme source de verite.

### Taches

1. Creer `.github/workflows/ci.yml`.
2. Definir `name`, `on`, `concurrency` et `permissions` minimales.
3. Ajouter un job `frontend-build`.
4. Maintenir dans `ci.yml` les trois jobs frontend existants.
5. Ajouter un job `backend-build`.
6. Ajouter un job `backend-tests-mongo` avec service MongoDB.
7. Utiliser `actions/setup-node@v5` avec `node-version: 25.9.0`.
8. Utiliser le cache npm de `setup-node`.
9. Utiliser `npm ci` root et `npm --prefix backend ci` selon les jobs.
10. Configurer `MONGODB_URI` explicitement dans le job backend tests.
11. Uploader les rapports utiles si le projet en produit deja ; sinon rester minimal.

### Details d'implementation recommandes

- `runs-on: ubuntu-latest`
- `timeout-minutes` par job pour eviter les jobs pendants
- `concurrency.group: ci-${{ github.workflow }}-${{ github.ref }}`
- `concurrency.cancel-in-progress: true`
- `permissions.contents: read`

### Critere d'acceptation

- le workflow `ci.yml` execute frontend + backend sans dependance implicite au poste local.

## Jalon 2. Rationaliser la source de verite CI

### Objectif

Eviter les doublons et clarifier la source de verite autour des workflows actuellement versionnes.

### Taches

1. Verifier que `ci.yml` couvre strictement les slices frontend et backend attendues.
2. Supprimer toute reference documentaire ou agentique a `frontend-tests.yml`.
3. Eviter deux workflows qui lancent les memes tests sur les memes evenements.

### Critere d'acceptation

- aucune duplication significative de charge sur les PR.

## Jalon 3. Ajouter la securite supply chain

### Objectif

Rendre visibles les regressions de dependances et les risques de publication.

### Taches

1. Creer `.github/workflows/security.yml`.
2. Ajouter `dependency-review-action` sur pull request.
3. Ajouter `npm run audit:root`.
4. Ajouter `npm run audit:backend` ou `npm --prefix backend run audit:deps` selon la convention retenue.
5. Ajouter un job `codeql` si le depot le permet.
6. Planifier au moins un `schedule` hebdomadaire.
7. Definir des permissions specifiques et minimales.

### Critere d'acceptation

- toute PR expose un signal minimal sur le risque dependances.

## Jalon 4. Isoler la validation runtime lourde

### Objectif

Conserver la qualite des runtimes Docker sans ralentir toutes les PR.

### Taches

1. Creer `.github/workflows/runtime.yml`.
2. Configurer `workflow_dispatch`.
3. Configurer `schedule` nocturne ou quotidienne.
4. Ajouter un job `node25-runtime-slice`.
5. Ajouter un job `runtime-ci`.
6. Ajouter un job `runtime-scan`.
7. Si necessaire, executer ces jobs seulement sur `main` et quand les chemins runtime sont touches.

### Remarques

- ce workflow peut necessiter Docker disponible sur le runner ;
- si le temps d'execution devient trop eleve, envisager plus tard un runner dedie.

### Critere d'acceptation

- le runtime est valide regulierement sans bloquer inutilement le flux PR ordinaire.

## Jalon 5. Mettre en place la delivery d'artefacts

### Objectif

Passer d'une simple validation a une livraison de build tracable.

### Taches

1. Creer `.github/workflows/release-artifacts.yml`.
2. Declencher sur tag semantique et `workflow_dispatch`.
3. Generer `dist/` frontend.
4. Generer `backend/dist/`.
5. Uploader ces repertoires comme artefacts nommes avec SHA ou tag.
6. Ajouter un petit fichier metadata de build si utile.
7. Garder la retention configurable.

### Critere d'acceptation

- un humain peut telecharger les livrables d'un commit ou d'un tag sans reconstruire localement.

## Jalon 6. Ajouter la gouvernance GitHub

### Objectif

Completer la pipeline par les controles de repository indispensables.

### Taches

1. Creer `.github/dependabot.yml`.
2. Ajouter les ecosytemes npm root et backend.
3. Definir une frequence raisonnable, par exemple hebdomadaire.
4. Creer `.github/CODEOWNERS`.
5. Declarer au minimum un owner pour workflows et backend.
6. Configurer dans GitHub, hors code:
	- branch protection sur `main` ;
	- review obligatoire ;
	- status checks obligatoires ;
	- blocage des merges si CI rouge.

### Critere d'acceptation

- la gouvernance GitHub empeche les merges qui contournent les checks voulus.

## Jalon 7. Preparer le deploiement futur sans le simuler

### Objectif

Installer les briques CD sans declarer un deploiement fictif.

### Taches

1. Definir les environnements GitHub `staging` et `production`.
2. Parametrer les secrets par environnement.
3. Ajouter des reviewers obligatoires pour `production`.
4. Documenter les prerequis d'un futur `deploy.yml`.
5. Ne pas automatiser un vrai deploy tant que la cible infra n'est pas figee.

### Critere d'acceptation

- la base CD est prete, mais aucun faux chemin de prod n'est merge.

## 9. Decisions techniques explicites a respecter

### 9.1 Sur MongoDB en CI

Decision:

- les tests backend complets tournent avec un service MongoDB GitHub Actions ou equivalent explicite.

Interdit:

- supposer qu'un Mongo local existe sur le runner ;
- laisser les tests backend dependre du poste du developpeur.

### 9.2 Sur les caches

Decision:

- utiliser le cache npm pour accelerer ;
- ne jamais rendre un job dependant du cache pour reussir.

Interdit:

- stocker un livrable dans le cache a la place d'un artefact.

### 9.3 Sur les artefacts

Decision:

- tout livrable transfere entre jobs ou telecharge par un humain est un artefact.

Interdit:

- reconstruire silencieusement un livrable dans un job aval alors qu'un artefact amont devrait etre reutilise.

### 9.4 Sur les secrets

Decision:

- secret scope minimal ;
- aucun affichage direct dans les logs ;
- separation par environnement.

### 9.5 Sur les runners

Decision:

- commencer avec runners GitHub heberges ;
- n'envisager un runner self-hosted que si les jobs runtime, Docker ou reseau l'exigent reellement.

## 10. Definition of Done globale

La mission CI/CD est consideree terminee quand les conditions suivantes sont reunies:

- un workflow principal `ci.yml` couvre frontend et backend ;
- le backend test job provisionne MongoDB explicitement ;
- la securite supply chain est couverte par un workflow dedie ;
- les validations runtime lourdes sont sorties des PR ordinaires ;
- les artefacts de build sont publiables et tracables ;
- Dependabot et CODEOWNERS existent ;
- la gouvernance GitHub requise est documentee ;
- les workflows sont comprehensibles par un developpeur sans connaissance implicite du poste auteur.

## 11. Anti-patterns a eviter

- reutiliser un seul workflow monolithique pour tout faire ;
- lancer les validations runtime Docker sur chaque PR sans filtrage ;
- laisser les tests backend dependre d'un service local non provisionne ;
- utiliser `npm install` au lieu de `npm ci` ;
- dupliquer les memes tests dans plusieurs workflows sur les memes evenements ;
- stocker des artefacts dans le cache ;
- melanger build, release et deploy sans protection d'environnement ;
- masquer un job cassant avec `continue-on-error` sans justification forte.

## 12. Ordre d'execution recommande pour l'agent codeur VS Code

Ordre strict conseille:

1. creer `ci.yml` ;
2. valider localement les commandes frontend et backend deja existantes ;
3. integrer MongoDB au job backend ;
4. verifier qu'aucune duplication frontend inutile ne subsiste ;
5. creer `security.yml` ;
6. creer `runtime.yml` ;
7. creer `release-artifacts.yml` ;
8. creer `dependabot.yml` et `CODEOWNERS` ;
9. documenter la gouvernance restante hors depot.

## 13. Livrables attendus a la fin du chantier

- `.github/workflows/ci.yml`
- `.github/workflows/security.yml`
 `.github/workflows/runtime.yml`
 `.github/workflows/release-artifacts.yml`
 `.github/dependabot.yml`
 `.github/CODEOWNERS`
 verification qu'aucune reference residuelle ne pointe vers `.github/workflows/frontend-tests.yml`
 note de gouvernance GitHub si necessaire

## 14. Resume executif pour l'agent

Construire une vraie pipeline GitHub Actions pour A-IR-DD2 signifie transformer des scripts existants en jobs gouvernes, isoles et observables.
La priorite n'est pas de deployer trop tot, mais d'obtenir une CI fiable, reproductible et compatible avec les contraintes reelles du depot:

- frontend testable rapidement ;
- backend testable avec Mongo provisionne ;
- runtime Docker valide a part ;
- artefacts tracables ;
- securite et gouvernance versionnees.

Si un arbitrage doit etre fait, privilegier toujours:

1. la fiabilite sur la sophistication ;
2. l'explicite sur l'implicite ;
3. les jobs petits et lisibles sur les workflows monolithiques ;
4. la separation CI, security, runtime, release, deploy sur un faux workflow unique.
