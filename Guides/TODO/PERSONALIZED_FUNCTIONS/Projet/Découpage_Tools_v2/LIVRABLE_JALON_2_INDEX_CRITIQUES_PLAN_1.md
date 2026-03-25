# LIVRABLE JALON 2 - INDEX CRITIQUES DU PLAN 1 TOOLS

> Date: 17 mars 2026
> Auteur logique: `mongo-persistance`
> Source directrice unique: `PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`

---

## 1. Objet du livrable

Ce document fige les **index critiques minimaux** pour les 4 collections cibles du Plan 1:

1. `workspaces`
2. `user_tools`
3. `user_tool_runs`
4. `secrets_metadata`

Ces index sont retenus a partir de deux sources uniquement:

1. les schemas cibles du livrable precedent
2. les patterns d'acces deja visibles dans le legacy, en particulier autour de `userId`, `workflowId`, `status`, `isEnabled`, `executionId` et des tris temporels

Ce document ne cherche pas a maximiser le nombre d'index. Il cherche a minimiser le risque de regression et le cout d'ecriture tout en couvrant les acces structurants du Plan 1.

---

## 2. Principes de selection retenus

1. un index n'est retenu que s'il couvre une requete reelle, imminente ou structurante du Plan 1
2. l'isolation par utilisateur est prioritaire sur les optimisations secondaires
3. les tris par date doivent etre supportes seulement la ou l'historique et la rehydratation l'exigent reellement
4. les contraintes d'unicite doivent empecher les collisions metier, pas simplement dupliquer des contraintes applicatives faibles
5. les index partiels sont preferes quand ils evitent de penaliser la totalite de la collection pour un sous-ensemble de documents

---

## 3. Patterns d'acces constates a couvrir

## 3.1 Legacy `UserFunction`

Les acces legacy deja visibles sont principalement:

1. listing par `userId` avec variantes `workflowId`, `isEnabled` et tri par nom
2. lecture par `_id` avec controle de visibilite natif ou utilisateur
3. mutation par `_id + userId + isReadonly`
4. resolution des tools d'un agent via references de prototypes

Le Plan 1 n'a pas vocation a recopier ces index a l'identique, mais il doit conserver les performances sur:

1. le listing Phil d'un registry visible pour un utilisateur
2. la resolution des tools par workflow ou workspace
3. la gestion des tools natifs sans collision de nom

## 3.2 Legacy hydratation workspace

Les acces deja visibles autour du workspace et du workflow sont principalement:

1. recherche du workspace ou workflow par utilisateur et scope metier
2. recherche du workflow par defaut ou actif
3. fallback par tri sur `updatedAt`

Le Plan 1 doit donc garantir des recherches rapides par proprietaire, scope et recence.

## 3.3 Future runs persistants

Les acces inevitables du Plan 1 sur les runs sont:

1. reprise ou suivi d'un run par `executionId`
2. listing des runs d'un utilisateur par recence
3. listing des runs d'un workflow par recence
4. historique des runs d'un tool
5. surveillance des runs encore actifs pour watchdog, reprise ou clean-up

---

## 4. Index critiques retenus par collection

## 4.1 `workspaces`

### WKS-01

```ts
{ ownerUserId: 1, scopeType: 1, scopeId: 1 }
```

Options:

```ts
{ unique: true, name: 'uq_workspace_owner_scope' }
```

Raison:

1. garantit qu'un utilisateur ne possede qu'un seul workspace par scope metier
2. supporte la resolution principale `owner + scope`
3. empeche les doublons qui casseraient WorkspaceManager

### WKS-02

```ts
{ ownerUserId: 1, status: 1, updatedAt: -1 }
```

Options:

```ts
{ name: 'idx_workspace_owner_status_updated' }
```

Raison:

1. couvre les listings et diagnostics par utilisateur
2. permet de retrouver rapidement les workspaces actifs ou defectueux les plus recents
3. reste suffisamment general pour hydration, maintenance et health checks

### Index volontairement non retenus a ce stade

1. index sur `logicalRoot` seul: chemin technique, pas cle metier principale
2. index sur `lastScanAt`: utile plus tard pour maintenance de masse, pas critique pour le MVP
3. index sur `lastHealthStatus`: la cardinalite est faible et ne justifie pas encore un index dedie

---

## 4.2 `user_tools`

### UTL-01

```ts
{ scopeType: 1, name: 1 }
```

Options:

```ts
{
  unique: true,
  partialFilterExpression: { scopeType: 'native', ownerUserId: null },
  name: 'uq_user_tools_native_name'
}
```

Raison:

