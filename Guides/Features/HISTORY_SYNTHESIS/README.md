# HISTORY SYNTHESIS - Regles De Synthese Invisible

**Statut**: Reference technique active  
**Perimetre**: Historique conversationnel des instances d'agent sur la map workflow et dans le fullscreen chat  
**Public cible**: Developpeurs frontend/runtime, reviewers, agents IA charge d'implementer ou d'auditer la fonctionnalite

---

## 1. Objet

Ce document centralise les regles de la **synthese d'historique invisible**.

Le but n'est pas de modifier ce que l'utilisateur voit dans la fenetre de chat, mais de compacter le contexte envoye au LLM quand les limites configurees sont atteintes.

La fonctionnalite doit rester strictement separee de la persistance durable des conversations.

---

## 2. Principes Metier

1. L'historique visible du chat reste la source de verite UX.
2. La synthese est **invisible**: elle ne doit pas apparaitre comme un message dans le chat.
3. La synthese est **ephemere**: elle appartient au runtime et ne doit pas etre persistee en base ni dans le journal utilisateur.
4. La persistance enregistre uniquement les **nouveaux elements visibles** du chat, sans re-sauvegarder tout l'historique a chaque tour.
5. La synthese ne doit jamais resumer le dernier message utilisateur en cours d'envoi. Ce message doit rester transmis tel quel au LLM.

---

## 3. Regle De Declenchement

Une synthese est declenchee si, et seulement si:

1. `historyConfig.enabled === true`
2. au moins une limite est active dans `historyConfig.enabledLimits`
3. au moins une limite active est atteinte dans `historyConfig.limits`

Limites supportees:

1. `char`
2. `word`
3. `token`
4. `sentence`
5. `message`

Valeurs par defaut attendues:

1. `sentence` active avec une limite a `30`
2. `message` active avec une limite a `6`
3. `char`, `word` et `token` desactives par defaut

Regle stricte:

1. **OR logique** entre les limites actives
2. une limite desactivee ne participe jamais au declenchement
3. une limite `<= 0` n'est pas declenchable

---

## 4. Strategie D'Implementation

Le pattern retenu est une **strategie partagee de synthese d'historique** appuyee sur un **etat runtime ephemere**.

Composants clefs:

1. `services/historySynthesisPolicy.ts`
   Role: calcul des stats et decision de declenchement
2. `services/historySynthesisService.ts`
   Role: preparation du contexte LLM et generation de la synthese invisible
3. `stores/useRuntimeStore.ts`
   Role: stockage ephemere de `nodeInvisibleHistorySummaries`

La logique ne doit plus etre dupliquee entre plusieurs surfaces runtime.

---

## 5. Cycle D'Un Tour De Chat

### Cas nominal sans synthese

1. L'utilisateur envoie un message visible
2. Le message visible est ajoute au runtime
3. Le journal persiste uniquement ce nouveau message visible si la persistance du chat est active
4. Le LLM recoit l'historique visible normal

### Cas avec synthese invisible

1. L'utilisateur envoie un message visible
2. Les limites actives sont evaluees sur le contexte a envoyer
3. Si une limite active est atteinte:
   - l'historique precedent est resume par le LLM de synthese
   - le dernier message utilisateur n'est pas inclus dans cette synthese
   - le resume produit devient la nouvelle base runtime invisible pour les tours suivants
4. Le LLM principal recoit:
   - le resume invisible
   - puis le dernier message utilisateur brut
5. Le chat visible n'est pas remplace par un faux message de resume
6. Le journal ne persiste jamais ce resume invisible

### Signal utilisateur pendant la synthese

1. Quand une synthese est en cours pour le tour courant, un loader visible doit apparaitre dans le chat.
2. Ce loader doit afficher l'etat de traitement du LLM et une icone de synthese dediee.
3. Ce signal doit exister sur les deux surfaces runtime: la carte workflow et le fullscreen chat.
4. L'icone disparait des que le tour est termine.

---

## 6. Contrat De Persistance

Invariants obligatoires:

1. la synthese invisible ne doit jamais etre ecrite dans `chatMessages`
2. la synthese invisible ne doit jamais etre poussee comme entree `chat` dans le journal
3. l'enregistrement manuel ou automatique continue a persister les nouveaux messages visibles uniquement
4. la deduplication de persistance reste gouvernee par les mecanismes existants (`lastSavedAt`, journal queue, journal persistence)

---

## 7. Contrat De Configuration

`HistoryConfig` doit contenir:

1. `enabled`
2. `llmProvider`
3. `model`
4. `role`
5. `systemPrompt`
6. `limits`
7. `enabledLimits`

Les formulaires prototype et instance doivent exposer les cinq limites avec:

1. une valeur numerique
2. une activation individuelle persistable

---

## 8. Regles De Test

La feature n'est consideree stable que si les points suivants sont verifies:

1. chaque seuil (`char`, `word`, `token`, `sentence`, `message`) declenche bien la synthese quand il est actif
2. un seuil desactive n'a aucun effet
3. la synthese n'apparait pas comme message visible dans le chat
4. le dernier message utilisateur n'est pas absorbe dans le prompt de synthese
5. le contexte du LLM principal devient `resume invisible + dernier message utilisateur`
6. la sauvegarde du formulaire persiste bien `enabledLimits`
7. les defaults de formulaire activent `sentence=30` et `message=6`
8. le loader de synthese avec icone apparait pendant le tour qui declenche la synthese

---

## 9. Risques A Surveiller

1. reintroduire un faux message visible de resume dans le chat
2. persister accidentellement le resume invisible dans la base ou le journal
3. dupliquer la logique entre `useAgentChat` et `V2AgentNode`
4. oublier un seuil expose dans le formulaire, en particulier `char`
5. resumer le message utilisateur courant et l'envoyer ensuite une deuxieme fois au LLM