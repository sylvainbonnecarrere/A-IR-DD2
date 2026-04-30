# TODOLIST TECHNIQUE DETAILLEE - TRANSFORMATION INDUSTRIELLE DE WEB_SEARCH_PY

## 1. Objet de la reprise corrective

1. Ce document redefinit uniquement la partie amont de `web_search_py`, c'est-a-dire tout ce qui se passe avant le reranking agentique.
2. Le formulaire de configuration des agents est considere comme valide dans son principe fonctionnel. Le chantier ne doit pas repartir de l'UI, mais de l'exploitation correcte de ses donnees.
3. La section `## 15. Introduire le reranking agentique comme etage separe` et toutes les sections suivantes restent la base de travail pour l'aval du pipeline et doivent etre conservees.
4. La presente reprise remplace donc integralement les sections 1 a 14 initiales, car elles ont embarque des hypotheses incorrectes sur la transformation de requete, le moteur de recherche et l'usage de DDGS.

## 2. Probleme reel a corriger avant tout reranking

1. Le processus attendu s'arrete d'abord a une sequence simple et deterministe:
   - lecture de la configuration agent validee
   - construction de `system_context`
   - appel cache au LLM de transformation avec `{{system_context}}` et `{{user_query}}`
   - recuperation de la reponse du sous-agent telle quelle
   - construction d'une ou plusieurs requetes moteur explicites
   - execution de ces requetes en sandbox avec le moteur configure
2. La version actuellement codee a derive vers un pipeline generique qui reinterprète la sortie de transformation, multiplie les strategies implicites et melange deja des etapes qui appartiennent au reranking ou a l'assemblage final.
3. Tant que cet amont n'est pas reconstruit proprement, toute reprise a partir de la section 15 reposera sur une base contaminee.

## 3. Invariants a conserver

1. Le lancement de `web_search_py` depuis un agent de la map fonctionne deja et doit rester operationnel.
2. La sandbox, la policy reseau, le timeout dedie du tool, le bloc Tool UI et le chemin AgentLoop/local LLM ne doivent pas etre casses.
3. Le formulaire de configuration de l'agent doit rester la source de verite fonctionnelle pour:
   - `web_engine_search`
   - `web_engine`
   - `web_engine_nb_result_select`
   - `allowed_domains`
   - `dig_snippet`
   - `max_uses`
   - `query_transformation`
   - `reranking_prompt`
   - `relevance_threshold`
   - `rerank_strategy`
   - `max_context_tokens`
4. Le champ `nb_request_transformation` et la logique `request_list` ne doivent plus piloter le comportement utilisateur. L'amont doit repartir d'une logique mono-transformation, avec fan-out uniquement par domaine autorise si `allowed_domains` est renseigne.

## 4. Contrat fonctionnel impose pour la phase pre-reranking

1. `user_query` doit etre injecte tel quel dans le prompt de transformation.
2. `system_context` doit etre injecte comme un tableau borne d'indices utiles, avec langue obligatoire et maximum 20 elements.
3. La reponse du LLM de transformation doit etre recuperee telle quelle comme `transformed_query_raw`.
4. Le code ne doit pas reparser cette reponse en contrat JSON metier interne pour piloter la recherche de base.
5. La requete moteur doit etre construite a partir de `transformed_query_raw` ou de `site:<domaine> + transformed_query_raw` si des domaines sont imposes.
6. Si plusieurs domaines sont configures, il faut produire une requete web par domaine. Ce fan-out par domaine est le seul multi-lancement autorise dans cette phase.
7. Le moteur configure par l'utilisateur doit etre le moteur reellement execute. Il ne doit jamais etre remplace implicitement par un autre moteur ou par une abstraction technique opaque sans trace explicite.

## 5. Fichiers obsoletes a supprimer, geler ou remplacer

1. Les fichiers suivants issus de la tentative echouee ne doivent plus structurer la phase pre-reranking dans leur forme actuelle:
   - `backend/python/native/web_search_query_transformation.py`
   - `backend/python/native/web_search_system_context.py`
   - `backend/python/native/web_search_runtime_params.py`
   - `backend/python/native/web_search_py.py`
   - `backend/python/native/web_search_py_old.py` si son contenu est devenu la mauvaise base de reconstruction plutot qu'une baseline minimale exploitable
2. Les fichiers suivants doivent etre explicitement sortis du flux pre-reranking tant que la base n'est pas assainie:
   - `backend/python/native/web_search_result_filter.py`
   - `backend/python/native/web_search_page_fetch.py`
   - `backend/python/native/web_search_context_pack.py`
   - `backend/python/native/web_search_reranking.py`
3. Les fichiers ci-dessus ne doivent pas forcer leur logique dans `web_search_py` avant la reprise a partir de la section 15.
4. Le fichier `backend/python/native/web_search_llm_client.py` peut etre conserve seulement s'il est simplifie pour servir deux usages explicites:
   - l'appel cache de `query_transformation`
   - plus tard, le reranking de la section 15
5. Si un fichier obsolet est conserve temporairement pour migration, il doit etre clairement marque comme archive, baseline ou hors-perimetre pre-reranking, et ne plus etre importe par le flux principal.

## 6. Todo 1 - Geler une baseline minimale saine

Actions obligatoires:

1. Identifier la derniere version qui sait au moins:
   - recevoir les parametres agent
   - lancer un appel sandbox
   - executer une recherche web simple
2. Isoler cette version comme baseline de secours clairement nommee.
3. Interdire qu'une baseline contenant deja les erreurs de conception actuelles serve de reference fonctionnelle au nouveau chantier.
4. Geler des tests minimaux de non-regression sur:
   - lancement depuis un agent de la map
   - passage des `web_search_params`
   - execution reseau en sandbox

Critere de sortie:

1. Le point de depart minimal est stable, identifiable et non ambigu.

## 7. Todo 2 - Refaire le contrat canonique de configuration sans casser le formulaire

