# BILAN D'ECHEC DU SECOND PLAN DE CORRECTION TOOLS V2

**Statut**: critique  
**Date**: 2026-03-31  
**Public cible**: chef de projet, architectes, QA, codeur-specialiste  
**Perimetre**: flux agentiques Tools avec LLMs locaux, fonctions custom TypeScript, fonction native `web_search_py`, proxy de streaming local, boucle d'appel d'outils

---

## 1. Objet du document

Ce document ne remplace pas le plan de correction post-QA initial.
Il etablit un **bilan critique du second plan de correction**, apres constat d'echec sur les **deux livrables fonctionnels de base** qui devaient permettre de reprendre la feature Tools dans des conditions professionnelles minimales.

Point de cadrage essentiel:

1. il n'est **pas** affirme ici que le second plan etait nul sur tout
2. il est affirme en revanche que les **deux livrables fonctionnels de base** attendus pour la feature Tools sont en **echec complet**
3. il est affirme egalement que le flux de la fonction custom TypeScript a subi une **regression factuelle** alors qu'il fonctionnait il y a peu
4. dans cet etat, la feature Tools ne peut pas etre consideree comme fonctionnelle sur son socle minimal, ce qui invalide toute pretention a une requalification serieuse du chantier

Ce bilan doit etre lu comme une **remise a niveau de rigueur**.
Le sujet n'est pas la quantite de code produite ni l'existence de correctifs backend partiels.
Le sujet est la capacite a livrer des **preuves fonctionnelles elementaires** sur un workflow agentique de haut niveau capable d'appeler des Tools TypeScript ou Python en mars 2026.

---

## 2. Constat principal

Le second plan de correction a pu produire des progres techniques ponctuels, notamment sur le provisionnement natif.
Mais ces progres n'ont pas ete transformes en **livrables fonctionnels reels** sur les deux tests basiques de la feature Tools.

Constat dur mais necessaire:

1. les deux tests de base demandes a la QA constituent le **socle minimal** de la feature Tools
2. aucun des deux n'a abouti correctement
3. le premier test, sur une fonction custom TypeScript via agent local, est devenu une **regression visible**
4. le second test, sur `web_search_py`, reste en **echec agentique et contractuel**, malgre l'ajout du provisionnement natif
5. ce decalage entre correction codee et livrable fonctionnel prouve un manque de rigueur grave dans la chaine de validation

Impact projet:

1. temps perdu pour la QA, les architectes et le chef de projet
2. argent perdu sur des cycles de correction qui ne verrouillent pas les livrables de base
3. perte de confiance justifiee dans la capacite du second plan a requalifier le socle Tools V2
4. impossibilite de passer sereinement aux etapes suivantes de perfectionnement prevues par les architectes

---

## 3. Contexte prioritaire des 2 tests basiques de la feature Tools

Ce contexte est la priorite absolue de lecture.
Il doit gouverner toute reprise technique ulterieure.

### 3.1 Scenario reel attendu par la QA

La verification de base de la feature Tools ne repose pas sur des tests unitaires ou des routes backend isolees.
Elle repose sur un **scenario agentique reel** sur la carte du workflow.

Le contexte de test est le suivant:

1. deux agents sont poses sur la carte du workflow
2. chaque agent est connecte a un **LLM local** distinct
3. le premier agent doit appeler **une fonction custom TypeScript**
4. le second agent doit appeler **la fonction native `web_search_py`**
5. ces deux tests constituent les **livrables fonctionnels de base** de la feature Tools avant toute sophistication ulterieure

Interpretation architecturale:

1. ces deux tests ne sont pas des options de confort
2. ils sont le **point de passage minimal** pour prouver que le socle Tools sait:
   - resoudre un tool
   - appeler un tool
   - attendre un resultat
   - arreter proprement en cas d'echec
   - remonter un diagnostic exploitable
3. si ces deux tests echouent, la feature Tools n'est pas operationnelle, peu importe le nombre de correctifs partiels deja implementes

### 3.2 Test de base n°1 - agent local appelant une fonction custom TypeScript

Attendu:

1. l'agent local envoie une requete a son LLM local
2. le LLM produit un tool call pour une fonction custom TypeScript
3. la fonction est executee une seule fois
4. le resultat ou l'erreur est restitue explicitement dans le chat utilisateur

Observe:

1. aucune sortie visible n'apparait dans le chat utilisateur
2. le chat attend indefiniment
3. le backend journalise un echec de streaming local avec timeout des headers
4. la reponse HTTP reste `200`, ce qui trompe la lecture operationnelle alors qu'un echec s'est produit

Preuve log representative:

