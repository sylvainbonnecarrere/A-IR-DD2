# J1 - Contrats metier et securite

## 1. Objet

Cette note fige les decisions structurantes du jalon J1 pour la refonte V1 -> V2.

Le jalon couvre quatre axes :

- centralisation des contrats de domaine pour les executions et la collaboration ;
- verrouillage des frontieres d'acces temps reel et ownership ;
- stabilisation des erreurs metier d'autorisation ;
- durcissement des index MongoDB qui supportent les controles d'ownership.

## 2. Decisions structurantes

### 2.1 Contrats canoniques de domaine

Les contrats J1 sont portes par des modules de domaine independants d'Express, React et Mongoose.

- `backend/src/domain/execution/userToolRun.contract.ts`
  Source de verite des statuts `queued`, `running`, `completed`, `failed`, `stopped`, `timed_out`.
- `backend/src/domain/execution/taskInstance.contract.ts`
  Source de verite des statuts `pending`, `ready`, `running`, `blocked`, `completed`, `failed`, `cancelled`.
- `backend/src/domain/workflow/workspaceCollaboration.contract.ts`
  Contrats Zod pour `workspace:join`, `workspace:leave`, `agent:position:update`, `agent:message:add`, `agent:toggle:minimize` et `user:cursor:update`.

Ces contrats remplissent deux roles :

- eviter la duplication des enums et transitions dans les routes, services et WebSocket ;
- fournir une base stable a J2 pour extraire les use cases applicatifs sans recoder les regles metier.

### 2.2 Frontiere WebSocket

Le WebSocket n'est plus considere comme un canal de confiance implicite.

Decision :

- un socket peut encore se connecter sans JWT pour ne pas casser le mode guest ;
- un socket guest ne peut ni rejoindre un workspace collaboratif ni emettre un evenement metier ;
- un socket authentifie ne peut rejoindre qu'un workflow dont il est proprietaire ;
- tout payload collaboratif est valide avant diffusion ;
- les refus sont journalises sans exposer de secret.

### 2.3 Contrat d'erreur d'ownership

`requireOwnershipAsync` renvoie des codes stables en plus des messages historiques :

- `AUTH_REQUIRED`
- `INVALID_ID_FORMAT`
- `RESOURCE_NOT_FOUND`
- `OWNERSHIP_DENIED`
- `INTERNAL_SERVER_ERROR`

Cela reduit la divergence avec `ownership.middleware.ts` sans casser les assertions existantes basees sur `error`.

## 3. Threat model J1

| Surface | Menace principale | Impact | Contre-mesure J1 |
|---|---|---|---|
| WebSocket collaboration | IDOR par `workspaceId` forge | Lecture et emission dans le workflow d'un autre utilisateur | JWT au handshake, verification ownership avant `workspace:join` |
| Evenements socket | Payload arbitraire ou malforme | Pollution d'etat, erreurs runtime, diffusion de donnees non bornees | Validation Zod avant diffusion |
| Middleware d'ownership | Contrats d'erreur divergents | Clients difficiles a fiabiliser, handling incoherent | Codes stables ajoutes a `requireOwnershipAsync` |
| Runs et executions | Duplication des transitions et etats illegaux | Etats impossibles, reprises ou clotures incoherentes | State machine canonique `userToolRun.contract.ts` |
| Taches metier futures | Specification implicite ou reintroduite localement | Divergence entre workers, routes et UI | State machine canonique `taskInstance.contract.ts` |
| Index MongoDB legacy | Controles d'ownership plus couteux ou absents | Fenetres d'incoherence et degradation de perf sur filtres critiques | Migration idempotente `007_security_ownership_indexes.ts` |

## 4. Matrice de permissions

| Ressource | Invite | Utilisateur proprietaire | Admin |
|---|---|---|---|
| HTTP workflow/read | Refuse si route protegee | Autorise sur ses ressources | Autorise selon middleware existant |
| HTTP workflow/write | Refuse | Autorise sur ses ressources | Autorise selon middleware existant |
| HTTP run/artifact read | Refuse si route protegee | Autorise sur ses ressources | Autorise selon middleware existant |
| Socket connect | Autorise sans priviliege metier | Autorise | Autorise |
| Socket `workspace:join` | Refuse | Autorise uniquement sur workflow possede | Comportement courant aligne sur ownership workflow |
| Socket events intra-workspace | Refuse | Autorise apres join valide | Autorise apres join valide |

## 5. Etats et transitions

### 5.1 WorkflowRun / UserToolRun

