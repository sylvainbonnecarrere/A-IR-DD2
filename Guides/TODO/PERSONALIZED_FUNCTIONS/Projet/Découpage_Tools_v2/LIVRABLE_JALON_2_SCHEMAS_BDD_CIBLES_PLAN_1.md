# LIVRABLE JALON 2 - SCHEMAS BDD CIBLES DU PLAN 1 TOOLS

> Date: 17 mars 2026
> Auteur logique: `mongo-persistance`
> Source directrice unique: `PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`

---

## 1. Objet du livrable

Ce document fige la **definition des schemas BDD cibles** pour le Plan 1 Tools.

Il ne couvre pas encore:

1. le detail final des index
2. la strategie de migration executable
3. l'implementation Mongoose

Il fixe en revanche:

1. les collections minimales
2. leur responsabilite dominante
3. leurs champs obligatoires
4. leurs relations
5. les choix de modelisation exclus

---

## 2. Principes de modelisation retenus

1. une collection ne doit pas melanger definition, execution et metadata runtime sans raison forte
2. `user_functions` devient une source legacy a migrer, pas la base du nouveau design
3. les definitions de tools restent dans le **design domain**
4. les runs restent dans le **runtime domain**
5. les references agent, prototype et workflow pointent vers des identites stables de tools
6. les secrets ne sont jamais stockes dans le code d'un tool
7. les chemins filesystem reels ne sont pas dupliques sans abstraction metier claire

---

## 3. Collections minimales retenues

Les collections minimales du Plan 1 sont:

1. `workspaces`
2. `user_tools`
3. `user_tool_runs`
4. `secrets_metadata`

---

## 4. Schema cible `workspaces`

## 4.1 Responsabilite

Representer l'espace de travail persistant associe a un utilisateur et a un scope metier `project` ou `workflow`.

## 4.2 Champs obligatoires

