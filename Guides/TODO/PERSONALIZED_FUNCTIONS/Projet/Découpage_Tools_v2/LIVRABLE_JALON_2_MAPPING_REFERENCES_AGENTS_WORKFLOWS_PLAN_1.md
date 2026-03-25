# LIVRABLE JALON 2 - MAPPING DES REFERENCES AGENTS WORKFLOWS PLAN 1

> Date: 17 mars 2026
> Auteur logique: `mongo-persistance`
> Source directrice unique: `PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`

---

## 1. Objet du livrable

Ce document fige le **mapping cible des references** entre:

1. `workspaces`
2. `user_tools`
3. `user_tool_runs`
4. `agent_prototypes`
5. `agent_instances`
6. `workflows`

Le but n'est pas encore d'implementer la migration complete. Le but est de fixer:

1. quelle collection est proprietaire de quelle relation
2. quelles references doivent converger hors de `user_functions`
3. quels alias de compatibilite doivent etre conserves temporairement pour le frontend et l'hydratation

---

## 2. Constats structurants issus du code actuel

## 2.1 Divergence backend / frontend deja en place

Le code actuel expose deja plusieurs couches de compatibilite:

1. `AgentPrototype.tools` persiste des `ObjectId[]` backend
2. `WorkspaceSnapshot.agentPrototypes[]` expose a la fois `tools` et `functionIds`
3. le frontend travaille surtout avec `Agent.functionIds`
4. `AgentInstance.tools` persiste encore les refs legacy, tandis que le frontend consomme surtout `configuration_json.tools` et `functionInheritance.overrideFunctionIds`

Conclusion:

1. il existe deja un **double contrat de fait**
2. le Plan 1 doit le discipliner, pas le casser brutalement

## 2.2 References actuellement critiques

Les references qui ne peuvent pas etre ambiguës sont:

1. un prototype appartient a un `userId` et optionnellement a un `workflowId`
2. une instance appartient a un `workflowId` et a un `userId`
3. un run doit appartenir a un `ownerUserId` et pointer vers un `toolId`
4. un workspace appartient a un `ownerUserId` et a un scope unique `project` ou `workflow`

---

## 3. Proprietaires des relations cibles

## 3.1 Workspace

Le document `workspaces` est le **proprietaire de la relation vers le scope metier**:

```ts
WorkspaceDocument {
  ownerUserId: ObjectId;
  scopeType: 'project' | 'workflow';
  scopeId: ObjectId;
}
```

Regles:

1. le workspace ne reference pas les agents ni les runs en tableau embarque
2. les autres documents se rattachent indirectement au workspace par `workflowId` ou par `workspaceId` selon leur nature
3. le workspace reste un support filesystem et de gouvernance, pas un agregat de runtime

## 3.2 Tool definition

Le document `user_tools` est le **proprietaire de la relation vers le workspace**:

```ts
UserToolDocument {
  _id: ObjectId;
  ownerUserId: ObjectId | null;
  workspaceId: ObjectId | null;
  workflowId?: ObjectId | null;
}
```

Regles:

1. `workspaceId` est la reference technique principale vers l'espace persistant du tool
2. `workflowId` est la reference de scope fonctionnel quand le tool est limite a un workflow
3. `ownerUserId = null` et `workspaceId = null` restent reserves aux tools natifs ou systeme

## 3.3 Run

Le document `user_tool_runs` est le **proprietaire de la relation runtime vers tool, workflow et agents**:

```ts
UserToolRunDocument {
  executionId: string;
  ownerUserId: ObjectId;
  toolId: ObjectId;
  workflowId?: ObjectId | null;
  agentPrototypeId?: ObjectId | null;
  agentInstanceId?: ObjectId | null;
}
```

Regles:

1. un run reference toujours un `toolId`
2. un run reference optionnellement un `workflowId`
3. un run reference optionnellement un `agentPrototypeId` et ou un `agentInstanceId`
4. le run n'est jamais seulement reconstruit depuis `AgentInstance.content`

---

## 4. Mapping cible par entite agent

## 4.1 AgentPrototype

### Etat actuel

Backend:

```ts
tools?: ObjectId[]; // refs UserFunction
legacyTools?: object[];
workflowId?: ObjectId;
userId: ObjectId;
```

Frontend hydrate:

```ts
tools: string[];
functionIds: string[];
```

