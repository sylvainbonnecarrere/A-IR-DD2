A - Paramétrage des recherches web

1- Afficher un bouton bleu discret dans le footer du block de l'agent, sous le bloc de prompt de l'utilisateur, lorsque la fonction native 'web_search_py' est activée sur cet agent. Il est bleu car le bleu est la couleur du robot Phil qui gère les fonctions dans l'application. Le picto à utiliser est un symbole de globe terrestre. Attention, il faut bien sûr faire apparaitre ce bouton dans la version fullscreen du bloc de l'agent (quand l'utilisateur clique dans le header sur le bouton 'Ouvrir en plein écran').
2- Lorsque l'utilisateur clique sur ce bouton, il accède à un formulaire de paramètres du LLM dans une modale bleue laser ayant dans son header pour nom "Paramètres Web Search de l'agent" + le nom de l'agent. Le formulaire est assez long mais la fenêtre doit avoir la même taille qu'un bloc d'agent sur la map, donc si le formulaire dépasse il lui faut des scrollers horizontal et vertical.
3- Ce formulaire permet de configurer les paramètres de recherche web :
-> le paramètre 'nb_request_transformation' (obligatoire - un entier) permet de limiter le nombre de requête que le LLM peut créer après avoir analysé la demande de l'utilisateur et créé une requête apporopriée pour obtenir le résultat le plus précis et adéquat à la demande de l'utilisateur. Attention, un utilisateur peut effectuer plusieurs demandes différentes dans un même prompt, ce qui implique plusieurs recherches web différentes. Par défaut, 'nb_request_transformation' est à 1.
-> le paramètre request_list est une case à cocher qui apparait si 'nb_request_transformation' est supérieur à 1. Cela permet aux prompts de transformation d'être capables de générer une liste (ex: format JSON ou séparateur |). On cumule ainsi les résultats avec une boucle itérative. Par défaut la case n'est pas cochée.
-> le paramètre 'max_uses' (un entier) permet de limiter le nombre de résultats par requête web que le LLM va récupérer pour analyser les résultats et donner une réponse.
-> le paramètre "cross-lingual-search" est une option facultative. Si activée, le sous-agent génère la requête en langue native ET en anglais pour maximiser la richesse des sources, puis traduit les snippets avant synthèse.
-> le paramètre 'web_engine_search' est une case à cocher. Si elle est cochée, on utilise par défaut pour la "normalized_query" un moteur de recherche.
-> le paramètre 'web_engine' est une liste de moteurs de recherches qui apparait si 'web_engine_search' est coché. La liste permet de sélectionner un seul  moteur de recherche (obligatoire) parmi duckduckgo.com, bing.com, google.com, baidu.com, qwant.com. Par défaut c'est duckduckgo.com qui est sélectionné.
-> le paramètre 'web_engine_nb_result_select' et un entier (obligatoire) qui apparait si 'web_engine_search' est coché. Ce nombreentier permet de limiter les recherches à analyser aux premiers résultats obtenus au résultat de la requête. Par défaut le paramètre 'web_engine_nb_result_select' est 3 donc il se limite aux 3 premiers résultats (hors liens sponsorisés).
-> le paramètre "dig_snippet" est une case à cocher true ou false ui apparait si 'web_engine_search' est coché. Par défaut la requête lancée en recherche web va afficher des résultats de moteurs de recherche, si la case est cochée, chaque url obtenue devra être ouverte et analysée pour créer un résumé en relation avec la  "normalized_query".
-> le paramètre 'allowed_domains' est facultatif, c'est un champ texte avec un bouton "+" sur le côté.
Il permet d'ajouter (avec un validateur) une liste d'URLs ou de domaines web permettant de limiter les recherches à des domaines spécifiques. Chaque champ texte correspond à une URL ou un domaine et chaque fois que l'utilisateur clique sur le bouton "+", il peut en ajouter un suplémentaire.
-> Le paramètre de champ "query_transformation" est un textarea. Ce champ est un prompt permettant à l'agent de transformer une demande utilisateur en recherche web. Le processus est détaillé dans la partie suivante B2 (Query Transformation). 
Par défaut ce champ comporte le texte suivant "
# ROLE
Tu es le processeur d'abstraction sémantique. Ta mission est de transformer le flux de pensée naturel du prompt utilisateur en un vecteur de recherche optimal pour une recherche web, dépouillé de toute syntaxe conversationnelle.

# PRINCIPES D'ABSTRACTION
1. DÉTERMINATION DU NOYAU : Extraire le sujet pivot de la demande (l'entité ou le concept central).
2. EXPANSION DES DIMENSIONS : Identifier les variables critiques nécessaires à la résolution de l'intention (qu'elles soient temporelles, spatiales, techniques ou normatives).
3. RÉSOLUTION DES RÉFÉRENTIELS : Convertir tout terme relatif ou contextuel en une valeur absolue et explicite selon les métadonnées fournies.
4. SYNTHÈSE D'INDEXATION : Produire une chaîne de termes à haute densité informationnelle, hiérarchisée par pertinence pour un index de recherche.

# CONTRAINTES DE FLUX
- SORTIE : Chaîne de mots-clés brute uniquement.
- ÉLAGAGE : Suppression totale des structures grammaticales, des déterminants et des modalisateurs.
- NEUTRALITÉ : Ne pas interpréter, ne pas conseiller. Uniquement transformer.

# ENTRÉES SYSTÈME
- RÉFÉRENTIELS : {{system_context}} (Exemples : Dates, Localisation, Spécialisation, Secteurs etc...)
- INPUT : {{user_query}}
" 
B - Transformation des étapes de recherche web 

1- Récupérer la langue de l'utilisateur pour créer une requête dans cette langue.
2- "Self-Querying" ou "Query Transformation". (cf Pydantic). C'est l'étape de l'Analyse de l'Architecture Conceptuelle : en partant de la demande de l'utilisateur, on va la transformer en une requête web optimisée pour obtenir les meilleurs résultats  