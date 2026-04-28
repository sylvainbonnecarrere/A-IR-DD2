1- web_search_py
Cette fonction sera par la suite enrichie avec des des boutons d'options sur les agents de la map(ex max uses, allowed domains etc...), d'autres librairies que duckdckgo_search  (comme firecrawl), du rag de vérification pour chercher si des informations sont déjà dans les poids lorsqu'on aura introduit les vecteurs stores etc... 

- écrire une matrice de tests de contrat dédiée à web_search_py : succès nominal, timeout, erreurs réseau, schéma de sortie, nettoyage des entrées
- isoler son abstraction de provider web pour préparer duckduckgo_search puis firecrawl sans casser l’API de la fonction
- définir dès maintenant les invariants d’options futures maxUses, allowedDomains, stratégie de vérification/RAG, pour éviter une fonction monolithique quand on ajoutera ces capacités