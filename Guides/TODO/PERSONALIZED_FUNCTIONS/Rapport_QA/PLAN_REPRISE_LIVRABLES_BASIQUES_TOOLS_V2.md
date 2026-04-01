# PLAN OPERATIONNEL DE REPRISE - LIVRABLES BASIQUES TOOLS V2

## 1. Mandat immediat au codeur expert

Ce document remplace le plan precedent dans sa forme operationnelle.

Le mandat est strict:

1. Retablir les 2 livrables basiques reellement attendus.
2. Ne pas toucher aux sujets hors perimetre.
3. Ne pas casser le provisioning natif Python qui fonctionne deja.
4. Fournir des preuves techniques et QA a la fin de chaque jalon.
5. Ne pas passer au jalon suivant tant que le precedent n'a pas son critere de sortie et ses tests QA valides.

## 2. Livrables a restaurer

### Livrable A

Sur carte workflow, un agent pilote par LLM local avec fonction TypeScript personnalisee doit:

1. soit executer la fonction correctement,
2. soit afficher un echec visible, borne et terminal,
3. sans blocage infini de l'UI,
4. sans faux succes de streaming.

### Livrable B

Sur carte workflow, un agent pilote par LLM local avec `web_search_py` doit:

1. executer un seul appel utile,
2. ne pas dupliquer l'appel,
3. ne pas deriver hors scenario,
4. ne pas analyser conversationalement un echec deterministe comme s'il etait recuperable.

## 3. Perimetre exact

### Fichiers backend cibles

- `backend/src/routes/lmstudio.routes.ts`
- `backend/src/services/lmstudioProxy.service.ts`
- `backend/src/server.ts`
- `backend/src/services/sandbox.service.ts`
- `backend/src/services/toolPreparationPolicy.service.ts`
- `backend/src/routes/sandbox.routes.ts`

### Fichiers frontend cibles

- `services/lmStudioService.ts`
- `services/adapters/LocalLLMAdapter.ts`
- `services/llm/AgentLoop.ts`
- `services/llm/FunctionCallingPromptBuilder.ts`
- `services/llm/ToolCallParser.ts`
- `components/V2AgentNode.tsx`

### Hors perimetre

- provisioning natif Python deja livre, sauf tests de non-regression lies a son usage
- refactoring cosmetique sans impact direct sur les 2 livrables
- nouvelles features Tools V2 non exigees par ces 2 cas de base

## 4. Causes racines retenues

### CR-1 Proxy local LLM non transactionnel

- Le backend engage la reponse SSE trop tot.
- Un echec upstream peut survenir apres HTTP 200 deja envoye.
- Resultat: faux streaming reussi et attente opaque cote UI.

### CR-2 Contrat d'erreur local LLM trop faible

- `LocalLLMAdapter` degrade l'erreur en pseudo-resultat.
- `AgentLoop` et `V2AgentNode` ne portent pas un contrat terminal unique.
- Resultat: conversation qui ne se ferme pas proprement.

### CR-3 Stop-policy insuffisante dans la boucle agentique

- Les echec outils deterministes ne ferment pas assez tot la boucle.
- Une variation d'arguments peut contourner la deduplication actuelle.
- Resultat: appels dupliques et derive de scenario.

### CR-4 Resolution Tools V2 pas assez exclusive

- La presence de `toolSelection` n'interdit pas assez fermement le fallback legacy.
- Resultat: erreurs floues et diagnostic brouille.

### CR-5 Prompt encore trop permissif apres echec

- Le modele est encore incite a expliquer et proposer des alternatives apres un echec technique bloquant.
- Resultat: bruit conversationnel, pas un comportement produit fiable.

## 5. Regles d'execution obligatoires pour le codeur expert

1. Travailler jalon par jalon, pas en lot large.
2. Ajouter les tests en meme temps que le code, pas apres.
3. Si un jalon modifie le contrat d'erreur, mettre a jour les assertions frontend et backend dans le meme jalon.
4. Ne jamais laisser un fallback silencieux lorsqu'une requete `toolSelection` est invalide.
5. Ne jamais laisser un agent local en etat pending apres une erreur terminale.
6. Ne pas introduire de retry implicite supplementaire sans classification explicite `retryable`.

## 6. Plan executable en 5 jalons maximum

### Jalon 1 - Rendre le streaming local LLM fiable avant tout

