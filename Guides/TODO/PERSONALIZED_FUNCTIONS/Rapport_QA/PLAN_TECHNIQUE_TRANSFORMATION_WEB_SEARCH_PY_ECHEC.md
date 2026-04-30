Partie 1
Exemple attendu de flux de travail pour exécuter la fonction native web_search_py de notre application :
1- Sur la carte du workflow, un utilisateur envoie prompt à un agent qui dispose de la fonctionnalité web_search_py native.
2- L'agent analyse la demande de l'utilisateur et détermine s'il doit lancer une recherche web pour lui répondre.
3- Si l'agent estime devoir utiliser web_search_py, il va se servir de la configuration de la web_search_py qui lui est attribuée avec le formulaire "paramètres web search de l'agent".
4- Pour préparer sa requête web, l'agent va devoir utiliser soit un moteur de recherche indiqué dans le champ select 'moteur', soit utiliser un référentiel de sites ou de domaines qui aura été renseigné dans le champ 'domaines autorisés'
5- Pour formuler sa requête de recherche web l'agent va devoir créer une sous requête à son propre llm en utilisant le prompt du champ 'Query transformation'. 
6- Pour utiliser ce prompt 'Query transformation' il doit fournir des éléments sous forme de variables : le  {{system_context}} et le  {{user_query}}
7- La variable  {{system_context}} est un taleau comprenant les éléments clés recherchés ou indispensables (la langue utilisée par l'utilisateur est obligatoire). Ce sont les éléments heuristiques de la demande utilisateur, par exemple un secteur, une date, une spécialisation etc... Ce tableau peut contenir 20 éléments maximum.
8- La variable {{user_query}} est la requête initiale de l'utilisateur, elle doit être utilisée telle quelle dans le prompt de transformation de la requête.
9- L'agent principal doit récupérer la réponse du sous-agent telle quelle et c'est cette réponse qui sera utilisée pour interroger un moteur de recherche.
10- L'agent principal doit ensuite formuler une requête de recherche web à partir de la réponse du sous-agent (<requête_transformée>) et en utilisant les éléments de configuration de la fonctionnalité web_search_py dans la partie de formulaire 'portée et langue': moteur de recherche ou domaines autorisés ( avec "site:<domaine-sélectionné>" + <requête_transformée>). 
11- La requete web est ensuite exécutée sur la sandbox avec la librairie DDGS et  avec le moteur sélectionné dans la configuration.

exemples avec des moteurs de recherche: 
a- "query": "Peux tu chercher sur internet quel temps il fera demain à Paris ?" 
-> "transform_query" = "Paris météo demain 29/04/2026 prévisions températures précipitations vent heure par heure"  
-> moteur de recherche sélectionné = duckduckgo.com donne "query_engine" = https://duckduckgo.com/?q=quel+temps+il+fera+demain+%C3%A0+paris&atb=v512-1&ia=web

b- "query": "Peux tu chercher sur internet les spectacles cette semaine  à Paris dans la salle de Bercy?" 
-> "transform_query" = "spectacles semaine Paris Bercy salle programmation dates horaires billetterie concerts théâtre événements en salle AccorArena Bercy 2026 avril mai programmation semaine en cours"  
-> moteur de recherche sélectionné = google.com donne "query_engine" = https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+salle+programmation+dates+horaires+billetterie+concerts+th%C3%A9%C3%A2tre+%C3%A9v%C3%A9nements+en+salle+AccorArena+Bercy+2026+avril+mai+programmation+semaine+en+cours&sca_esv=2cda95c598b12d52&sxsrf=ANbL-n4hpVt8PHUJ0k-qLoMaWPZ0-Vnkeg%3A1777476548155&ei=xCPyac-WCeeN-d8PyoSAkAY&biw=1920&bih=919&ved=0ahUKEwjPiP-RsJOUAxXnRv4FHUoCAGIQ4dUDCBE&uact=5&oq=spectacles+semaine+Paris+Bercy+salle+programmation+dates+horaires+billetterie+concerts+th%C3%A9%C3%A2tre+%C3%A9v%C3%A9nements+en+salle+AccorArena+Bercy+2026+avril+mai+programmation+semaine+en+cours&gs_lp=Egxnd3Mtd2l6LXNlcnAitQFzcGVjdGFjbGVzIHNlbWFpbmUgUGFyaXMgQmVyY3kgc2FsbGUgcHJvZ3JhbW1hdGlvbiBkYXRlcyBob3JhaXJlcyBiaWxsZXR0ZXJpZSBjb25jZXJ0cyB0aMOpw6J0cmUgw6l2w6luZW1lbnRzIGVuIHNhbGxlIEFjY29yQXJlbmEgQmVyY3kgMjAyNiBhdnJpbCBtYWkgcHJvZ3JhbW1hdGlvbiBzZW1haW5lIGVuIGNvdXJzSABQAFgAcAB4AZABAJgBAKABAKoBALgBA8gBAPgBAvgBAZgCAKACAJgDAJIHAKAHALIHALgHAMIHAMgHAIAIAQ&sclient=gws-wiz-serp

b- "query": "Peux tu chercher sur internet les adresses de boulangerie à Saint Nom la Bretèche, France ? " 
-> "transform_query" = "boulangerie adresses Saint-Nom-la-Bretèche France commerces artisanaux horaires avis plan contact téléphone"  
-> moteur de recherche sélectionné = bing.com donne "query_engine" = https://www.bing.com/search?q=boulangerie+adresses+Saint-Nom-la-Bret%C3%A8che+France+commerces+artisanaux+horaires+avis+plan+contact+t%C3%A9l%C3%A9phone&form=QBLH&sp=-1&lq=0&pq=boulangerie+adresses+saint-nom-la-bret%C3%A8che+france+commerces+artisanaux+horaires+avis+plan+contact+t%C3%A9l%C3%A9phone

----------------
Partie 2 : 
Constat d'échec : 
Constats

Le programme ne respecte pas l’étape 9 du contrat: la réponse du sous-agent de transformation n’est pas réutilisée telle quelle pour la requête web. Dans web_search_query_transformation.py:74, la sortie LLM est retransformée en structure interne avec normalized_query, queries, english_queries, must_include_terms, exclude_terms. Dans web_search_query_transformation.py:136, le code impose même un contrat JSON ou une liste de lignes. Or le log de référence dit explicitement que la réponse du sous-agent doit être récupérée telle quelle puis utilisée pour interroger le moteur.
Le programme ne respecte pas l’étape 10: il ne construit pas une vraie requête moteur à partir de la transformation et du moteur choisi. Dans web_search_py_old.py:288, après transform_query, le code envoie directement des chaînes candidates à DDGS. Il n’existe nulle part de construction explicite d’un query_engine du type DuckDuckGo, Google, Bing, etc. Le contrat attendu donne pourtant des URLs moteur explicites, par exemple celle de DuckDuckGo sur ton cas météo.
Le programme ne respecte pas l’étape 11 pour le champ moteur. Dans web_search_py_old.py:65, tous les moteurs configurés sont rabattus sur les backends DuckDuckGo. Donc si la configuration contient Google, Bing, Baidu ou Qwant, le code n’exécute quand même pas ces moteurs. C’est une violation directe du comportement promis par le formulaire UI et le schéma backend définis dans WebSearchParamsModal.tsx:7 et web-search-params.schema.ts:3.
Le programme a inventé une logique multi-backends et multi-requêtes qui n’existe pas dans le processus de référence. Dans web_search_py_old.py:234, il boucle sur plusieurs backends techniques DDGS pour une même requête. Dans web_search_query_transformation.py:74, il peut aussi générer plusieurs requêtes, variantes anglaises, enrichissements de domaines, etc. Le contrat de référence, lui, décrit une séquence simple: user query -> transform_query -> query_engine sur le moteur choisi.
Le fallback de transformation viole le contrat fonctionnel. Dans web_search_query_transformation.py:36, si le LLM échoue, le code fabrique une pseudo-requête par heuristiques locales. Ce fallback remplace de fait la réponse du sous-agent, alors que le processus attendu impose que la préparation de requête passe par la sous-requête LLM et que sa réponse soit la base d’interrogation du moteur.
La variable system_context n’a pas la forme attendue. Le log de référence décrit un tableau d’éléments clés, maximum 20, avec langue obligatoire. Or web_search_system_context.py:23 construit un objet riche avec current_date, relative_dates, query, location, specialization, etc. Puis web_search_query_transformation.py:20 le sérialise en JSON objet dans le template. Ce n’est pas la structure fonctionnelle demandée.
Le programme mélange déjà des responsabilités postérieures au périmètre que tu m’as demandé d’analyser. Dans web_search_py_old.py:288, le pipeline enclenche immédiatement projection, fetch, reranking et contexte LLM après la recherche. Le fichier de référence que tu m’as donné s’arrête à la requête internet. Donc le code a été conçu autour d’un pipeline plus large que le contrat que tu veux d’abord valider.
Le fallback HTML DuckDuckGo manuel n’est pas le comportement demandé. Dans web_search_py_old.py:123, le code interroge html.duckduckgo.com directement. Ce n’est pas l’URL moteur de référence que tu as donnée pour DuckDuckGo. Même si les résultats peuvent parfois sembler corrects, ce n’est pas le process attendu.
Le code confond moteur métier et backend technique de librairie. La configuration parle de moteurs utilisateur comme duckduckgo.com, google.com, bing.com. Le code parle de backends techniques DDGS comme html, api, lite. C’est une erreur de modélisation: un moteur configuré par l’utilisateur ne doit pas être réduit à un détail interne de client Python sans couche de traduction métier explicite.
Le cas météo simple que tu as donné montre le défaut principal: le système traite la chaîne transformée comme une entrée à “optimiser” dans un pipeline générique, alors que le besoin est d’exécuter fidèlement la requête moteur correspondant au moteur choisi. C’est ce décalage de conception qui explique que le process parte hors sujet avant même le reranking.
Différence avec le comportement attendu

Attendu: user query brute -> prompt Query transformation avec system_context et user_query -> réponse LLM récupérée telle quelle -> construction de query_engine selon moteur choisi -> exécution de cette requête sur internet.
Codé: user query brute -> prompt LLM avec contrat JSON interne -> parsing/normalisation/fallback heuristique -> génération éventuelle de plusieurs queries/variantes/backends -> exécution DDGS abstraite -> filtrage/projection/reranking.
Proposition de correction

Revenir à un modèle en deux objets métier séparés avant toute recherche:
TransformationResult: contient uniquement la réponse brute du sous-agent, plus éventuellement une version tracée.
EngineQueryPlan: contient le moteur choisi, la chaîne exacte à rechercher, et l’URL moteur exacte à exécuter.
Interdire toute réécriture de la sortie transformée avant la construction de la requête moteur. Le programme peut la valider ou la tronquer pour sécurité, mais pas la remodeler en structure interne multi-queries.
Remplacer la logique actuelle de mapping moteur par une vraie couche de stratégie moteur:
DuckDuckGoStrategy -> construit l’URL DuckDuckGo exacte.
GoogleStrategy -> construit l’URL Google exacte.
BingStrategy -> construit l’URL Bing exacte.
BaiduStrategy, QwantStrategy idem.
Faire porter à DDGS uniquement le cas DuckDuckGo si vous acceptez son abstraction, mais dans ce cas il faut assumer que DDGS ne garantit pas l’URL exacte du navigateur. Si l’exigence produit est l’URL exacte du type [duckduckgo.com/?q=...&ia=web], alors il faut un exécuteur HTTP explicite pour ce moteur, pas une abstraction DDGS opaque.
Supprimer du périmètre pré-recherche tous les champs qui ne servent pas à l’étape 1-11 du log de référence: multi-query, cross-lingual, must_include_terms, exclude_terms, fan-out backend. Ces mécanismes ne doivent pas exister avant validation du process simple.
Redéfinir system_context en structure conforme à la référence: un tableau borné d’indices clés, langue obligatoire, pas un objet libre.
Tracer explicitement trois éléments dans l’exécution:
user_query reçu
transform_query brut renvoyé par le sous-agent
query_engine final effectivement exécuté
Valider le contrat par tests centrés sur la phase pré-recherche seulement:
un test qui vérifie que la transformation brute est réinjectée telle quelle
un test qui vérifie que duckduckgo.com produit exactement la query_engine attendue
un test par moteur configuré pour vérifier la construction de l’URL moteur
un test qui échoue si plusieurs backends techniques sont appelés pour une seule transformation