| Etat courant | Transitions autorisees |
|---|---|
| `queued` | `running`, `failed`, `stopped`, `timed_out` |
| `running` | `completed`, `failed`, `stopped`, `timed_out` |
| `completed` | aucune |
| `failed` | aucune |
| `stopped` | aucune |
| `timed_out` | aucune |

Invariants :

- un etat terminal est irreversibe ;
- la validation de transition est pure et independante de la persistance ;
- les routes et services doivent consommer ce contrat, pas redefinir les enums localement.

### 5.2 TaskInstance

| Etat courant | Transitions autorisees |
|---|---|
| `pending` | `ready`, `blocked`, `cancelled` |
| `ready` | `running`, `cancelled` |
| `running` | `completed`, `failed`, `blocked`, `cancelled` |
| `blocked` | `ready`, `cancelled` |
| `completed` | aucune |
| `failed` | aucune |
| `cancelled` | aucune |

Invariants :

- `blocked` ne repart pas directement vers `running` ;
- un terminal ne redemarre jamais ;
- la machine est declaree meme si J2 materialisera ensuite le modele et les use cases.

## 6. Strategie de migration MongoDB

Migration livree : `backend/src/migrations/007_security_ownership_indexes.ts`

Indexes assures :

- `workflows`: `uq_workflows_default_per_user`
- `workflow_nodes_v2`: `idx_workflow_nodes_v2_owner_workflow`
- `workflow_edges`: `idx_workflow_edges_owner_workflow_updated`
- `agent_instances`: `idx_agent_instances_owner_workflow_status`

Regles de migration :

- migration `up` uniquement ;
- idempotence obtenue par detection du nom d'index avant creation ;
- aucun rewrite de document ;
- reexecution sure sur base deja partiellement migree.

Commande :

- `cd backend && npm run migrate:security-ownership-indexes`

## 7. Donnees legacy et compatibilite

- `Workflow.nodes` et `Workflow.edges` restent des surfaces de compatibilite et non des contrats canoniques de domaine.
- Le client WebSocket se reconnecte avec le JWT courant lorsqu'un workspace est rejoint apres authentification.
- Les sockets invites peuvent encore exister pour ne pas casser le mode guest, mais ils ne peuvent plus rejoindre ni muter un workspace.
- `requireOwnershipAsync` preserve les messages historiques et ajoute uniquement des codes stables.

## 8. Changements de contrat incompatibles

Deux changements sont incompatibles au sens securite, meme s'ils restent cibles :

- un `workspace:join` sans JWT valide ne donne plus acces a une room collaborative ;
- un `workspace:join` avec JWT valide mais sans ownership sur le workflow est refuse explicitement.

Le contrat HTTP JSON n'a pas change de forme pour les routes workflows existantes, hors ajout du champ `code` sur certaines erreurs d'ownership asynchrones.

## 9. User stories J1 livrees

### US-J1-01 - Contrats canoniques du domaine V2

Critere d'acceptation atteint :

- les statuts d'execution ne sont plus redefinis en dur dans plusieurs couches ;
- les contrats de collaboration temps reel sont valides par Zod ;
- les contrats sont testes unitairement.

### US-J1-02 - State machines de run et de task

Critere d'acceptation atteint :

- transitions valides et invalides formalisees ;
- etats terminaux irreversibles ;
- contrats de transition independants du transport.

### US-J1-03 - Threat model et matrice de permissions

Critere d'acceptation atteint :

- frontiere WebSocket documentee et durcie ;
- regles guest / owner / admin explicitees ;
- migration d'index associee aux controles d'ownership.

### US-J1-04 - Validation, erreurs et traces de securite

Critere d'acceptation atteint :

- payloads socket invalides refuses ;
- refus d'acces socket journalises ;
- erreurs d'ownership asynchrones stabilisees par code.

## 10. Tests J1

Tests unitaire et non-regression ajoutes ou adaptes :

- `backend/src/__tests__/user-tool-run.contract.test.ts`
- `backend/src/__tests__/task-instance.contract.test.ts`
- `backend/src/__tests__/websocket-auth.test.ts`
- `backend/src/__tests__/security-ownership-indexes.migration.test.ts`
- `backend/src/__tests__/auth-workflows.routes.test.ts`

Risques reportes a J2 :

- extraction complete des use cases domaine depuis les routes ;
- adoption des contrats `TaskInstance` par les services runtime quand ce modele sera materialise ;
- suppression definitive des surfaces V1 de compatibilite.