Actions obligatoires:

1. Aligner le schema backend et le code Python sur le formulaire valide deja en place.
2. Retirer de la logique active les champs devenus inutiles dans la phase pre-reranking:
   - `nb_request_transformation`
   - `request_list`
3. Conserver `allowed_domains` comme mecanisme fonctionnel de duplication de requete par domaine, sans le confondre avec un systeme de sous-requetes generees par LLM.
4. Toute configuration invalide doit produire une erreur metier claire `INVALID_WEB_SEARCH_PARAMS`.

Critere de sortie:

1. Le pipeline pre-reranking charge exactement les donnees du formulaire valide, sans logique fantome.

## 8. Todo 3 - Construire un `SystemContextBuilder` conforme au contrat fonctionnel

Actions obligatoires:

1. Remplacer l'objet riche actuel par un tableau borne d'indices utiles.
2. Ce tableau doit contenir au minimum:
   - la langue utilisateur
   - la date courante si elle est utile a la resolution de la requete
   - la date cible resolue pour les expressions relatives comme `demain`
   - la localisation detectee si elle existe
   - la specialisation ou contexte metier si pertinent
3. Le builder doit rester purement amont et ne pas connaitre le moteur ni le reranking.
4. La forme du tableau doit etre stable, testable et directement injectee dans `{{system_context}}`.

Critere de sortie:

1. `system_context` devient simple, borne et conforme au document d'echec.

## 9. Todo 4 - Refaire `QueryTransformationService` en mode mono-transformation stricte

Actions obligatoires:

1. L'appel cache au LLM doit prendre exactement:
   - `{{system_context}}`
   - `{{user_query}}`
2. La sortie du LLM doit etre conservee comme chaine brute de transformation.
3. Le code ne doit plus imposer de JSON interne ni de liste de sous-requetes pour la phase de base.
4. Le code peut seulement:
   - normaliser les espaces
   - tronquer si une limite de securite doit etre appliquee
   - tracer la sortie brute
5. Si la transformation echoue, la politique de reprise doit etre explicite et bornee, sans heuristiques lourdes qui reinventent la requete.

Critere de sortie:

1. La sortie de transformation redevient fidele au contrat: une transformation brute, pas une structure auxiliaire inventee.

## 10. Todo 5 - Introduire un `EngineQueryPlanBuilder` explicite

Actions obligatoires:

1. Creer un objet metier unique de plan moteur, par exemple:
   - `engine`
   - `transformed_query_raw`
   - `domain`
   - `engine_query_text`
   - `engine_query_url`
2. Si aucun domaine n'est configure, produire un unique plan moteur a partir de `transformed_query_raw`.
3. Si un ou plusieurs domaines sont configures, produire un plan moteur par domaine avec `site:<domaine> + transformed_query_raw`.
4. Tracer explicitement l'URL moteur generee avant execution.

Critere de sortie:

1. La construction de la requete web est visible, deterministe et verifiable avant toute recherche reelle.

## 11. Todo 6 - Introduire des adaptateurs de moteur metier explicites

Actions obligatoires:

1. Creer un adaptateur par moteur configure dans le formulaire:
   - `DuckDuckGoSearchAdapter`
   - `GoogleSearchAdapter`
   - `BingSearchAdapter`
   - `BaiduSearchAdapter`
   - `QwantSearchAdapter`
2. Chaque adaptateur doit savoir:
   - construire `engine_query_url`
   - construire les parametres d'execution reseau correspondants
   - identifier clairement le moteur reellement utilise
3. Interdire tout rabattement implicite d'un moteur utilisateur vers un backend technique DuckDuckGo.
4. Si un moteur n'est pas encore supporte techniquement, retourner une erreur metier borne `SEARCH_ENGINE_UNAVAILABLE` au lieu de simuler un autre moteur.

Critere de sortie:

1. `web_engine` redevient un choix metier reel et non un simple libelle d'interface.

## 12. Todo 7 - Refaire l'execution de la recherche en sandbox

Actions obligatoires:

1. L'execution doit prendre un `EngineQueryPlan` et lancer la recherche correspondante dans la sandbox.
2. Pour `duckduckgo.com`, l'execution via DDGS ne doit etre acceptee que si elle respecte le moteur choisi et si la trace expose clairement le `query_engine` attendu.
3. Pour tous les moteurs, la trace doit contenir:
   - `user_query`
   - `system_context`
   - `transformed_query_raw`
   - `engine_query_text`
   - `engine_query_url`
   - `engine`
4. Si plusieurs domaines sont configures, la trace doit contenir un bloc d'execution par domaine et non une pseudo-liste de sous-requetes LLM.
5. Interdire toute boucle technique sur plusieurs backends implicites pour une meme requete moteur.

Critere de sortie:

1. Une recherche web correspond a un plan moteur explicite et a une execution unique par plan.

## 13. Todo 8 - Refaire le contrat de sortie pre-reranking

Actions obligatoires:

1. Avant la section 15, le retour outil doit exposer distinctement:
   - `query`
   - `system_context`
   - `transformed_query_raw`
   - `engine_query_plans`
   - `engine_execution_trace`
   - `results_raw`
2. `normalized_query`, `must_include_terms`, `exclude_terms`, `english_queries` et toute structure equivalente ne doivent plus etre la source de verite pour l'execution moteur de base.
3. Les champs additifs deja utiles peuvent etre conserves seulement s'ils ne deforment pas le flux fonctionnel attendu.

Critere de sortie:

1. Le QA peut auditer la phase pre-reranking sans interpreter de logique cachee.

## 14. Todo 9 - Ajouter les tests de reprise obligatoires avant la section 15

Tests obligatoires minimum:

1. la reponse brute du LLM de transformation est reutilisee telle quelle dans la requete moteur
2. `system_context` est un tableau borne avec langue obligatoire
3. `duckduckgo.com` produit un `engine_query_url` DuckDuckGo explicite
4. `google.com` produit un `engine_query_url` Google explicite
5. `bing.com` produit un `engine_query_url` Bing explicite
6. `allowed_domains` avec deux domaines produit exactement deux plans moteur distincts
7. aucun backend technique implicite supplementaire n'est appelle pour une meme requete moteur
8. si un moteur non supporte est demande, le pipeline retourne une erreur metier claire au lieu de rabattre vers DuckDuckGo
9. le formulaire valide deja en place n'est pas casse par la reprise backend/python

Critere de sortie:

1. La base pre-reranking est prouvee correcte avant de repartir sur la section 15.

## 15.  Introduire le reranking agentique comme etage separe

References:

1. `Reference C` en entier

Actions obligatoires:

1. Creer un service de reranking dedie utilisant le prompt `Information Juror` comme reference fonctionnelle.
2. Produire strictement:
   - `relevance_score`
   - `reasoning`
   - `critical_fragment`
3. Supporter `rerank_strategy`:
   - `Fast` = evaluation sur snippets
   - `Deep` = evaluation sur contenu fetch si disponible
4. Appliquer `relevance_threshold` avant construction du contexte final.
5. Classer les sources restantes par score decroissant.
6. Si `dig_snippet = true`, ne jamais transmettre toute la page brute au LLM final si seul `critical_fragment` est necessaire.

Critere de sortie:

1. Le reranking devient autonome, testable et remplacable.

## 16. Todo 11 - Construire le paquet final pour le LLM principal

References:

1. `Reference C.4`
2. `Reference C.5`
3. `Reference D`

Actions obligatoires:

1. Construire un `llm_context_block` strictement structure.
2. Ce bloc doit contenir uniquement les fragments verifies retenus.
3. Inclure:
   - liste des sources retenues
   - score de pertinence
   - URL
   - `critical_fragment`
   - instruction explicite de se limiter a ces sources
4. Le LLM principal doit etre incite a citer les faits avec des references numeriques.
5. Une section finale `Sources utilisées` doit pouvoir etre generee sans ambiguite.

Critere de sortie:

1. Le LLM principal ne synthétise plus a partir de snippets bruts ou de sources hors filtre.

## 17. Todo 12 - Refondre le contrat de sortie outil de facon additive

References:

1. `Reference B`
2. `Reference C`
3. `Reference D`

Actions obligatoires:

1. Conserver pour compatibilite:
   - `results`
   - `query`
   - `normalized_query`
   - `trace`
2. Ajouter de facon additive:
   - `search_plan`
   - `consulted_sources`
   - `selected_sources`
   - `verified_fragments`
   - `llm_context_block`
   - metadonnees de fallback
3. Fixer la semantique stricte des champs:
   - `consulted_sources` = sources vues par moteur ou fetch
   - `selected_sources` = sources retenues apres filtrage/reranking
   - `verified_fragments` = extraits effectivement transmis au LLM principal
4. Ne pas casser les consommateurs existants du contrat minimal.

Critere de sortie:

1. Le contrat s'enrichit sans regression UI ni runtime.

## 18. Todo 13 - Rendre le Tool Block extensible et intelligible

References:

1. `Reference C.4`
2. `Reference D.1`

Actions obligatoires:

1. Transformer le Tool Block en journal d'etat comprehensible.
2. Exposer au minimum:
   - `query_transformation`
   - `search_execution`
   - `domain_filtering`
   - `dig_snippet`
   - `reranking`
   - `final_context_ready`
   - `fallback_mode`
3. Chaque etat doit pouvoir etre expansible et afficher:
   - entree utile
   - statut
   - details techniques
   - resultat partiel ou fallback
4. Ne pas melanger la reponse finale agent avec les details d'execution tool.
5. Conserver la separation `tool` / `tool_result` deja validee par QA.
6. Structurer le Tool Block en hierarchie obligatoire a trois niveaux:
   - niveau 1 = bloc tool principal `web_search_py`
   - niveau 2 = sous-blocs par grande categorie de pipeline
   - niveau 3 = sous-blocs par sous-requete ou par source si la categorie le justifie
7. Les categories de niveau 2 doivent etre standardisees et non laissees a l'interpretation du codeur. Le minimum impose est:
   - `configuration_resolved`
   - `query_transformation`
   - `search_execution`
   - `domain_filtering`
   - `snippet_or_page_fetch`
   - `reranking`
   - `context_assembly`
   - `fallback_or_error`
8. Si `nb_request_transformation > 1`, le bloc `query_transformation` doit contenir un sous-bloc par sous-requete generee avec identifiant stable du type `subquery_1`, `subquery_2`, etc.
9. Chaque sous-bloc de sous-requete doit exposer au minimum:
   - l'input source ayant produit la sous-requete
   - la strategie appliquee
   - la requete normalisee finale
   - le moteur cible
   - le statut d'execution
   - les erreurs eventuelles
10. Le bloc `search_execution` doit pouvoir se subdiviser par sous-requete et afficher pour chacune:
   - la requete envoyee au moteur
   - le moteur effectivement utilise
   - les parametres actifs issus de la configuration
   - le nombre de resultats bruts
   - le nombre de resultats retenus apres top N
   - le temps d'execution ou l'etat `timeout`
11. Le bloc `domain_filtering` doit afficher explicitement:
   - les domaines autorises actifs
   - les resultats rejetes
   - le motif de rejet
   - les resultats conserves
12. Le bloc `snippet_or_page_fetch` doit se subdiviser par URL retenue quand `dig_snippet = true` et afficher pour chaque URL:
   - l'URL cible
   - le mode choisi: snippet-only ou deep-fetch
   - le statut du fetch
   - la taille ou le resume du contenu extrait
   - le fallback applique si le fetch echoue