#### Objectif

Supprimer le faux succes HTTP 200 et garantir qu'un echec upstream local LLM devient un echec reseau proprement classifie.

#### Design retenu

Pattern de `stream handshake` backend avant engagement SSE.

#### Travaux code obligatoires

1. Dans `backend/src/services/lmstudioProxy.service.ts`, extraire une phase explicite d'ouverture du stream upstream avec classification d'erreur:
   - `timeout`
   - `bad_status`
   - `upstream_unreachable`
   - `stream_aborted`
2. Dans `backend/src/routes/lmstudio.routes.ts`, ne plus flush les headers SSE avant validation du handshake upstream.
3. Si le handshake echoue, repondre avec un vrai statut HTTP d'erreur et un JSON structure.
4. Dans `backend/src/server.ts`, aligner les timeouts Node utiles au chemin `/api/lmstudio/chat/completions` avec le timeout de premier octet deja defini.
5. Ne pas envoyer `: connected` tant que le flux upstream n'est pas effectivement engage.

#### Tests codeur expert obligatoires

1. Test backend: upstream 5xx avant premier token => pas de 200 SSE, retour HTTP erreur structure.
2. Test backend: timeout avant premier token => pas de 200 SSE, retour HTTP timeout structure.
3. Test backend: premier chunk recu => headers SSE ouverts seulement apres succes du handshake.
4. Test backend: stream coupe apres handshake => erreur de stream traquee et fermeture propre.

#### Tests QA a executer

1. Scenario QA: agent local avec modele lent qui ne repond pas rapidement.
   Resultat attendu: message d'echec visible en temps borne, jamais de spinner infini.
2. Scenario QA: agent local avec modele indisponible ou endpoint faux.
   Resultat attendu: erreur immediate, pas de conversation fantome.
3. Scenario QA: agent local avec modele sain.
   Resultat attendu: streaming normal, aucun regressif visible sur le chemin heureux.

#### Critere de sortie

Le frontend ne peut plus rester en attente indefinie a cause d'un faux stream LMStudio engage trop tot.

#### No-Go explicite

Ne pas passer au jalon 2 si un seul cas QA conserve un chargement infini.

### Jalon 2 - Propager une panne terminale unique jusqu'a l'UI

#### Objectif

Faire circuler une erreur terminale locale LLM unique, de l'adapter a l'interface, sans conversion en pseudo-reponse.

#### Design retenu

Contrat transverse `LocalLLMStreamError` ou equivalent, interprete de facon identique par adapter, boucle agentique et UI.

#### Travaux code obligatoires

1. Dans `services/adapters/LocalLLMAdapter.ts`, cesser de retourner une completion vide sur erreur de stream.
2. Definir un type structure contenant au minimum:
   - `code`
   - `message`
   - `retryable`
   - `provider`
   - `model`
3. Dans `services/llm/AgentLoop.ts`, convertir cette erreur en fin terminale explicite du tour agent.
4. Dans `components/V2AgentNode.tsx`, afficher un message final utilisateur et sortir systematiquement de l'etat pending.
5. Dans `services/lmStudioService.ts`, enrichir les erreurs de lecture de stream avec un contexte lisible pour diagnostic.

#### Tests codeur expert obligatoires

1. Test frontend/adapter: erreur de stream => emission d'une erreur terminale typee.
2. Test AgentLoop: erreur locale LLM => boucle stoppee sans iteration supplementaire.
3. Test UI: erreur locale LLM => message agent visible et suppression de l'etat de chargement.
4. Test UI: reponse normale => aucun changement regressif sur l'affichage standard.

#### Tests QA a executer

1. Scenario QA: fonction TypeScript avec LLM local en timeout.
   Resultat attendu: la carte agent affiche un echec final clair.
2. Scenario QA: coupure reseau ou endpoint local coupe pendant une generation.
   Resultat attendu: l'agent ne reste jamais bloque en attente.
3. Scenario QA: conversation normale sans outil.
   Resultat attendu: aucun regressif sur un simple chat local.

#### Critere de sortie

Toute panne locale LLM clot proprement le tour agent et devient visible pour l'utilisateur.

#### No-Go explicite

Ne pas passer au jalon 3 si une erreur locale LLM peut encore finir avec `pending=true` cote UI.

### Jalon 3 - Fermer la boucle agentique sur echec deterministe