```ts
interface WorkspaceDocument {
  _id: ObjectId;
  ownerUserId: ObjectId;
  scopeType: 'project' | 'workflow';
  scopeId: ObjectId;
  logicalRoot: string;
  runtimeRoots: {
    sourceRoot: string;
    manifestsRoot: string;
    buildRoot: string;
    outputRoot: string;
  };
  manifests: {
    packageJson?: boolean;
    packageLockJson?: boolean;
    requirementsTxt?: boolean;
    pyprojectToml?: boolean;
  };
  status: 'active' | 'missing' | 'corrupted' | 'archived';
  quotas?: {
    maxBytes?: number;
    maxFiles?: number;
  };
  lastScanAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

## 4.3 Champs optionnels utiles

1. `snapshotVersion?: number`
2. `notes?: string[]`
3. `lastHealthStatus?: 'healthy' | 'warning' | 'error'`

## 4.4 Relations

1. un workspace appartient a un seul utilisateur
2. un workspace pointe vers un seul scope metier a la fois
3. un workspace peut etre reference par plusieurs `user_tools`

## 4.5 Choix exclus

1. ne pas stocker les secrets dans `workspaces`
2. ne pas faire du workspace une preuve d'executabilite runtime
3. ne pas fusionner workspace et build artifact dans le meme document

---

## 5. Schema cible `user_tools`

## 5.1 Responsabilite

Representer la definition metier d'un tool utilisateur ou natif dans le design domain, avec son versioning et sa metadata de policy minimale.

## 5.2 Champs obligatoires

```ts
interface UserToolDocument {
  _id: ObjectId;
  ownerUserId: ObjectId | null;
  workspaceId: ObjectId | null;
  scopeType: 'native' | 'user';
  workflowId?: ObjectId | null;
  name: string;
  displayName?: string;
  description: string;
  runtime: 'typescript' | 'python';
  status: 'draft' | 'ready' | 'disabled' | 'deprecated';
  trustLevel: 'internal' | 'user_private' | 'unverified';
  currentVersion: {
    versionTag: string;
    contentHash: string;
    sourceMode: 'inline' | 'path';
    sourcePath?: string | null;
    sourceInline?: string | null;
    entrypoint?: string | null;
  };
  versions: Array<{
    versionTag: string;
    contentHash: string;
    sourceMode: 'inline' | 'path';
    sourcePath?: string | null;
    sourceInline?: string | null;
    entrypoint?: string | null;
    createdAt: Date;
    createdBy?: ObjectId | null;
    buildStatus: 'not_built' | 'building' | 'built' | 'failed';
    validationStatus: 'unknown' | 'valid' | 'invalid';
  }>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  tags: string[];
  dependencies: {
    npm: string[];
    python: string[];
  };
  policy: {
    networkMode: 'none' | 'restricted';
    writablePaths?: string[];
    secretAliases?: string[];
    timeoutSeconds?: number;
    maxMemoryMb?: number;
  };
  isReadonly: boolean;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

## 5.3 Choix structurants

1. `ownerUserId = null` autorise les tools natifs
2. `workspaceId = null` autorise les tools natifs ou systeme
3. `currentVersion` permet un acces simple sans requete supplementaire
4. `versions[]` suffit pour le Plan 1 et evite d'ouvrir une collection `tool_versions` a ce stade

## 5.4 Relations

1. un tool peut etre rattache a zero ou un workspace
2. un prototype ou une instance d'agent reference un `user_tools._id`
3. un run reference le tool et une version logique de ce tool

## 5.5 Choix exclus

1. ne pas creer des documents separes `ToolDefinition` et `ToolVersion` pour le Plan 1 si le projet n'en a pas encore besoin technique immediat
2. ne pas stocker les secrets resolves dans le tool
3. ne pas confondre `status=ready` avec un run reussi

---

## 6. Schema cible `user_tool_runs`

## 6.1 Responsabilite

Representer chaque execution outillee comme unite de persistence runtime, d'audit et de rehydratation.

## 6.2 Champs obligatoires

```ts
interface UserToolRunDocument {
  _id: ObjectId;
  executionId: string;
  ownerUserId: ObjectId;
  toolId: ObjectId;
  toolVersionTag: string;
  toolContentHash: string;
  workflowId?: ObjectId | null;
  agentPrototypeId?: ObjectId | null;
  agentInstanceId?: ObjectId | null;
  launchContext: 'editor_test' | 'workflow_run' | 'system_validation';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out';
  runtime: 'typescript' | 'python';
  runner: 'docker_rootless' | 'firecracker';
  inputs: Record<string, unknown>;
  outputs?: {
    result?: unknown;
    stdout?: string;
    stderr?: string;
    artifacts?: Array<{
      path: string;
      kind: 'file' | 'json' | 'log';
    }>;
  } | null;
  policySnapshot: {
    networkMode: 'none' | 'restricted';
    timeoutSeconds?: number;
    maxMemoryMb?: number;
    secretAliases?: string[];
  };
  timing: {
    queuedAt?: Date | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    durationMs?: number | null;
  };
  resourceUsage?: {
    peakMemoryMb?: number | null;
    cpuMs?: number | null;
  };
  error?: {
    code?: string;
    message: string;
    retryable?: boolean;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}
```

## 6.3 Choix structurants

1. `executionId` est la cle de correlation externe
2. `toolVersionTag` et `toolContentHash` sont denormalises pour auditabilite
3. `launchContext` distingue Phil, workflow et validation technique
4. `policySnapshot` evite qu'un changement ulterieur de policy rende un run historiquement opaque

## 6.4 Choix exclus

1. ne pas reposer sur `AgentInstance.content` comme source finale des runs outilles
2. ne pas stocker un statut ouvert ou flou hors machine d'etat bornee
3. ne pas utiliser un cache frontend comme historique principal

---

## 7. Schema cible `secrets_metadata`

## 7.1 Responsabilite

Tracer la metadata des secrets autorisables sans stocker leur valeur claire dans cette collection.

## 7.2 Champs obligatoires

```ts
interface SecretMetadataDocument {
  _id: ObjectId;
  ownerUserId: ObjectId;
  alias: string;
  scopeType: 'user' | 'workspace' | 'platform';
  scopeId?: ObjectId | null;
  provider?: string | null;
  status: 'active' | 'rotating' | 'revoked';
  lastRotatedAt?: Date | null;
  lastUsedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

## 7.3 Choix exclus

1. ne pas stocker la valeur du secret en clair
2. ne pas stocker les secrets dans `user_tools`
3. ne pas coupler la rotation des secrets au cycle de vie d'un run

---

## 8. References metier cibles

## 8.1 AgentPrototype

Pour le Plan 1, `AgentPrototype.tools` doit converger vers:

```ts
tools?: ObjectId[]; // refs user_tools
legacyTools?: unknown[]; // migration transitoire uniquement
```

Si une version specifique doit etre epinglee plus tard, la reference pourra evoluer vers une structure explicite. Pour le Plan 1, l'objectif minimal est de sortir de `UserFunction` comme verite metier finale.

## 8.2 AgentInstance

Pour le Plan 1, `functionInheritance.overrideFunctionIds` doit converger vers des ids de `user_tools` et non plus des ids de `user_functions`.

## 8.3 UserSettings

`functionPaths[]` doit etre traite comme legacy de transition vers `workspaces`, pas comme modele futur.

---

## 9. Choix de modelisation explicitement rejetes

1. repliquer `UserFunction` avec un autre nom sans separer design domain et runtime domain
2. stocker chaque version dans une collection separee tant qu'aucune contrainte technique ne l'impose au Plan 1
3. modeliser les runs comme simple sous-produit de `agent_instances`
4. faire du workspace un document fourre-tout contenant aussi les runs et les definitions de tools
5. stocker les secrets techniques dans la collection des tools

---

## 10. Sortie attendue de l'etape 2

L'etape 2 sera consideree validee quand les conditions suivantes sont toutes vraies:

1. les 4 collections minimales sont definies
2. leurs responsabilites ne se chevauchent pas de facon toxique
3. la relation entre tools, workspaces, runs et references agents est explicite
4. les choix exclus sont documentes
5. la definition des index peut commencer sans ambiguite de schema