13. Le bloc `reranking` doit afficher pour chaque source candidate:
   - l'input evalue
   - la strategie `Fast` ou `Deep`
   - le score attribue
   - la decision `kept` ou `dropped`
   - le `critical_fragment` si retenu
   - le motif court si rejete
14. Le bloc `context_assembly` doit afficher ce qui est effectivement transmis au LLM principal:
   - la liste ordonnee des sources retenues
   - le nombre de fragments envoyes
   - le budget de contexte consomme
   - l'instruction finale de synthese bornee
15. Le bloc `fallback_or_error` doit etre present des qu'une etape applique une strategie de secours, avec affichage obligatoire de:
   - l'etape en echec
   - l'erreur brute ou code d'erreur
   - la strategie de recuperation choisie
   - l'impact sur la suite du pipeline
   - le resultat degrade obtenu ou l'arret borne
16. Les sous-blocs doivent etre extensibles unitairement depuis l'UI sans deplier tout le bloc principal, afin que le QA puisse inspecter uniquement:
   - une sous-requete
   - une URL
   - une erreur
   - une decision de reranking
17. Le contrat de projection UI doit donc distinguer au minimum pour chaque bloc ou sous-bloc:
   - `id`
   - `parentId`
   - `category`
   - `label`
   - `status`
   - `strategy`
   - `input`
   - `output`
   - `error`
   - `children`
18. Le codeur ne doit pas serialiser seulement du texte libre dans le Tool Block. Il doit produire une structure exploitable par l'UI afin de permettre affichage compact, expansion locale et evolution future sans reparser une chaine de caracteres.

Critere de sortie:

1. Le QA peut comprendre ce que Phil a fait sans lire les logs backend.
2. Le QA peut ouvrir independamment chaque sous-requete, chaque URL analysee, chaque decision de reranking et chaque fallback.
3. La presentation reste compacte par defaut mais suffisamment profonde pour auditer tout le comportement du tool.

## 19. Todo 14 - Implementer la matrice de fallback sans bricolage

References:

1. `Reference D.2`
2. `Reference D.3`

Actions obligatoires:

1. Implementer explicitement les scenarii de fallback suivants:
   - 0 resultat moteur
   - timeout scraping/fetch
   - echec reranker
   - quota moteur principal atteint
2. Chaque fallback doit etre trace et visible dans le Tool Block.
3. Chaque fallback doit etre local au stade en echec, pas une relance aveugle de tout le pipeline.
4. Si une mutation de requete est tentee, elle doit etre tracee comme sous-etape nouvelle.
5. Interdire toute boucle non bornee de replay.
6. Normaliser toutes les erreurs metier et techniques du pipeline autour d'une table canonique unique `error_code -> fallback_strategy -> user_message -> retry_policy`.
7. Interdire les messages d'erreur libres non codes comme seule source de verite pour l'UI ou l'enregistrement futur.
8. Definir un repertoire canonique minimal de codes d'erreur pour `web_search_py`, extensible mais versionne, incluant au minimum:
   - `NO_SEARCH_RESULTS`
   - `SEARCH_ENGINE_TIMEOUT`
   - `SEARCH_ENGINE_UNAVAILABLE`
   - `SEARCH_ENGINE_QUOTA_EXCEEDED`
   - `DOMAIN_FILTER_EMPTY`
   - `NO_RELEVANT_LOCAL_RESULT`
   - `FETCH_TIMEOUT`
   - `FETCH_HTTP_ERROR`
   - `FETCH_PARSE_ERROR`
   - `RERANKER_ERROR`
   - `RERANKER_TIMEOUT`
   - `PIPELINE_TIMEOUT`
   - `INVALID_WEB_SEARCH_PARAMS`
   - `QUERY_TRANSFORMATION_ERROR`
   - `QUERY_TRANSFORMATION_PARSE_ERROR`
9. Pour chaque `error_code`, definir de facon canonique:
   - `fallback_strategy`
   - `user_message`
   - `retry_policy`
   - `severity`
   - `stage`
   - `isRetryable`
   - `isBlocking`
10. La `fallback_strategy` doit etre un enum stable et non une phrase libre. Le minimum impose est:
   - `REPHRASE_AND_REPLAY`
   - `USE_SNIPPETS_ONLY`
   - `USE_PRIMARY_RESULT`
   - `SWITCH_ENGINE`
   - `SKIP_STAGE_AND_CONTINUE`
   - `FAIL_WITH_BOUNDED_ERROR`
   - `RETRY_SAME_STAGE`
11. La `retry_policy` doit etre structuree et non implicite. Le minimum impose est:
   - `mode`: `none`, `immediate_once`, `bounded_backoff`, `manual_only`
   - `maxAttempts`
   - `retryScope`: `same_stage`, `same_subquery`, `new_subquery`, `engine_switch`
   - `backoffMs`
12. Le document d'implementation doit imposer la table canonique minimale suivante:

| error_code | stage | fallback_strategy | user_message | retry_policy |
| --- | --- | --- | --- | --- |
| `NO_SEARCH_RESULTS` | `search_execution` | `REPHRASE_AND_REPLAY` | `Aucun résultat précis. Élargissement de la recherche.` | `immediate_once / new_subquery / 1 tentative` |
| `SEARCH_ENGINE_TIMEOUT` | `search_execution` | `SWITCH_ENGINE` | `Moteur trop lent. Utilisation d'un moteur de secours.` | `immediate_once / engine_switch / 1 tentative` |
| `SEARCH_ENGINE_UNAVAILABLE` | `search_execution` | `SWITCH_ENGINE` | `Moteur indisponible. Bascule vers le moteur secondaire.` | `immediate_once / engine_switch / 1 tentative` |
| `SEARCH_ENGINE_QUOTA_EXCEEDED` | `search_execution` | `SWITCH_ENGINE` | `Moteur principal saturé. Utilisation du moteur de secours.` | `immediate_once / engine_switch / 1 tentative` |
| `DOMAIN_FILTER_EMPTY` | `domain_filtering` | `FAIL_WITH_BOUNDED_ERROR` | `Aucun résultat conforme aux domaines autorisés.` | `none / same_stage / 0 tentative` |
| `NO_RELEVANT_LOCAL_RESULT` | `domain_filtering` | `FAIL_WITH_BOUNDED_ERROR` | `Aucune source localement pertinente validee.` | `none / same_stage / 0 tentative` |
| `FETCH_TIMEOUT` | `snippet_or_page_fetch` | `USE_SNIPPETS_ONLY` | `Accès au site impossible. Analyse des extraits disponible.` | `bounded_backoff / same_stage / 1 tentative` |
| `FETCH_HTTP_ERROR` | `snippet_or_page_fetch` | `USE_SNIPPETS_ONLY` | `La page cible ne peut pas être lue. Utilisation des extraits.` | `none / same_stage / 0 tentative` |
| `FETCH_PARSE_ERROR` | `snippet_or_page_fetch` | `USE_SNIPPETS_ONLY` | `Contenu web inexploitable. Bascule sur les extraits.` | `none / same_stage / 0 tentative` |
| `RERANKER_ERROR` | `reranking` | `USE_PRIMARY_RESULT` | `Erreur de jugement. Utilisation de la source principale.` | `immediate_once / same_stage / 1 tentative` |
| `RERANKER_TIMEOUT` | `reranking` | `USE_PRIMARY_RESULT` | `Analyse de pertinence incomplète. Utilisation de la meilleure source brute.` | `immediate_once / same_stage / 1 tentative` |
| `PIPELINE_TIMEOUT` | `pipeline` | `SKIP_STAGE_AND_CONTINUE` | `Temps limite atteint. Restitution des meilleurs éléments déjà validés.` | `none / same_stage / 0 tentative` |
| `INVALID_WEB_SEARCH_PARAMS` | `configuration_resolved` | `FAIL_WITH_BOUNDED_ERROR` | `Paramètres Web Search invalides.` | `manual_only / same_stage / 0 tentative` |
| `QUERY_TRANSFORMATION_ERROR` | `query_transformation` | `REPHRASE_AND_REPLAY` | `Transformation de requête en échec. Simplification de la recherche.` | `immediate_once / new_subquery / 1 tentative` |
| `QUERY_TRANSFORMATION_PARSE_ERROR` | `query_transformation` | `REPHRASE_AND_REPLAY` | `Format de sous-requête invalide. Nouvelle tentative simplifiée.` | `immediate_once / new_subquery / 1 tentative` |
13. Le codeur doit implementer cette table sous une forme serialisable et persistable, par exemple via un objet canonique ou un registre de politiques, afin de simplifier la future feature d'enregistrement des executions.
14. Pseudo-contrat TypeScript directement copiable pour l'agent codeur:

```ts
export type WebSearchStage =
   | 'configuration_resolved'
   | 'query_transformation'
   | 'search_execution'
   | 'domain_filtering'
   | 'snippet_or_page_fetch'
   | 'reranking'
   | 'context_assembly'
   | 'pipeline';

export type WebSearchSeverity = 'info' | 'warning' | 'error' | 'critical';

export type WebSearchFallbackStrategy =
   | 'REPHRASE_AND_REPLAY'
   | 'USE_SNIPPETS_ONLY'
   | 'USE_PRIMARY_RESULT'
   | 'SWITCH_ENGINE'
   | 'SKIP_STAGE_AND_CONTINUE'
   | 'FAIL_WITH_BOUNDED_ERROR'
   | 'RETRY_SAME_STAGE';

export type WebSearchRetryMode =
   | 'none'
   | 'immediate_once'
   | 'bounded_backoff'
   | 'manual_only';

export type WebSearchRetryScope =
   | 'same_stage'
   | 'same_subquery'
   | 'new_subquery'
   | 'engine_switch';

export type WebSearchErrorCode =
   | 'NO_SEARCH_RESULTS'
   | 'SEARCH_ENGINE_TIMEOUT'
   | 'SEARCH_ENGINE_UNAVAILABLE'
   | 'SEARCH_ENGINE_QUOTA_EXCEEDED'
   | 'DOMAIN_FILTER_EMPTY'
   | 'NO_RELEVANT_LOCAL_RESULT'
   | 'FETCH_TIMEOUT'
   | 'FETCH_HTTP_ERROR'
   | 'FETCH_PARSE_ERROR'
   | 'RERANKER_ERROR'
   | 'RERANKER_TIMEOUT'
   | 'PIPELINE_TIMEOUT'
   | 'INVALID_WEB_SEARCH_PARAMS'
   | 'QUERY_TRANSFORMATION_ERROR'
   | 'QUERY_TRANSFORMATION_PARSE_ERROR';

export type WebSearchScopeId =
   | 'pipeline'
   | `subquery_${number}`
   | `fetch_url_${number}`
   | `candidate_${number}`;

export type WebSearchFinalOutcome =
   | 'success'
   | 'recovered'
   | 'degraded'
   | 'failed_bounded';

export interface WebSearchRetryPolicy {
   mode: WebSearchRetryMode;
   maxAttempts: number;
   retryScope: WebSearchRetryScope;
   backoffMs: number;
}

export interface WebSearchErrorPolicy {
   errorCode: WebSearchErrorCode;
   stage: WebSearchStage;
   severity: WebSearchSeverity;
   fallbackStrategy: WebSearchFallbackStrategy;
   userMessage: string;
   retryPolicy: WebSearchRetryPolicy;
   isRetryable: boolean;
   isBlocking: boolean;
}

export interface WebSearchExecutionEvent {
   id: string;
   parentId: string | null;
   category: 'fallback_or_error';
   scopeId: WebSearchScopeId;
   stage: WebSearchStage;
   status: 'pending' | 'running' | 'error' | 'recovered' | 'degraded' | 'failed_bounded';
   attemptIndex: number;
   strategy: WebSearchFallbackStrategy | null;
   input: Record<string, unknown> | null;
   output: Record<string, unknown> | null;
   error: {
      code: WebSearchErrorCode;
      technicalMessage?: string;
      userMessage: string;
      severity: WebSearchSeverity;
      retryPolicy: WebSearchRetryPolicy;
   } | null;
   resolvedBy: string | null;
   finalOutcome: WebSearchFinalOutcome;
   children: WebSearchExecutionEvent[];
   timestamp: string;
}

export const WEB_SEARCH_ERROR_POLICIES: Record<WebSearchErrorCode, WebSearchErrorPolicy> = {
   NO_SEARCH_RESULTS: {
      errorCode: 'NO_SEARCH_RESULTS',
      stage: 'search_execution',
      severity: 'warning',
      fallbackStrategy: 'REPHRASE_AND_REPLAY',
      userMessage: 'Aucun resultat precis. Elargissement de la recherche.',
      retryPolicy: { mode: 'immediate_once', maxAttempts: 1, retryScope: 'new_subquery', backoffMs: 0 },
      isRetryable: true,
      isBlocking: false,
   },
   SEARCH_ENGINE_TIMEOUT: {
      errorCode: 'SEARCH_ENGINE_TIMEOUT',
      stage: 'search_execution',
      severity: 'warning',
      fallbackStrategy: 'SWITCH_ENGINE',
      userMessage: 'Moteur trop lent. Utilisation d\'un moteur de secours.',
      retryPolicy: { mode: 'immediate_once', maxAttempts: 1, retryScope: 'engine_switch', backoffMs: 0 },
      isRetryable: true,
      isBlocking: false,
   },
   SEARCH_ENGINE_UNAVAILABLE: {
      errorCode: 'SEARCH_ENGINE_UNAVAILABLE',
      stage: 'search_execution',
      severity: 'error',
      fallbackStrategy: 'SWITCH_ENGINE',
      userMessage: 'Moteur indisponible. Bascule vers le moteur secondaire.',
      retryPolicy: { mode: 'immediate_once', maxAttempts: 1, retryScope: 'engine_switch', backoffMs: 0 },
      isRetryable: true,
      isBlocking: false,
   },
   SEARCH_ENGINE_QUOTA_EXCEEDED: {
      errorCode: 'SEARCH_ENGINE_QUOTA_EXCEEDED',
      stage: 'search_execution',
      severity: 'warning',
      fallbackStrategy: 'SWITCH_ENGINE',
      userMessage: 'Moteur principal sature. Utilisation du moteur de secours.',
      retryPolicy: { mode: 'immediate_once', maxAttempts: 1, retryScope: 'engine_switch', backoffMs: 0 },
      isRetryable: true,
      isBlocking: false,
   },
   DOMAIN_FILTER_EMPTY: {
      errorCode: 'DOMAIN_FILTER_EMPTY',
      stage: 'domain_filtering',
      severity: 'warning',
      fallbackStrategy: 'FAIL_WITH_BOUNDED_ERROR',
      userMessage: 'Aucun resultat conforme aux domaines autorises.',
      retryPolicy: { mode: 'none', maxAttempts: 0, retryScope: 'same_stage', backoffMs: 0 },
      isRetryable: false,
      isBlocking: true,
   },
   NO_RELEVANT_LOCAL_RESULT: {
      errorCode: 'NO_RELEVANT_LOCAL_RESULT',
      stage: 'domain_filtering',
      severity: 'warning',
      fallbackStrategy: 'FAIL_WITH_BOUNDED_ERROR',
      userMessage: 'Aucune source localement pertinente validee.',
      retryPolicy: { mode: 'none', maxAttempts: 0, retryScope: 'same_stage', backoffMs: 0 },
      isRetryable: false,
      isBlocking: true,
   },
   FETCH_TIMEOUT: {
      errorCode: 'FETCH_TIMEOUT',
      stage: 'snippet_or_page_fetch',
      severity: 'warning',
      fallbackStrategy: 'USE_SNIPPETS_ONLY',
      userMessage: 'Acces au site impossible. Analyse des extraits disponible.',
      retryPolicy: { mode: 'bounded_backoff', maxAttempts: 1, retryScope: 'same_stage', backoffMs: 300 },
      isRetryable: true,
      isBlocking: false,
   },
   FETCH_HTTP_ERROR: {
      errorCode: 'FETCH_HTTP_ERROR',
      stage: 'snippet_or_page_fetch',
      severity: 'warning',
      fallbackStrategy: 'USE_SNIPPETS_ONLY',
      userMessage: 'La page cible ne peut pas etre lue. Utilisation des extraits.',
      retryPolicy: { mode: 'none', maxAttempts: 0, retryScope: 'same_stage', backoffMs: 0 },
      isRetryable: false,
      isBlocking: false,
   },
   FETCH_PARSE_ERROR: {
      errorCode: 'FETCH_PARSE_ERROR',
      stage: 'snippet_or_page_fetch',
      severity: 'warning',
      fallbackStrategy: 'USE_SNIPPETS_ONLY',
      userMessage: 'Contenu web inexploitable. Bascule sur les extraits.',
      retryPolicy: { mode: 'none', maxAttempts: 0, retryScope: 'same_stage', backoffMs: 0 },
      isRetryable: false,
      isBlocking: false,
   },
   RERANKER_ERROR: {
      errorCode: 'RERANKER_ERROR',
      stage: 'reranking',
      severity: 'error',
      fallbackStrategy: 'USE_PRIMARY_RESULT',
      userMessage: 'Erreur de jugement. Utilisation de la source principale.',
      retryPolicy: { mode: 'immediate_once', maxAttempts: 1, retryScope: 'same_stage', backoffMs: 0 },
      isRetryable: true,
      isBlocking: false,
   },
   RERANKER_TIMEOUT: {
      errorCode: 'RERANKER_TIMEOUT',
      stage: 'reranking',
      severity: 'warning',
      fallbackStrategy: 'USE_PRIMARY_RESULT',
      userMessage: 'Analyse de pertinence incomplete. Utilisation de la meilleure source brute.',
      retryPolicy: { mode: 'immediate_once', maxAttempts: 1, retryScope: 'same_stage', backoffMs: 0 },
      isRetryable: true,
      isBlocking: false,
   },
   PIPELINE_TIMEOUT: {
      errorCode: 'PIPELINE_TIMEOUT',
      stage: 'pipeline',
      severity: 'error',
      fallbackStrategy: 'SKIP_STAGE_AND_CONTINUE',
      userMessage: 'Temps limite atteint. Restitution des meilleurs elements deja valides.',
      retryPolicy: { mode: 'none', maxAttempts: 0, retryScope: 'same_stage', backoffMs: 0 },
      isRetryable: false,
      isBlocking: false,
   },
   INVALID_WEB_SEARCH_PARAMS: {
      errorCode: 'INVALID_WEB_SEARCH_PARAMS',
      stage: 'configuration_resolved',
      severity: 'error',
      fallbackStrategy: 'FAIL_WITH_BOUNDED_ERROR',
      userMessage: 'Parametres Web Search invalides.',
      retryPolicy: { mode: 'manual_only', maxAttempts: 0, retryScope: 'same_stage', backoffMs: 0 },
      isRetryable: false,
      isBlocking: true,
   },
   QUERY_TRANSFORMATION_ERROR: {
      errorCode: 'QUERY_TRANSFORMATION_ERROR',
      stage: 'query_transformation',
      severity: 'warning',
      fallbackStrategy: 'REPHRASE_AND_REPLAY',
      userMessage: 'Transformation de requete en echec. Simplification de la recherche.',
      retryPolicy: { mode: 'immediate_once', maxAttempts: 1, retryScope: 'new_subquery', backoffMs: 0 },
      isRetryable: true,
      isBlocking: false,
   },
   QUERY_TRANSFORMATION_PARSE_ERROR: {
      errorCode: 'QUERY_TRANSFORMATION_PARSE_ERROR',
      stage: 'query_transformation',
      severity: 'warning',
      fallbackStrategy: 'REPHRASE_AND_REPLAY',
      userMessage: 'Format de sous-requete invalide. Nouvelle tentative simplifiee.',
      retryPolicy: { mode: 'immediate_once', maxAttempts: 1, retryScope: 'new_subquery', backoffMs: 0 },
      isRetryable: true,
      isBlocking: false,
   },
};
```

