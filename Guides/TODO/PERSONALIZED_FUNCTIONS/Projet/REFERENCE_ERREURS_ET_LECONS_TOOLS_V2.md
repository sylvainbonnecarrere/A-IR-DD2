# REFERENCE — Erreurs, Lecons et Garde-Fous pour la Refonte Tools

> Date: 16 mars 2026
> Statut: Document de reference pour la nouvelle conception
> Objet: Capitaliser explicitement les erreurs de la premiere tentative afin de ne pas les reproduire

---

## 1. Contexte

La premiere tentative de la feature Tools a produit des avancees UX valides sur la page "Fonctions personnalisees", mais l'architecture proposee pour la BDD, le sandboxing, l'execution des tools et les fonctions natives a ete contestee puis invalidee.

Ce document sert de garde-fou avant la nouvelle phase de conception.

---

## 2. Erreurs majeures identifiees

### 2.1 Mauvais ordre de conception

L'erreur principale a ete de concevoir d'abord le mecanisme de sandbox, puis d'essayer d'y faire rentrer:
- l'editeur de la page Fonctions personnalisees,
- les tools executes par les agents sur la carte du workflow,
- les fonctions natives,
- les besoins de persistance et de reprise.

La bonne approche est inverse:
1. definir le contrat d'execution,
2. definir le modele de donnees,
3. definir les garanties d'idempotence,
4. definir les flux d'installation et de validation,
5. seulement ensuite choisir le sandboxing.

### 2.2 Contrat d'execution insuffisant

Une fonction n'a pas ete traitee comme un composant d'execution complet.

Elements insuffisamment definis lors de la premiere tentative:
- runtime cible exact,
- dependances obligatoires,
- format d'entree,
- format de sortie,
- protocole d'erreur,
- capture stdout/stderr,
- timeout,
- statut de sante,
- preconditions d'execution,
- identite et ownership de l'appel.

Consequence: les fonctions pouvaient exister dans l'UI sans etre reellement exploitables en runtime.

### 2.3 Installation sous-estimee

L'installation a ete traitee comme un prerequis technique secondaire alors qu'elle fait partie du comportement produit.

Exemple critique:
- `web_search_py` visible et selectionnable,
- dependance Python non exploitable dans le runtime reel,
- erreur remontee au moment de l'usage,
- absence de verification systematique au demarrage.

Le probleme n'est pas seulement "un package manque".
Le probleme reel est l'absence d'une chaine robuste:
1. resolution du runtime reel utilise,
2. installation des dependances dans CE runtime,
3. verification des imports,
4. marquage explicite de l'etat ready/unhealthy,
5. blocage de l'execution si la fonction n'est pas saine.

### 2.4 BDD pensee trop tot comme registre unique de la feature

La premiere version a trop melange:
- definition de fonction,
- selection par agent,
- sandboxing,
- execution,
- resultat,
- traces et logs.

Cela a cree du couplage et a affaibli la lisibilite des invariants.

La BDD doit etre redecoupee strictement entre au minimum:
1. definition de fonction,
2. environnement/runtime de fonction,
3. execution de fonction,
4. resultat d'execution,
5. liaison agent-instance vers fonction.

### 2.5 Isolation agent insuffisante

Le bug de confusion entre configurations locales a montre un probleme de fond:
- usage de resolution par provider,
- usage de lookups singleton,
- absence d'identite forte de l'agent a certains points d'execution.

Regle a ne plus violer:
un agent, et plus encore une instance d'agent dans un workflow, doit toujours resoudre ses ressources via son identite propre, jamais via une hypothese globale du type "premiere config du provider".

### 2.6 Fonctions natives traitees comme scripts utilitaires

Les fonctions natives n'ont pas ete traitees comme des composants produits, versionnes et verifiables.

Une fonction native doit etre consideree comme un artefact de production avec:
- dependances declarees,
- protocole d'erreur,
- tests d'import,
- tests d'execution,
- schema d'entree/sortie,
- compatibilite runtime,
- observabilite.

Sans cela, une fonction "presente" n'est pas une fonction "disponible".

---

## 3. Lecons techniques a conserver imperativement

### 3.1 L'installation fait partie de l'architecture