### Cible Plan 1

Le prototype doit converger vers:

```ts
tools?: ObjectId[];      // refs user_tools._id
legacyTools?: unknown[]; // migration transitoire uniquement
workflowId?: ObjectId;
userId: ObjectId;
```

### Convention frontend imposee pendant migration

Le backend doit continuer a exposer:

```ts
{
  tools: string[];       // alias de compatibilite
  functionIds: string[]; // alias frontend canonique actuel
}
```

Regles:

1. `tools[]` et `functionIds[]` representent temporairement la **meme identite**: `user_tools._id`
2. aucune nouvelle semantique ne doit differencier `tools` de `functionIds`
3. `legacyTools` reste lecture seule de transition et ne doit plus etre la source d'autorite

## 4.2 AgentInstance

### Etat actuel

Backend:

```ts
workflowId: ObjectId;
userId: ObjectId;
prototypeId?: ObjectId;
executionId: string;
tools?: ObjectId[]; // refs UserFunction
legacyTools?: object[];
functionInheritance?: {
  inheritFromPrototype: boolean;
  overrideFunctionIds?: string[];
};
```

Frontend consomme surtout:

```ts
configuration_json: {
  tools: Tool[];
  functionInheritance?: {
    inheritFromPrototype: boolean;
    overrideFunctionIds?: string[];
  };
}
```

### Cible Plan 1

L'instance doit converger vers la separation suivante:

```ts
AgentInstance {
  workflowId: ObjectId;
  userId: ObjectId;
  prototypeId?: ObjectId;
  executionId: string;
  tools?: ObjectId[]; // refs user_tools._id, snapshot de compatibilite
  functionInheritance?: {
    inheritFromPrototype: boolean;
    overrideFunctionIds?: string[]; // ids user_tools
  };
}
```

Regles:

1. `tools[]` sur l'instance ne doit plus pointer vers `user_functions`
2. `overrideFunctionIds[]` doit converger vers des ids de `user_tools`
3. si `inheritFromPrototype = true`, l'instance n'est pas proprietaire de la selection de tools
4. si `inheritFromPrototype = false`, `overrideFunctionIds[]` devient la source metier de selection des tools pour l'instance

### Contrat frontend de transition

Pendant le Plan 1:

1. `configuration_json.functionInheritance.overrideFunctionIds[]` reste le champ frontend de lecture et d'edition
2. la transformation backend peut continuer a remplir `configuration_json.tools`, mais ce champ ne doit pas redevenir la source canonique de reference d'identite
3. l'identite de tool doit vivre dans les ids, pas dans des objets inline

---

## 5. Mapping workflow -> workspace -> tools

## 5.1 Relation de scope

Le workflow reste le scope fonctionnel principal des instances et de la plupart des tools utilisateur.

Mapping cible:

```ts
Workflow._id ----< AgentInstance.workflowId
Workflow._id ----< AgentPrototype.workflowId?
Workflow._id ----1 Workspace.scopeId (si scopeType = 'workflow')
Workflow._id ----< UserTool.workflowId?
Workflow._id ----< UserToolRun.workflowId?
```

Regles:

1. `workflowId` reste la cle de rattachement fonctionnelle pour hydratation et isolation utilisateur
2. le workspace n'est pas substitut a `workflowId`; il en est le support persistant si le scope choisi est le workflow
3. un tool peut avoir `workflowId` nul et `workspaceId` nul s'il est natif

## 5.2 Relation workspace

Mapping cible:

```ts
Workspace._id ----< UserTool.workspaceId
Workspace.scopeId -> Workflow._id | Project._id
```

Regles:

1. les agents ne referencent pas directement `workspaceId` au Plan 1
2. la relation agent -> workspace se deduit via le tool selectionne, ou via le workflow de l'instance et son workspace associe
3. cela evite de dupliquer une reference `workspaceId` sur toutes les entites agent sans besoin immediat

---

## 6. Mapping runtime des runs

## 6.1 Source d'autorite

Le run outille ne doit pas etre attache a l'agent uniquement par convention UI.

Mapping cible:

```ts
UserToolRun.toolId -> UserTool._id
UserToolRun.workflowId -> Workflow._id?
UserToolRun.agentPrototypeId -> AgentPrototype._id?
UserToolRun.agentInstanceId -> AgentInstance._id?
UserToolRun.executionId -> cle externe unique
```