```text
[LMStudio Proxy] ... stream:true
[LMStudio Proxy] Streaming error: TypeError: fetch failed
  [cause]: HeadersTimeoutError ... code: 'UND_ERR_HEADERS_TIMEOUT'
[LMStudio Proxy] POST /chat/completions - 200 (310524ms)
```

Conclusion factuelle:

1. le premier livrable de base est en **echec complet**
2. cet echec est aussi une **regression** puisqu'un flux custom TypeScript fonctionnait recemment
3. le systeme ne tient pas son contrat minimal de visibilite d'erreur et de terminaison du flux utilisateur

### 3.3 Test de base n°2 - agent local appelant `web_search_py`

Attendu:

1. l'agent local envoie une requete a son LLM local
2. le LLM produit un tool call unique vers `web_search_py`
3. la fonction native execute sa recherche via la bibliotheque DuckDuckGo prevue
4. le resultat est renvoye a l'agent puis au chat utilisateur sans boucle aberrante

Observe:

1. l'appel de fonction apparait **deux fois** dans le chat au lieu d'une
2. le resultat en echec est re-analyse par le LLM au lieu d'arreter la boucle de facon nette
3. le systeme derive du scenario attendu et produit un comportement non maitrise
4. les traces backend montrent plusieurs tours successifs de `/chat/completions` avec augmentation des `messagesCount`

Preuve log representative:

```text
[LMStudio Proxy] ... model:"qwen/qwen3.5-9b" messagesCount:3 stream:true
[LMStudio Proxy] POST /chat/completions - 200 (47707ms)
[LMStudio Proxy] ... messagesCount:5 stream:true
[LMStudio Proxy] POST /chat/completions - 200 (98033ms)
[LMStudio Proxy] ... messagesCount:7 stream:true
[LMStudio Proxy] POST /chat/completions - 200 (198581ms)
```

Conclusion factuelle:

1. le second livrable de base est lui aussi en **echec complet**
2. le provisionnement natif branche precedemment ne suffit pas a valider le livrable si la boucle agentique reste defectueuse
3. le systeme ne respecte pas encore le contrat minimal d'un appel de tool natif unique, interpretable et borne

### 3.4 Point de clarification sur la mention de Bing

La mention de Bing dans les symptomes doit etre traitee avec rigueur.

Ce qui est etabli:

1. le scenario metier attendu par l'equipe est un appel `web_search_py` base sur la bibliotheque DuckDuckGo recente
2. la simple apparition de Bing dans les symptomes ne suffit pas a prouver, seule, une derive du code applicatif
3. en revanche, la derive de scenario reste un **signal d'alerte** tant que le comportement agentique n'est pas stabilise et explique

Decision de bilan:

1. la regression principale retenue ici n'est pas "Bing"
2. la regression principale retenue est:
   - duplication d'appel
   - mauvaise gestion d'echec deterministe
   - poursuite de raisonnement LLM sur un resultat d'outil en echec

---

## 4. Lecture critique du second plan execute

Le probleme ne vient pas d'une absence totale de travail.
Le probleme vient d'une **priorisation insuffisamment orientee livrables fonctionnels**.

Le second plan a produit des efforts reels sur des briques backend, mais il a rate le critere principal:

1. valider les deux scenarios QA de base avec deux agents relies a deux LLMs locaux

Ce ratage montre plusieurs faiblesses de methode:

1. surestimation de la valeur de correctifs backend cibles sans validation du parcours agentique complet
2. sous-valorisation des preuves manuelles QA sur environnement local reel
3. absence de verrou de fin de jalon centre sur les deux livrables de base
4. confusion entre "amelioration du systeme" et "livrable fonctionnel effectivement disponible"

Verdict professionnel:

1. le second plan n'est pas invalide sur chaque sous-piece
2. mais il est **en echec comme plan de requalification fonctionnelle** de la feature Tools
3. cet echec est suffisant pour imposer un bilan critique explicite avant toute reprise

---

## 5. Les 4 etapes logiques obligatoires de verification et de debuggage

Ces 4 etapes constituent desormais le cadre prioritaire de reprise.
Elles doivent etre appliquees dans cet ordre et relues contre les deux tests de base du workflow.

### Etape 1 - Verifier qu'un timeout LLM local produit un echec visible et borne

Question a resoudre:

1. comment le systeme reagit-il quand un LLM local met trop de temps a emettre son premier token ou casse son stream ?

Le systeme devra prouver:

1. qu'aucun chat utilisateur ne reste en attente indefinie
2. qu'une erreur visible et exploitable remonte cote utilisateur
3. qu'un `HTTP 200` ne masque pas un echec de streaming deja survenu
4. que les timeouts Node, proxy et frontend sont coherents entre eux

Application directe aux tests basiques:

1. cette etape traite prioritairement la regression du test custom TypeScript