#### Objectif

Empecher les duplications et la derive de scenario apres un echec outil deterministe.

#### Design retenu

Pattern de `conversation circuit breaker` avec double garde:

1. deduplication par signature stable,
2. quota strict par outil en echec non-retryable sur le meme run.

#### Travaux code obligatoires

1. Dans `services/llm/AgentLoop.ts`, distinguer clairement:
   - erreur retryable
   - erreur non-retryable
   - erreur deterministe bloquante
2. Introduire une cle stable de deduplication par:
   - `toolId`
   - `versionTag`
   - hash arguments normalises
3. Ajouter une garde supplementaire par outil pour empecher qu'une simple variation d'arguments relance la meme impossibilite structurelle.
4. Si un outil retourne un echec deterministe bloquant, produire immediatement une sortie agent finale et stopper la boucle.
5. Verifier la transmission reelle du contexte `errorDetails` depuis `sandbox.routes.ts` jusqu'a `AgentLoop.ts`.
6. Si `errorDetails` est absent sur une 409 non-retryable, tracer une anomalie et traiter le cas de facon conservative comme blocant tant que le contrat n'est pas conforme.
7. Dans `services/llm/FunctionCallingPromptBuilder.ts`, retirer la consigne qui pousse a proposer une alternative speculative apres echec technique bloquant.
8. Dans `services/llm/ToolCallParser.ts`, filtrer les doublons exacts si plusieurs strategies retournent le meme appel.

#### Tests codeur expert obligatoires

1. Test AgentLoop: meme outil, meme arguments, echec deterministe => 1 appel execute, 1 message final.
2. Test AgentLoop: meme outil, arguments legerement differents, meme impossibilite structurelle => pas de boucle de retries non borne.
3. Test AgentLoop: erreur explicitement retryable => la boucle peut continuer selon la politique definie.
4. Test parser: deux appels identiques extraits => 1 seul appel retenu.
5. Test prompt builder: echec deterministe => pas d'instruction qui encourage un contournement speculatif.

#### Tests QA a executer

1. Scenario QA: `web_search_py` en situation d'echec deterministe.
   Resultat attendu: un seul appel, puis un message final borne.
2. Scenario QA: outil indisponible non-retryable.
   Resultat attendu: pas de repetition automatique ni de derive conversationnelle.
3. Scenario QA: outil temporairement retryable.
   Resultat attendu: comportement conforme a la politique definie, sans repetition sauvage.

#### Critere de sortie

Le scenario `web_search_py` ne peut plus produire une rafale d'appels dupliques ni une analyse parasite d'un echec bloquant.

#### No-Go explicite

Ne pas passer au jalon 4 si un scenario QA produit encore plus d'un appel non justifie pour le meme blocage outil.

### Jalon 4 - Verrouiller contractuellement la resolution Tools V2

#### Objectif

Supprimer toute ambiguite entre chemin Tools V2 versionne et fallback legacy.

#### Design retenu

Resolution exclusive et erreurs metier typees.

#### Travaux code obligatoires

1. Dans `backend/src/services/sandbox.service.ts`, separer sans ambiguite:
   - chemin `toolSelection` obligatoire et exclusif
   - chemin legacy uniquement si `toolSelection` absent
2. Si `toolSelection` est present mais invalide, echouer immediatement avec un code metier dedie.
3. Introduire des erreurs explicites du type:
   - `TOOL_SELECTION_REQUIRED`
   - `TOOL_TARGET_RESOLUTION_FAILED`
   - `TOOL_VERSION_NOT_FOUND`
4. S'assurer que `toolPreparationPolicy.service.ts` reste l'autorite unique pour readiness/build/provision, sans contournement local.
5. Verifier que le message utilisateur final ne parle plus de `custom editable tools` quand le vrai sujet est une mauvaise resolution de cible versionnee.

#### Tests codeur expert obligatoires

1. Test backend: `toolSelection` valide => execution de la bonne cible versionnee.
2. Test backend: `toolSelection` invalide => erreur metier explicite, jamais de fallback legacy silencieux.
3. Test backend: requete legacy sans `toolSelection` => chemin historique preserve.
4. Test backend: outil natif readonly => politique de preparation correcte, sans message trompeur.

#### Tests QA a executer

1. Scenario QA: outil Tools V2 versionne valide.
   Resultat attendu: execution de la bonne version.
