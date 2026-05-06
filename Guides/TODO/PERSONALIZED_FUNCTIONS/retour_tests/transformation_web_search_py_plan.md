A - Paramétrage des recherches web

1- Afficher un bouton bleu discret dans le footer du block de l'agent, sous le bloc de prompt de l'utilisateur, lorsque la fonction native 'web_search_py' est activée sur cet agent. Il est bleu car le bleu est la couleur du robot Phil qui gère les fonctions dans l'application. Le picto à utiliser est un symbole de globe terrestre. Attention, il faut bien sûr faire apparaitre ce bouton dans la version fullscreen du bloc de l'agent (quand l'utilisateur clique dans le header sur le bouton 'Ouvrir en plein écran').
2- Lorsque l'utilisateur clique sur ce bouton, il accède à un formulaire de paramètres du LLM dans une modale bleue laser ayant dans son header pour nom "Paramètres Web Search de l'agent" + le nom de l'agent. Le formulaire est assez long mais la fenêtre doit avoir la même taille qu'un bloc d'agent sur la map, donc si le formulaire dépasse il lui faut des scrollers horizontal et vertical.
Paramètres de configuration (JSON-ready) :

nb_request_transformation (int) : Définit le nombre de sous-requêtes générées.

request_list (bool) : Conditionnel (si nb_request_transformation > 1). Oblige le prompt query_transformation à retourner un format itérable (JSON array ou string-split).

web_engine_search (bool) : Activation du moteur. Si "false", la fonction web_search_py retourne une erreur ou utilise un fallback.

web_engine (enum) : Conditionnel (si web_engine_search = true). Choix unique (duckduckgo.com par défaut, etc.).

web_engine_nb_result_select (int) : Conditionnel (si web_engine_search = true). Définit le "Top N" de l'index de recherche (ex: 3).

dig_snippet (bool) : Conditionnel (si web_engine_search = true). Si true, active le scrapping asynchrone des URLs pour analyse profonde au lieu de se limiter aux métadonnées du moteur.

max_uses (int) : Variable de contrôle finale. Limite le nombre total de fragments d'informations (snippets ou contenus complets) passés au LLM final pour éviter l'explosion de la fenêtre de contexte.

cross_lingual_search (bool) : Si true, le processeur doit générer une version anglaise de la requête et traduire les résultats entrants en langue native utilisateur avant la synthèse.

allowed_domains (list) : Liste dynamique d'URLs. Ces domaines doivent être injectés dynamiquement dans le prompt query_transformation sous forme d'opérateurs de recherche (ex: site:domain.com).

query_transformation (textarea) : Le prompt d'abstraction (ton texte actuel est parfait).

----

Résultat QA : 
Plan (actions réalisées / next steps)

Revue de code de l'étape 1 — complétée.
Vérification des try/catch/logs — en cours.
Préparer un mock sandbox pour accélérer QA — proposition + option de mise en œuvre (prête si vous validez).
Résultats de la revue (concis)

Compatibilité on‑premise vs cloud

Support on‑premise: la transformation cachée appelle l'endpoint local via private_context.web_search.llm_runtime.completion_api_url — implémentation visible dans web_search_llm_client.py (utilise cet URL et renvoie une erreur claire si absent).
Support cloud: le service backend completeWebSearchHiddenLlm supporte runtimes cloud (OpenAI-compatible, Gemini, Anthropic) via webSearchHiddenLlm.service.ts.
Conclusion: l'architecture supporte les deux cas. Attention aux collisions si on active simultanément:
la fonctionnalité de "recherche web native" du fournisseur cloud (ex. Anthropic/Gemini web-search tool) ET
notre pipeline web_search_py.
Recommandation: imposer une politique claire (UI ou règle d'exécution) — soit
exclure l'un quand l'autre est actif, ou
afficher une alerte et demander choix explicite (préférence recommandée), ou
ajouter une priorité (ex: provider_native_search wins) configurable par agent.
Emplacement pour l'enforcement: détecter dans la résolution des params / lors du dispatch (ex. resolve_runtime_params + orchestration) et loguer/refuser la combinaison.
Robustesse / gestion d'erreurs (try/catch + logging)

web_search_query_transformation.transform_query est entourée d'un try/except qui fait logger.warning(...) et renvoie un fallback contrôlé (mode "fallback"). (voir web_search_query_transformation.py:1)
Le client hidden-LLM (complete_text) lève des ValueError sur timeout, JSON invalide, etc., et émet maintenant des événements diagnostics sur stderr (donc ne pollue plus stdout du wrapper). (voir web_search_llm_client.py:1)
Le service backend webSearchHiddenLlm.service.ts gère tentatives/fallbacks (retries, Ollama fallback, reasoning-length retry conditionnel via allowReasoningRetry) et logue tentatives/erreurs. (voir webSearchHiddenLlm.service.ts:1)
Le wrapper natif sandbox capture désormais le stdout interne (via contextlib.redirect_stdout) et retourne une enveloppe JSON propre — cela évite sandbox_invalid_output causés par prints parasites (voir runtimeWrappers.ts:1).
Recommandations mineures :
Ajouter un champ de corrélation dans les logs (executionId / sessionId) sur les logs web_search transform_query start/success/fail pour faciliter le tracing (le transform log contient déjà timeout/lengths).
Centraliser métriques d'erreur (Sentry/Prom) pour compter QUERY_TRANSFORMATION_FAILED, hidden_llm_timeout, invalid_json_response.
S'assurer que allowReasoningRetry est bien propagé pour tous les paths (le backend et client le supportent).
Timeout / paramétrage

Découplage réalisé: le timeout de la transformation cachée utilise désormais hidden_llm_timeout_seconds (default 45s) au lieu du fetch_timeout_seconds. (voir web_search_runtime_params.py:1 et web_search_query_transformation.py:1)
Suggestion: garder une valeur par défaut conservatrice (45s) pour on‑prem, et permettre override par webSearchParams pour agents lourds.
Possibilité de mock pour accélérer QA (propositions)

Choix de stratégie  — Mock HTTP endpoint (non invasif, recommandé rapide):
Créer un petit HTTP server local (comme les tests actuels le font) écoutant /api/web-search/hidden-llm/complete et renvoyant immédiatement un JSON contenant un texte pré‑fabriqué (ex: transformed query). Dans vos tests / QA, pointez private_context.web_search.llm_runtime.completion_api_url vers ce serveur. Cette approche n'altère pas le code de production.
Exemple de motif déjà utilisé dans tests: démarrer un server Python/Node dans le test et définir completion_api_url sur http://127.0.0.1:<port>/api/web-search/hidden-llm/complete.


Lancer le mock server (exemple Node/petit script ou reuse du test harness). Puis lancer le test ciblé :
(les tests existants contiennent déjà des snippets pour démarrer un server local; réutilisable.)

Décision proposée pour éviter collisions LLM cloud-native vs pipeline

Implémenter une règle simple au dispatch:
Si l'agent sélectionne un provider offrant une "native web-search" capability AND webSearchParams.web_engine_search est true, afficher un warning et exiger une attestation (UI) ou choisir explicitement l'un des deux.
Implémentation minimale: refuser la combinaison côté validation prototype/instance (dans parseWebSearchParams ou agent-instances route) et renvoyer un message explicite aux utilisateurs.
Etat des todo

1 — Revue code (hidden transform) : complété.
2 — Vérifier/couvrir logs & try/catch : en cours — j'ai identifié les points forts et les recommandations ci‑dessus. Si vous me l'assignez, j'ajoute corrélationId aux logs et instrumente un compteur d'erreurs.
3 — Préparer mock pour QA 

B - Pipeline de Transformation (Logique d'exécution)
Initialisation du Contexte : L'application détecte la langue utilisateur et préparer le system_context (Heure, Date, Location, Spécialisation). Si le LLM est On-Premise et aveugle au système, l'application force l'injection de ces données dans les variables du prompt.

Phase de "Query Transformation" : Appel au sous-agent avec le prompt défini. Si request_list est actif, le retour est parsé en liste de requêtes.

Exécution & Filtrage :

Lancer les recherches via web_engine.

Filtrer les domaines via allowed_domains.

Limiter par web_engine_nb_result_select.

Si dig_snippet est True : Exécuter le fetch des pages en parallèle.

Réduction : Tronquer ou résumer les résultats pour ne pas dépasser max_uses.

Structure de Données (Schema JSON pour la BDD et l'Agent Codeur)
Voici comment l'agent codeur doit structurer l'objet pour l'enregistrement en base de données, en respectant scrupuleusement tes noms de variables :

JSON
{
  "web_search_params": {
    "nb_request_transformation": 1,
    "request_list": false,
    "max_uses": 5,
    "cross_lingual_search": false,
    "web_engine_search": true,
    "web_engine": "duckduckgo.com",
    "web_engine_nb_result_select": 3,
    "dig_snippet": false,
    "allowed_domains": [],
    "query_transformation": "--- TON PROMPT D'ABSTRACTION ---"
  }
}

C - Évaluation et Sélection (Reranking Agentique)L'objectif est d'injecter une étape de jugement entre la récupération brute (Phase B) et la réponse finale. Cette étape est "invisible" et doit être ultra-rapide.1. Paramètres de sélection (Extension du Formulaire A)Il faut ajouter trois variables de contrôle dans la modale de paramètres :relevance_threshold (int/slider) : Un score de 1 à 10. Si un résultat est jugé en dessous de ce score par le Reranker, il est jeté. (Par défaut : 7).rerank_strategy (enum) : Choix entre "Fast" (Analyse des snippets uniquement) ou "Deep" (Analyse du contenu dig_snippet).max_context_tokens (int) : Limite de sécurité pour ne pas saturer le LLM final avec trop de texte.
2. Le Prompt "Invisible" : The Information Juror
Ce prompt doit être injecté en tant que "système" pour l'appel de sélection. Il ne voit pas l'utilisateur, il ne voit que des données.

# ROLE
Tu es le "Information Juror", un expert en analyse de pertinence et en vérification de faits. Ta mission est de classer des sources web en fonction de leur utilité réelle pour répondre à une intention spécifique.

# PARAMÈTRES D'ENTRÉE
- INTENTION_INITIALE : {{user_query}}
- SOURCE_WEB : {{source_content}} (URL + Snippet ou Full Text)

# CRITÈRES D'ÉVALUATION (Score sur 10)
1. ADÉQUATION : La source contient-elle une réponse directe ou des données pivots pour l'intention ?
2. FRAÎCHEUR : La date de la source est-elle cohérente avec la temporalité de la demande ?
3. DENSITÉ : Ratio informations utiles / bruit publicitaire ou remplissage.

# FORMAT DE SORTIE (STRICT JSON)
{
  "relevance_score": [0-10],
  "reasoning": "Explication en 10 mots max",
  "critical_fragment": "Le passage exact contenant l'info clé"
}

3. Logique d'implémentation pour l'Agent Codeur
L'agent codeur doit structurer la fonction web_search_py pour qu'elle suive cette itération de "Nettoyage" :Étape C.1 : Le "Scoring" en parallèleUne fois les résultats obtenus de DDGS, l'application ne les envoie pas au LLM final. Elle lance $N$ micro-appels (où $N$ est le nombre de résultats) vers le modèle de Reranking.Note technique : Pour optimiser les coûts et la latence, on utilisera souvent un modèle plus petit et plus rapide (ex: Gemini Flash ou GPT-4o-mini) pour cette étape de jugement.Étape C.2 : Le Tri et l'ÉlagageFiltrage : Supprimer tout résultat dont relevance_score < relevance_threshold.Tri : Classer les résultats restants par score décroissant.Extraction : Si dig_snippet était actif, on n'envoie pas toute la page web au LLM final, mais seulement le critical_fragment identifié par le Juror. Cela permet d'économiser 80% des tokens de contexte.4. Synthèse finale pour le "Main Agent"Une fois le tri effectué, l'agent codeur doit formater la donnée finale que le LLM principal recevra. Ce bloc doit être parfaitement structuré pour éviter toute confusion :Markdown### SOURCES WEB VÉRIFIÉES
[Source 1] (Score: 9/10) - URL: ...
Contenu : {{critical_fragment_1}}

[Source 2] (Score: 8/10) - URL: ...
Contenu : {{critical_fragment_2}}

---
INSTRUCTION : Utilise exclusivement les sources ci-dessus pour répondre à : {{user_query}}. Si l'info manque, dis-le.

4. Intégration dans le Bloc Tool "Extensible"
L'agent codeur doit implémenter un système de streaming d'états (via Server-Sent Events ou WebSockets) pour alimenter le bloc de l'agent en temps réel. Chaque étape de la Phase C doit y être consignée :

Input du Reranker : Afficher la liste brute des URLs trouvées.

Process : Afficher les scores de pertinence en temps réel (ex: URL_A: 8.5/10 - Validée).

Output : Afficher les fragments de texte sélectionnés qui seront envoyés au LLM final.

5. Citations et Références (Final Output)
Le LLM final ne doit pas seulement utiliser les infos, il doit les ancrer.

Instruction de prompt : "Pour chaque fait cité, ajoute une référence numérique entre crochets [1], [2] pointant vers la liste des sources en fin de réponse."

Formatage : Une section ### Sources utilisées doit être générée automatiquement en bas de la réponse avec le titre de la page et l'URL cliquable.

---
Amendements suite au test réel `test-wsp.log`

Observations clés issues du log :
- La requête principale vers le runtime local (LMStudio) peut prendre longtemps (ex : > 24s observés) ; la transformation cachée a utilisé `hidden_llm_timeout_seconds=45` et a tout de même expiré.
- Le proxy LMStudio et le runner sandbox ont des timeouts et des durées distinctes : il faut s'assurer qu'ils sont alignés ou que le pipeline tolère les écarts.
- Le log montre une tentative unique qui retourne un `QUERY_TRANSFORMATION_FAILED` avec indication "Timeout hidden LLM après 45s".

Impacts sur le plan et actions requises (modifications SOLID):
1) Timeout adaptatif pour la transformation cachée
  - Implémenter une logique adaptative : si `userPromptLength` > 1000 chars ou si `runtime` indique un modèle volumineux (ex: > 4B params), augmenter `hidden_llm_timeout_seconds` automatiquement (ex: 60–90s) ou basculer en mode streaming asynchrone.
  - Conserver un plafond raisonnable (`MAX_TRANSFORM_TIMEOUT_SECONDS`) mais l'élever pour on‑prem aux valeurs 90s par défaut si test infra lent.
  - Exposer `hidden_llm_timeout_seconds` dans `webSearchParams` pour tests d'instance.

2) Surface correctement l'échec de transformation au niveau sandbox
  - Vérifier que toute erreur `QUERY_TRANSFORMATION_FAILED` devient un `failureKind` explicite renvoyé par la sandbox (ne pas masquer derrière `success: true` et `exitCode:0`).
  - Ajouter un test automatisé (route-level) qui force le hidden LLM à renvoyer une erreur et vérifie que `/api/sandbox/run` retourne `success:false` ou `metadata.failureKind==='sandbox_invalid_output'/'query_transformation_failed'` selon le contrat attendu.

3) Retry et single-attempt policy
  - Pour éviter duplications, conserver `allowReasoningRetry=false` par défaut pour la transformation, mais permettre un override contrôlé (et mesurable) en cas de modèles très lents/longs.

4) Mock HTTP (Option A) — précisions d'implémentation
  - Fournir un petit serveur test (Node or Python) servant `POST /api/web-search/hidden-llm/complete` qui renvoie rapidement : `{ "text": "<transformed query>" }` et code 200.
  - Prévoir un script `backend/scripts/run-hidden-llm-mock.js` ou réutiliser le snippet de test existant. Le mock doit pouvoir retourner différents scénarios : succès rapide, délai (simulate slow), ou erreur 500.
  - Mettre à jour la documentation de QA pour indiquer comment pointer `private_context.web_search.llm_runtime.completion_api_url` vers le mock et comment démarrer/stopper le mock.