1. garantit qu'un tool natif conserve un nom unique a l'echelle plateforme
2. evite les collisions de nom visibles par tous les utilisateurs
3. protege les futurs mappings prompt builder ou selector qui s'appuient encore fortement sur le nom humain

### UTL-02

```ts
{ ownerUserId: 1, workflowId: 1, name: 1 }
```

Options:

```ts
{
  unique: true,
  partialFilterExpression: { scopeType: 'user' },
  name: 'uq_user_tools_owner_workflow_name'
}
```

Raison:

1. empeche deux tools utilisateurs homonymes dans le meme scope fonctionnel
2. couvre la logique legacy actuelle de scoping utilisateur ou workflow
3. limite le risque d'ambiguite lors de la selection de tool dans Phil ou Archi

### UTL-03

```ts
{ ownerUserId: 1, workflowId: 1, isEnabled: 1, status: 1, name: 1 }
```

Options:

```ts
{ name: 'idx_user_tools_owner_workflow_enabled_status_name' }
```

Raison:

1. couvre le listing principal des tools visibles d'un utilisateur dans un workflow
2. absorbe le pattern legacy `userId + workflowId + isEnabled + sort(name)`
3. reste compatible avec les filtres Phil sur disponibilite et statut metier

### UTL-04

```ts
{ workspaceId: 1, updatedAt: -1 }
```

Options:

```ts
{
  partialFilterExpression: { workspaceId: { $type: 'objectId' } },
  name: 'idx_user_tools_workspace_updated'
}
```

Raison:

1. couvre les recuperations de tools rattaches a un workspace persistant
2. prepare BuildService et WorkspaceManager a lister les definitions liees a un workspace
3. limite le scan complet si un workspace porte plusieurs tools versionnes

### Index volontairement non retenus a ce stade

1. index sur `runtime` seul: cardinalite faible, peu selectif
2. index sur `tags`: pas de recherche avancée prioritaire au Plan 1
3. index sur `versions.versionTag`: tableau interne, utile seulement si le versioning devient une surface de requete autonome
4. index sur `dependencies.*`: aucune requete cible ne filtre la-dessus

---

## 4.3 `user_tool_runs`

### RUN-01

```ts
{ executionId: 1 }
```

Options:

```ts
{ unique: true, name: 'uq_user_tool_runs_execution_id' }
```

Raison:

1. `executionId` est la cle de correlation externe du Plan 1
2. indispensable pour reprise, polling, logs et audit
3. empeche la duplication accidentelle d'un run logique

### RUN-02

```ts
{ ownerUserId: 1, createdAt: -1 }
```

Options:

```ts
{ name: 'idx_user_tool_runs_owner_created' }
```

Raison:

1. couvre l'historique global d'un utilisateur par recence
2. sert Phil, Bos et les ecrans d'audit transverses
3. aligne le tri principal sur l'usage le plus probable de consultation

### RUN-03

```ts
{ ownerUserId: 1, workflowId: 1, createdAt: -1 }
```

Options:

```ts
{
  partialFilterExpression: { workflowId: { $type: 'objectId' } },
  name: 'idx_user_tool_runs_owner_workflow_created'
}
```

Raison:

1. couvre l'historique d'execution rattache a un workflow
2. supporte la rehydratation Bos et les vues de runs d'un workflow
3. preserve l'etancheite utilisateur en tete d'index

### RUN-04

```ts
{ toolId: 1, createdAt: -1 }
```

Options:

```ts
{ name: 'idx_user_tool_runs_tool_created' }
```

Raison:

1. permet l'historique par tool pour edition, QA ou debug
2. facilite l'analyse d'une regression introduite par une version de tool
3. reste suffisamment stable meme si les references agent evoluent ensuite

### RUN-05

```ts
{ ownerUserId: 1, status: 1, updatedAt: -1 }
```

Options:

```ts
{
  partialFilterExpression: {
    status: { $in: ['queued', 'running'] }
  },
  name: 'idx_user_tool_runs_active_watchdog'
}
```

Raison:

1. couvre la surveillance des runs actifs seulement
2. evite de penaliser l'ensemble des runs termines
3. sert le watchdog runtime, les reprises et le clean-up des runs bloques

### Index volontairement non retenus a ce stade

1. TTL sur `user_tool_runs`: contraire au besoin d'audit et de rehydratation
2. index sur `agentPrototypeId` seul: utile plus tard, pas critique avant la stabilisation du mapping du jalon 3
3. index sur `agentInstanceId` seul: meme raison, a reevaluer apres le schema final de rattachement run/agent
4. index sur `runtime` ou `runner` seuls: cardinalite trop faible pour justifier un index critique

---