2. Scenario QA: selection de version invalide ou incoherente.
   Resultat attendu: echec immediat, explicite, sans tentative parasite.
3. Scenario QA: ancien flux legacy encore supporte.
   Resultat attendu: pas de regression sur le chemin historique attendu.

#### Critere de sortie

Une requete avec `toolSelection` invalide ne peut plus deriver vers un chemin legacy silencieux.

#### No-Go explicite

Ne pas passer au jalon 5 si une erreur de resolution peut encore se presenter comme une erreur metier d'un autre type.

### Jalon 5 - TNR de cloture et validation QA des 2 livrables

#### Objectif

Clore le chantier uniquement apres validation code + QA des 2 livrables de base.

#### Design retenu

Matrice de validation courte, concrete, orientee comportement complet `proxy -> adapter -> AgentLoop -> sandbox -> UI`.

#### Travaux code obligatoires

1. Ajouter ou mettre a jour les TNR backend/frontend necessaires pour les cas suivants:
   - timeout avant premier token
   - erreur locale LLM terminale visible
   - echec deterministe outil sans duplication
   - `toolSelection` invalide sans fallback legacy
   - chemin heureux TypeScript local
   - chemin heureux `web_search_py` local
2. Documenter dans le commit de livraison la preuve de passage des suites pertinentes.
3. Ne rien livrer si seuls les tests unitaires backend passent sans preuve de comportement UI.

#### Tests QA a executer

1. QA finale Livrable A:
   - agent workflow avec fonction TypeScript personnalisee
   - modele local operationnel
   - cas succes
   Resultat attendu: execution correcte et retour propre dans la carte
2. QA finale Livrable A bis:
   - meme scenario mais avec incident LLM local simule
   Resultat attendu: echec visible, borne, terminal, sans blocage UI
3. QA finale Livrable B:
   - agent workflow avec `web_search_py`
   - modele local operationnel
   - cas succes
   Resultat attendu: appel unique et resultat coherent
4. QA finale Livrable B bis:
   - scenario provoquant un echec deterministe
   Resultat attendu: un seul appel, message final borne, aucune derive conversationnelle
5. QA de non-regression transverse:
   - simple chat local sans outil
   - ancien chemin legacy attendu
   Resultat attendu: aucun regressif utilisateur visible

#### Critere de sortie

Le chantier n'est clos que si les 2 livrables suivants sont valides en QA reelle:

1. TypeScript local: succes reel ou echec propre et terminal.
2. `web_search_py` local: appel unique pertinent, sans duplication et sans analyse parasite d'un echec deterministe.

#### No-Go explicite

Interdiction de declarer le plan termine si une seule validation QA reelle manque sur les 2 livrables basiques.

## 7. Tableau de pilotage minimal

| Jalon | Cible | Preuve codeur expert | Preuve QA | Blocage a surveiller |
| --- | --- | --- | --- | --- |
| 1 | handshake stream fiable | tests backend stream verts | plus aucun chargement infini | faux 200 SSE |
| 2 | erreur terminale visible | tests adapter plus UI verts | erreur visible et fin de pending | pseudo-reponse vide |
| 3 | zero duplication apres echec determinant | tests AgentLoop plus parser verts | un seul appel sur `web_search_py` en echec | variation d'arguments |
| 4 | resolution Tools V2 exclusive | tests sandbox verts | plus de fallback legacy silencieux | erreur metier trompeuse |
| 5 | validation finale des 2 livrables | TNR completes | QA reelle validee | cloture prematuree |

## 8. Definition stricte de termine

Le codeur expert peut rendre la main uniquement si les conditions suivantes sont toutes vraies:

1. Aucun chargement infini n'est reproductible sur agent local.
2. Toute erreur locale LLM terminale est visible dans la carte agent.
3. `web_search_py` ne se duplique plus sur echec deterministe.
4. `toolSelection` invalide n'a aucun fallback legacy implicite.
5. Les 2 livrables basiques sont valides par QA reelle, pas seulement par tests developpeur.

## 9. Consigne finale

Ce plan doit etre execute tel quel par le codeur expert.

Si un jalon echoue, il faut corriger le jalon en cours avant toute extension de perimetre. Aucune nouvelle promesse de plan global ne doit remplacer la validation effective des 2 livrables basiques.