Regles:

1. `executionId` d'`AgentInstance` et `executionId` de `UserToolRun` ne doivent pas etre confondus semantiquement sans convention explicite
2. au Plan 1, un `UserToolRun.executionId` represente l'identite de l'execution du tool
3. si un agent orchestre plusieurs appels tools, chaque appel outille persiste son propre `UserToolRun`
4. le lien vers l'instance d'agent se fait par `agentInstanceId`, pas par surcharge de `executionId`

## 6.2 Consequence anti-regression

1. `AgentLoop.toolCallLog[].id` ne peut pas rester une simple convention locale frontend si l'on veut de l'audit persistant
2. il faudra a terme faire converger chaque tool call persiste vers un `UserToolRun.executionId` ou un champ de correlation dedie
3. `ChatMessage.toolCallRecord.functionId` devra representer un id de `user_tools`, pas un id legacy `user_functions`

---

## 7. Conventions tool/version utilisables par les agents

## 7.1 Reference minimale en Plan 1

Pour les prototypes et instances, la reference minimale reste:

```ts
string[] // ids de user_tools
```

Cette forme est retenue pour limiter la casse frontend et rester compatible avec `functionIds`.

## 7.2 Resolution de version

Par defaut:

1. une reference agent vers `user_tools._id` resolve `currentVersion`
2. un run persiste ensuite `toolVersionTag` et `toolContentHash`
3. l'agent ne porte pas encore une reference embarquee `{ toolId, versionTag }` au Plan 1 sauf besoin critique prouve plus tard

Conclusion:

1. les agents referencent l'identite stable du tool
2. les runs referencent l'identite stable du tool plus la version effectivement executee
3. cela separe bien design domain et runtime domain

---

## 8. Alias de compatibilite obligatoires pendant migration

Les alias suivants doivent etre conserves tant que le frontend n'est pas migre completement:

1. `AgentPrototype.tools[]` backend -> expose aussi `functionIds[]` dans les DTO frontend
2. `AgentInstance.functionInheritance.overrideFunctionIds[]` garde le meme nom, mais change de referentiel vers `user_tools._id`
3. `ChatMessage.toolCallRecord.functionId` garde son nom, mais doit representer `user_tools._id`

Ce qui ne doit pas etre fait:

1. introduire un troisieme nom concurrent pour la meme reference de tool
2. conserver `user_functions` comme referentiel implicite cache derriere `functionIds`
3. injecter des objets complets de tool dans les instances comme source canonique de persistence

---

## 9. Legacy -> cible

| Zone | Legacy | Cible Plan 1 | Compatibilite transitoire |
| --- | --- | --- | --- |
| Prototype tools | `UserFunction._id[]` | `user_tools._id[]` | exposer aussi `functionIds[]` |
| Instance tools | `UserFunction._id[]` | `user_tools._id[]` | conserver `tools[]` backend tant que routes/transforms ne sont pas migrees |
| Instance overrides | `overrideFunctionIds[]` vers `user_functions` | `overrideFunctionIds[]` vers `user_tools` | meme nom de champ |
| Tool call record | `functionId` legacy | `functionId` = `user_tools._id` | meme nom de champ |
| Run history | implicite ou UI locale | `user_tool_runs` | relier ensuite a agent via ids |
| Workflow function paths | `UserSettings.functionPaths[]` | `workspaces` | lecture legacy seulement |

---

## 10. Decisions explicites

1. `workflowId` reste la reference fonctionnelle de premier niveau pour les agents et runs
2. `workspaceId` reste la reference technique de premier niveau pour les tools
3. les agents ne referencent pas directement un workspace au Plan 1
4. `functionIds` reste le nom frontend de compatibilite mais doit pointer vers `user_tools._id`
5. les runs portent la verite d'execution, pas `AgentInstance.content`

---

## 11. Sortie attendue de l'etape 4

L'etape 4 est consideree validee quand les conditions suivantes sont toutes vraies:

1. chaque reference entre workflow, workspace, tool, prototype, instance et run a un proprietaire clair
2. la convergence hors `user_functions` est explicite pour prototypes, instances et tool calls
3. le frontend conserve un contrat de compatibilite sans ambiguite sur `functionIds`
4. la coexistence additive du legacy peut etre concue sans cutover implicite