15. Pseudo-contrat JSON serialisable minimal pour enregistrement futur:

```json
{
   "errorCode": "FETCH_TIMEOUT",
   "stage": "snippet_or_page_fetch",
   "severity": "warning",
   "fallbackStrategy": "USE_SNIPPETS_ONLY",
   "userMessage": "Acces au site impossible. Analyse des extraits disponible.",
   "retryPolicy": {
      "mode": "bounded_backoff",
      "maxAttempts": 1,
      "retryScope": "same_stage",
      "backoffMs": 300
   },
   "scopeId": "fetch_url_3",
   "attemptIndex": 1,
   "resolvedBy": "snippet_fallback",
   "finalOutcome": "degraded"
}
```
16. Le Tool Block `fallback_or_error` doit projeter non seulement le message utilisateur mais aussi les champs canoniques suivants:
   - `errorCode`
   - `stage`
   - `severity`
   - `fallbackStrategy`
   - `retryPolicy`
   - `attemptIndex`
   - `resolvedBy`
   - `finalOutcome`
17. Pour preparer l'enregistrement futur, chaque erreur ou fallback doit aussi etre rattachable a un scope stable:
   - pipeline global
   - sous-requete
   - URL
   - source candidate
18. Le codeur doit donc produire un identifiant de rattachement stable du type:
   - `pipeline`
   - `subquery_2`
   - `fetch_url_3`
   - `candidate_5`
19. Si une erreur est resolue par un fallback, le statut final du sous-bloc ne doit pas rester simplement `error`; il doit devenir un etat explicite du type `recovered`, `degraded` ou `failed_bounded`.
20. Si un retry a lieu, chaque tentative doit etre historisee comme evenement enfant et non ecraser l'etat precedent.
21. La logique de retry doit etre bornee par design:
   - aucune recursion implicite
   - aucun replay global de pipeline sans politique explicite
   - aucune tentative supplementaire hors `retry_policy`
22. L'agent codeur doit separer strictement:
   - erreur brute technique
   - decision de fallback
   - message utilisateur
   - statut final de l'etape
23. La couche UI ne doit jamais deviner une strategie de fallback a partir d'un message texte. Elle doit la lire depuis les champs canoniques structures.

Critere de sortie:

1. Le pipeline degrade proprement son comportement au lieu d'echouer brutalement ou d'inventer une reponse.
2. Toute erreur pertinente du pipeline peut etre comprise, projetee dans l'UI et enregistree plus tard sans reinterpretation de texte libre.
3. La politique de retry devient audit-able, bornee et compatible avec une future persistence des executions.

## 20. Todo 15 - Encadrer strictement les timeouts et la latence

References:

1. `Reference D`
2. exemple `asyncio.wait_for` du plan source

Actions obligatoires:

1. Definir un timeout global de pipeline.
2. Definir des timeouts de sous-etape:
   - transformation
   - recherche moteur
   - fetch URL
   - reranking
3. Ne pas laisser une URL lente bloquer tout le pipeline.
4. Appliquer un parallelisme borne.
5. Si timeout global, fallback immediat sur les donnees deja disponibles les plus fiables.

Critere de sortie:

1. Le pipeline est borne en temps et sa reponse degradee reste utile.

## 21. Todo 16 - Controler l'explosion de tokens et de couts

References:

1. `Reference A` sur `max_uses`
2. `Reference C.1` sur `max_context_tokens`
3. `Reference C.3` sur `critical_fragment`

Actions obligatoires:

1. Introduire un budget de contexte strict.
2. Tronquer ou resumer avant injection finale si necessaire.
3. N'envoyer que les fragments critiques quand le reranking profond est actif.
4. Interdire l'injection de pages completes non bornees dans le contexte final.

Critere de sortie:

1. La fonction reste exploitable avec des LLM locaux ou contraints en contexte.

## 22. Todo 17 - Ajouter la couverture de tests backend de niveau industriel

References:

1. `Reference B`
2. `Reference C`
3. `Reference D`

Tests obligatoires minimum:

1. `météo Paris demain` avec snippets hors Paris => aucune selection finale valide hors Paris.
2. `météo Paris demain` avec absence de source Paris => `NO_RELEVANT_LOCAL_RESULT`.
3. `allowed_domains` actif => aucune source hors domaine n'entre en selection finale.
4. `dig_snippet = false` => aucun fetch URL reel.
5. `dig_snippet = true` => fetch URL reel et trace de fetch.
6. timeout fetch => fallback snippet et trace explicite.
7. reranking `Fast` vs `Deep` => difference de source de donnees correctement respectee.
8. `cross_lingual_search = true` => generation de variantes sans casser la requete native.
9. contrat de sortie additif => compatibilite maintenue avec `results` et `trace`.
10. chaque `error_code` canonique critique projette la `fallback_strategy` attendue.
11. un retry autorise cree un nouvel evenement enfant sans ecraser l'evenement initial.
12. une erreur non retryable garde une politique `none` ou `manual_only` et n'entraine aucun replay implicite.

Critere de sortie:

1. Le backend est prouve contre les regressions observees en QA.

## 23. Todo 18 - Ajouter la couverture frontend/UI de niveau industriel

References:

1. `Reference A.1`
2. `Reference A.2`
3. `Reference C.4`
4. `Reference D.1`

Tests obligatoires minimum:

1. bouton globe visible quand `web_search_py` est actif
2. bouton globe absent sinon
3. modale ouvrable en carte et fullscreen
4. persistence des `web_search_params`
5. Tool Block garde la separation `tool` / `tool_result`
6. Tool Block affiche les etats du pipeline de facon extensible
7. fallback visible sans casser la reponse finale
8. si plusieurs sous-requetes existent, chaque sous-requete dispose de son propre sous-bloc extensible
9. si `dig_snippet = true`, chaque URL retenue dispose de son propre sous-bloc extensible
10. une erreur locale sur une sous-requete ou une URL n'oblige pas a deplier tout le Tool Block pour etre comprise
11. le sous-bloc `fallback_or_error` affiche `errorCode`, `fallbackStrategy`, `retryPolicy` et `finalOutcome` sans parsing de texte libre
12. un fallback resolu apparait comme `recovered` ou `degraded`, et non comme une erreur brute non contextualisee

Critere de sortie:

1. L'UI devient intelligible sans regression du comportement actuel.

## 24. Todo 19 - Definir la strategie de migration fichier sans regression

Actions obligatoires:

1. Travailler d'abord sur le nouveau comportement sans renommer l'ancien fichier.
2. Ne pas renommer `web_search_py.py` en cours de chantier par simple nettoyage cosmetique.
3. Une fois la nouvelle implementation validee:
   - renommer l'ancien fichier en `backend/python/native/web_search_py_OLD.py`
   - conserver le nouveau en `backend/python/native/web_search_py.py`
4. Mettre a jour dans le meme jalon toute reference de seed ou de chemin si necessaire.

Critere de sortie:

1. Aucun trou de service ni regression de provisioning n'apparait lors du renommage final.

## 25. Todo 20 - Produire les preuves de sortie avant declaration de fin

Le travail n'est declare termine que si les preuves suivantes existent:

1. tests backend cibles verts
2. tests frontend/UI cibles verts
3. preuve QA agent de la map en sandbox
4. preuve d'une requete geolocalisee correcte
5. preuve d'un fallback comprehensible
6. preuve que les sources finales ont ete reelement ouvertes en mode `dig_snippet = true`

## 26. Ordre d'execution recommande pour l'agent codeur

1. Geler la baseline et les tests de non-regression.
2. Ajouter le schema `web_search_params` et la persistence UI.
3. Refactorer `web_search_py` en composants a responsabilite unique.
4. Refaire le filtrage geographique strict.
5. Introduire `NO_RELEVANT_LOCAL_RESULT`.
6. Ajouter le fetch reel des URLs.
7. Ajouter le reranking.
8. Assembler le contexte final pour le LLM principal.
9. Rendre le Tool Block extensible.
10. Executer la QA complete.
11. Renommer l'ancien fichier en `_OLD` uniquement apres validation.

## 27. Interdictions explicites

1. Interdiction de faire une simple surcouche cosmetique sur le fichier actuel sans decomposition metier.
2. Interdiction de renvoyer une reponse hors localisation demandee pour eviter un echec metier propre.
3. Interdiction de presenter comme "sources verifiees" des URLs jamais lues en mode `dig_snippet = true`.
4. Interdiction de faire transiter la page complete vers le LLM principal sans budget de tokens.
5. Interdiction de casser le bloc Tool valide par QA.
6. Interdiction de renommer l'ancien fichier avant validation du nouveau pipeline.

## 28. Definition de fini

La transformation de `web_search_py` sera consideree terminee uniquement si les cinq conditions suivantes sont simultanement vraies:

1. la recherche part toujours correctement en sandbox depuis un agent de la map
2. la pertinence geographique est correcte et prouvee
3. les pages finales peuvent etre reelement lues et rerankees
4. le LLM principal recoit un contexte borne avec citations et sources
5. le Tool Block expose clairement progression, fallbacks et sources retenues

Tant qu'un seul de ces points manque, le chantier n'est pas termine.