## 4.4 `secrets_metadata`

### SEC-01

```ts
{ ownerUserId: 1, scopeType: 1, scopeId: 1, alias: 1 }
```

Options:

```ts
{ unique: true, name: 'uq_secrets_metadata_owner_scope_alias' }
```

Raison:

1. empeche deux aliases concurrents dans le meme scope de secret
2. couvre la resolution d'un alias autorise pour un utilisateur et un scope
3. evite des ambiguities lors de l'injection de secrets par policy

### SEC-02

```ts
{ ownerUserId: 1, status: 1, updatedAt: -1 }
```

Options:

```ts
{ name: 'idx_secrets_metadata_owner_status_updated' }
```

Raison:

1. couvre la gestion des secrets actifs, en rotation ou revoques par utilisateur
2. sert les vues de maintenance et de conformite
3. permet de retrouver rapidement les secrets problematiques les plus recents

### Index volontairement non retenus a ce stade

1. index sur `provider` seul: usage probable mais pas critique a l'etape MVP
2. index sur `lastUsedAt`: indicateur de telemetrie, pas cle d'acces principale

---

## 5. Traduction Mongoose cible

Les index ci-dessus se traduisent, a ce stade, par le noyau minimal suivant:

```ts
WorkspaceSchema.index(
  { ownerUserId: 1, scopeType: 1, scopeId: 1 },
  { unique: true, name: 'uq_workspace_owner_scope' }
);

WorkspaceSchema.index(
  { ownerUserId: 1, status: 1, updatedAt: -1 },
  { name: 'idx_workspace_owner_status_updated' }
);

UserToolSchema.index(
  { scopeType: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { scopeType: 'native', ownerUserId: null },
    name: 'uq_user_tools_native_name'
  }
);

UserToolSchema.index(
  { ownerUserId: 1, workflowId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { scopeType: 'user' },
    name: 'uq_user_tools_owner_workflow_name'
  }
);

UserToolSchema.index(
  { ownerUserId: 1, workflowId: 1, isEnabled: 1, status: 1, name: 1 },
  { name: 'idx_user_tools_owner_workflow_enabled_status_name' }
);

UserToolSchema.index(
  { workspaceId: 1, updatedAt: -1 },
  {
    partialFilterExpression: { workspaceId: { $type: 'objectId' } },
    name: 'idx_user_tools_workspace_updated'
  }
);

UserToolRunSchema.index(
  { executionId: 1 },
  { unique: true, name: 'uq_user_tool_runs_execution_id' }
);

UserToolRunSchema.index(
  { ownerUserId: 1, createdAt: -1 },
  { name: 'idx_user_tool_runs_owner_created' }
);

UserToolRunSchema.index(
  { ownerUserId: 1, workflowId: 1, createdAt: -1 },
  {
    partialFilterExpression: { workflowId: { $type: 'objectId' } },
    name: 'idx_user_tool_runs_owner_workflow_created'
  }
);

UserToolRunSchema.index(
  { toolId: 1, createdAt: -1 },
  { name: 'idx_user_tool_runs_tool_created' }
);

UserToolRunSchema.index(
  { ownerUserId: 1, status: 1, updatedAt: -1 },
  {
    partialFilterExpression: { status: { $in: ['queued', 'running'] } },
    name: 'idx_user_tool_runs_active_watchdog'
  }
);

SecretMetadataSchema.index(
  { ownerUserId: 1, scopeType: 1, scopeId: 1, alias: 1 },
  { unique: true, name: 'uq_secrets_metadata_owner_scope_alias' }
);

SecretMetadataSchema.index(
  { ownerUserId: 1, status: 1, updatedAt: -1 },
  { name: 'idx_secrets_metadata_owner_status_updated' }
);
```

---

## 6. Risques et garde-fous anti-regression

1. ne pas sur-indexer `user_tool_runs`, car c'est la collection la plus exposee au volume d'ecriture
2. ne pas dupliquer un index simple deja couvert par un compose commençant par les memes champs
3. verifier avant implementation que les requetes backend utilisent bien l'ordre des predicats coherent avec les composes retenus
4. reevaluer les index sur references agents apres le jalon 3, pas avant

---

## 7. Sortie attendue de l'etape 3

L'etape 3 est consideree validee quand les conditions suivantes sont toutes vraies:

1. chaque collection cible dispose d'un noyau d'index critique explicite
2. chaque index retenu est rattache a une requete ou contrainte metier claire
3. les index non retenus sont explicitement exclus pour eviter la sur-indexation
4. l'implementation Mongoose peut commencer sans ambiguite sur les contraintes d'unicite et les acces principaux