### Etape 2 - Verifier qu'un echec deterministe d'outil natif n'entraine qu'un seul appel

Question a resoudre:

1. comment la boucle agentique classe-t-elle un echec de tool comme deterministe, et comment interdit-elle un deuxieme appel injustifie ?

Le systeme devra prouver:

1. qu'un echec deterministe `tool` ou `build/provision readiness` produit un seul appel de fonction
2. qu'aucune re-invocation n'est relancee sur les memes arguments sans justification metier explicite
3. que l'echec n'est pas retransforme en pseudo-matiere de raisonnement pour le LLM sans garde-fou

Application directe aux tests basiques:

1. cette etape traite prioritairement la regression observee sur `web_search_py`

### Etape 3 - Verifier qu'un `toolSelection` invalide ou incomplet ne retombe jamais silencieusement sur un chemin legacy

Question a resoudre:

1. le systeme suit-il toujours la bonne cible metier, ou bien tombe-t-il silencieusement sur un autre chemin de resolution ?

Le systeme devra prouver:

1. qu'un `toolSelection` invalide ou incomplet produit une erreur explicite
2. qu'il n'existe aucun fallback silencieux vers un chemin `functionId` legacy ou une autre categorie de fonction
3. que les politiques `custom editable` et `native readonly platform-provisioned` restent strictement separees

Application directe aux tests basiques:

1. cette etape conditionne la fiabilite du flux `web_search_py`
2. elle protege aussi les futurs flux custom contre des resolutions de cible incoherentes

### Etape 4 - Rejouer les 2 scenarios QA reels apres correction

Question a resoudre:

1. les corrections produisent-elles enfin les deux livrables fonctionnels minimaux sur environnement reel ?

Le systeme devra prouver:

1. qu'un agent connecte a un LLM local appelle correctement une fonction custom TypeScript et restitue un resultat ou une erreur claire
2. qu'un second agent connecte a un autre LLM local appelle `web_search_py` une seule fois, avec un resultat borne et interpretable
3. que ces deux scenarios sont rejoues en QA reelle, pas seulement en tests backend cibles

Application directe aux tests basiques:

1. cette etape est la seule qui autorise a parler de reprise de la feature Tools sur son socle minimal

---

## 6. Causes racines probables a ce stade

Sans prejuger des futurs correctifs de code, l'analyse actuelle converge vers deux familles principales de causes racines.

### 6.1 Famille A - gestion incorrecte du streaming et des timeouts LLM locaux

Hypotheses principales:

1. le proxy de streaming engage trop tot une reponse `200` avant d'avoir securise le stream effectif
2. les timeouts Node/Undici/proxy/frontend ne sont pas alignes
3. les erreurs de streaming sont mal propagees jusqu'au chat utilisateur
4. le frontend ne restitue pas correctement le statut d'erreur terminal

### 6.2 Famille B - gestion incorrecte des echecs deterministes dans la boucle agentique

Hypotheses principales:

1. la boucle perd l'information qui permet de marquer un echec comme deterministe
2. la deduplication des appels de tools n'est pas assez forte
3. la resolution de cible entre `toolSelection` et `functionId` peut encore produire des chemins confus
4. un resultat d'echec d'outil est reexpose au LLM comme s'il devait continuer a raisonner au lieu d'arreter proprement

---

## 7. Ce que ce bilan exige pour la suite

Ce bilan impose un changement de standard immediat.

1. toute reprise doit etre orientee d'abord sur les **deux livrables fonctionnels de base**
2. toute correction devra etre jugee d'abord sur les **deux scenarios QA reels** du workflow a deux agents et deux LLMs locaux
3. aucune auto-validation ne devra reposer principalement sur des tests backend cibles si les scenarios QA de base restent negatifs
4. aucun nouveau raffinage architectural ne devra etre engage tant que ces deux livrables minimaux restent en echec

---

## 8. Position de synthese

La feature Tools n'est pas fonctionnelle sur son socle minimal.

Le point critique n'est pas seulement qu'il reste des bugs.
Le point critique est qu'apres deux plans de correction, les **deux tests les plus basiques** de la feature restent en echec, dont un avec regression factuelle.

Ce constat impose:

1. de reprendre le chantier avec un niveau d'exigence plus eleve
2. de privilegier les livrables fonctionnels reels avant les satisfactions techniques partielles
3. de traiter ce bilan comme une base de redressement, pas comme un simple document de frustration

Verdict final de ce document:

1. le second plan a produit quelques briques utiles
2. mais il a **echoue sur les deux livrables fonctionnels de base** attendus de la feature Tools
3. la reprise doit donc etre critique, rigoureuse, centree sur les usages reels, et explicitement relue contre les 4 etapes de verification ci-dessus