La nouvelle architecture devra garantir explicitement:
1. quel runtime Python est utilise par le backend,
2. quel runtime est utilise par l'editeur des fonctions,
3. quel runtime est utilise par les tools dans la carte du workflow,
4. que les dependances sont installees dans ce runtime exact,
5. que chaque fonction native passe un health-check d'import au boot,
6. que l'application sait exposer un statut `ready`, `degraded` ou `unhealthy`.

### 3.2 Un tool doit retourner une enveloppe d'execution structuree

Toute execution devra retourner une structure normalisee de type:
- `success`
- `result`
- `error`
- `stdout`
- `stderr`
- `diagnostics`
- `durationMs`
- `exitCode`
- `executionId`

Le besoin exprime par l'equipe d'un second argument ou d'une voie de recuperation de sortie en cas d'erreur confirme cette necessite.

### 3.3 Un pre-tool hook est necessaire

Avant toute execution, un hook de pre-execution doit pouvoir verifier au minimum:
- disponibilite du runtime,
- presence des dependances,
- validite des entrees,
- ownership/context utilisateur,
- disponibilite du sandbox ou du moteur d'execution,
- eventuelle idempotence/rejouabilite.

### 3.4 Le sandbox n'est pas la source de verite

Le sandbox est un moteur d'execution, pas le coeur metier.
Il ne doit jamais porter a lui seul:
- les invariants de la base,
- la resolution d'identite,
- les regles de selection des fonctions,
- les garanties de reprise.

### 3.5 L'idempotence doit etre modelisee explicitement

Chaque execution de fonction devra etre identifiable et rejouable proprement.

Invariants minimums:
1. `executionId` unique,
2. contexte d'appel complet (`userId`, `workflowId`, `agentInstanceId`, `functionId`),
3. statut explicite,
4. horodatage,
5. persistance du resultat ou de l'erreur,
6. comportement defini en cas de retry.

---

## 4. Points invalides de l'ancien plan

Les points suivants sont explicitement consideres comme non fiables ou obsoletes pour la suite:
- centralite de `isolated-vm`,
- architecture sandbox choisie avant les invariants de donnees,
- architecture BDD montee autour d'une registry trop couplante,
- hypothese qu'une fonction declaree est executable,
- absence de cycle robuste `install -> validate -> ready -> execute -> persist -> replay`,
- manque de separation entre usage editeur et usage workflow runtime.

---

## 5. Garde-fous non negociables pour la nouvelle version

### Garde-fou 1
La nouvelle architecture doit partir de la BDD et des invariants d'idempotence, pas du sandbox.

### Garde-fou 2
Le contrat d'execution doit etre commun a tous les usages:
- execution depuis l'editeur,
- execution depuis la carte du workflow,
- fonctions natives,
- fonctions utilisateur.

### Garde-fou 3
Une fonction native ne peut pas etre exposee comme utilisable tant que:
- ses dependances ne sont pas installees,
- ses imports ne sont pas verifies,
- son runtime n'est pas valide.

### Garde-fou 4
Les resolutions de configuration doivent etre scopees par identite forte:
- utilisateur,
- agent,
- instance d'agent,
- execution.

### Garde-fou 5
Le schema de donnees doit privilegier la robustesse et l'idempotence avant la commodite d'implementation.

### Garde-fou 6
Les tests d'installation et de sante doivent faire partie du produit, pas seulement du setup developpeur.

---

## 6. Orientation retenue pour la suite

La suite du travail doit se faire en deux temps distincts:

### Phase A — Nouveau plan structurel
Etablir un nouveau plan d'implementation de:
- l'architecture applicative,
- la BDD,
- la partie sandbox,
- les garanties d'idempotence,
- l'installation et la validation runtime.

### Phase B — Nouveau plan fonctions natives
Une fois la structure robuste validee, etablir un second plan dedie a:
- la reconstruction des fonctions natives,
- leur contrat technique,
- leur protocole d'erreur,
- leurs dependances,
- leurs tests et leur observabilite.

---

## 7. Utilisation de ce document

Ce document doit rester vivant jusqu'a la stabilisation complete de la nouvelle architecture Tools.

Il doit etre relu avant:
- la redaction du prochain plan,
- toute proposition de schema BDD,
- toute proposition de sandboxing,
- toute reimplementation des fonctions natives.

Objectif: ne plus reconstruire une architecture invalidee sous un autre nom.