5) Tracing & corrélation
  - Ajouter `executionId` / `sessionId` dans les logs `web_search transform_query start/success/fail` et dans les événements émis par `web_search_llm_client` afin de relier la requête LLM aux traces sandbox et au trace log du proxy.

6) Tests à ajouter avant étape 2 (error handling)
  - Test d'intégration: mock success -> vérifier `transformed_query_raw` arrive dans `engine_query_plans` et que sandbox exécute ensuite les plans.
  - Test d'erreur: mock timeout/error -> vérifier propagation correcte du `failureKind` et que l'AgentLoop bloque toute relance automatique.

Ces amendements sont limités, testables et inversibles — ils gardent la base existante tout en corrigeant la robustesse observée dans `test-wsp.log`.

D - Résilience, Fallback et Streaming (The Safety Net)En architecture logicielle, la question n'est pas "Si ça va rater", mais "Quand ça va rater". Voici la stratégie de Dégradation Gracieuse.1. Visualisation de la progression (Non-blocking UI)Pour éviter que l'utilisateur ne pense que l'agent est "planté" pendant le scraping/reranking :Streaming de statut : L'agent codeur doit envoyer des messages de statut à l'interface : recherche_en_cours -> analyse_pertinence -> lecture_approfondie.Curation progressive : Si dig_snippet est long, l'agent peut commencer à rédiger sa réponse avec les premiers résultats validés pendant que les autres sont encore en cours de traitement.2. Matrice de Gestion des Erreurs (Fallback)Scénario d'échecAction de repli (Fallback)Notification Utilisateur (Tool Block)0 résultat moteurRephrase & Replay : Le sous-agent génère une requête plus large."Aucun résultat précis. Élargissement de la recherche..."Timeout ScrapingUtiliser uniquement les Snippets (métadonnées moteur)."Accès au site impossible. Analyse des extraits disponible."Reranker ErrorUtiliser le Top 1 par défaut (sans filtrage de score)."Erreur de jugement. Utilisation de la source principale."Quota API atteintBasculer sur un moteur secondaire (ex: passer de Google à Qwant)."Moteur principal saturé. Utilisation du moteur de secours."3. Le système de "Replay Optimisé"Si une recherche échoue, on ne relance pas tout le pipeline. On utilise un State Management :Cache de session : Les résultats de la Phase B (requêtes brutes) sont gardés en mémoire.Mutation de requête : L'agent codeur demande au sous-agent de "simplifier les mots-clés" (Omission de la dimension temporelle ou technique) pour obtenir au moins quelque chose.Instructions pour l'Agent Codeur (Spécifications Techniques)A. Gestion des erreurs asynchronesPythonasync def web_search_py(params):
    try:
        # Phase B & C avec timeout strict par étape
        results = await asyncio.wait_for(execute_pipeline(params), timeout=15.0)
    except asyncio.TimeoutError:
        # Fallback immédiat sur les snippets déjà récupérés
        return fallback_to_snippets()
    except Exception as e:
        # Log dans le bloc Tool "Phil" pour transparence
        log_to_tool_block(f"Erreur détectée: {str(e)}. Activation du mode secours.")
        return run_recovery_strategy()
B. Structure de la réponse finale (Template)L'agent codeur doit forcer ce format pour le LLM final :Plaintext[Réponse de l'agent avec appels de notes [1]...]

---
**Sources explorées par Phil (Globe) :**
1. [Titre de la page](URL) - Pertinence : 95%
2. [Titre de la page](URL) - Pertinence : 82%
Conclusion de l'ArchitecteAvec cette Phase D, ton outil passe d'un script fragile à un système de niveau industriel. L'utilisateur se sent en confiance car il voit l'effort de recherche (le streaming dans le bloc tool), et même en cas de problème technique sur le web, il obtient une réponse dégradée mais utile plutôt qu'un message d'erreur sec.
