Les appels de fonction ont été réalisés à partir d'agents configurés avec des LLMs en local (on premise) car dans la version antérieure de l'application, des appels de fonctions avaient été réalisés sur des fonctions très simples e TS avec les bibliothèques des LLMs Cloud-only.
Les tests concernent deux pages, sur la page fonctions personnalisées et sur la page carte du workflow avec des agents.

Ces tests QA sont la première version basique des tests QA, tous les tests ont échoué, aucun livrable attendu n'est validé.
Devant ce résultat catastrophique, les architextes, le chef de projet et les testeurs ont jugé totalement inutile de déclencher les phases de test  suivants.

RAPPORTS

A - Premier rapport des tests QA sur les Tools sur la Page Fonctions personnalisées, onglet Éditeur:

1- Le test porte sur une fonction Typescript. 
La fonction testée "hello_test" est sensée être simple :

export function run(
  context: { userId: string; agentId?: string; workflowId?: string; depth: number },
  args: { [key: string]: unknown }  // Ex: { user_name: string; limit?: number }
): unknown {
  // TODO: Implémentez votre logique ici
  return { result: "Ton nom est maintenant enregistré dans ma mémoire" };
}

Pourtant, le testeur essaie de placer des arguments simples dans le champ "Arguments de test (JSON)"
exemples : { user_name: 'test'} ou { 'user_name': 'test'} mais à chaque fois il a une erreur affichée "JSON invalide" qui empêche l'exécution.
Ce détecteur d'erreur ne semble pas fonctionner correctement et on a aucun indice en console sur le type d'erreur interceptée.
Il semble que cela ne fonctionne pas, ou alors il faut que tu fournisses un exemple simple de test sur cette fonction pour le testeur QA car on a eu aucun succès.

2- Le testeur a besoin d'un cas de test en python simple du même type.

3- Le testeur necomprend pas comment faire pour que pouvoir cliquer sur le bouton de lancement du build (le bouton est grisé)

4- Le test d'une fonction native est compliqué, selon les fonctions on peut avoir besoin d'un document et l'utilisateur ne voit pas le code dans l'éditeur.
Cependant l'utilisateur a choisi la fonction web_search_py et s'est rendu sur l'onglet Éditeur puis a cliqé sur le bouton "Exécuter".
Le résultat dans la console de l'éditeur montre un disfonctionnement critique et affiche "wall 1418ms
mem limit 256MB
failure sandbox runtime error
Erreur
Dépendances manquantes pour web_search_py : pip install duckduckgo-search" ce qui indique que la bibliothèque duckduckgo-search n'a pas été installée et qu'aucun processus de vérification n'est prévu.

B- Second rapport des tests QA pour les Tools sur la page "Carte du workflow"

5- Le testeur utilise un agent qui a en paramètres de fonctions la fonction native "web_search_py".
Lorsque le testeur demande à l'agent une recherche sur internet, l'appel de fonction apparait dans le chat mais il est lancé 4 fois et renvoie à chaque fois une erreur :
Input
📋
{
  "query": "météo demain prévision temps",
  "num_results": 5,
  "language": "fr",
  "safe_search": true
}
Output (erreur)
📋
{
  "error": "{\"error\":\"Only custom editable tools can be prepared by the build workflow.\"}"
}
En console, l'erreur suivante s'affiche : "AgentLoop.ts:106 
 POST http://localhost:3001/api/sandbox/run 409 (Conflict)
executeFunction	@	AgentLoop.ts:106
runAgentLoop	@	AgentLoop.ts:243
await in runAgentLoop		
handleSendMessage	@	V2AgentNode.tsx:545
onKeyDown	@	V2AgentNode.tsx:1363
".

6- Le testeur utilise une fonction qui a e paramètres de fonctions la fonction custom typescript "hello_test" vur sur lepoint 1.
Le testeur envoie un prompt pour l'invoquer et la fonction est bien invoquée une fois mais affiche une erreur dans le prompt :
Input
📋
{}
Output (erreur)
📋
{
  "error": "[eval]:12\n    error: (...items) => logs.push(items.map(stringify).join(' '));\n                                                                  ^\n\nSyntaxError: Unexpected token ';'\n    at makeContextifyScript (node:internal/vm:185:14)\n    at compileScript (node:internal/process/execution:383:10)\n    at node:internal/process/execution:447:25\n    at [eval]-wrapper:6:24\n    at runScriptInContext (node:internal/process/execution:444:60)\n    at evalFunction (node:internal/process/execution:88:30)\n    at evalScript (node:internal/process/execution:100:3)\n    at node:internal/main/eval_string:74:3\n\nNode.js v22.22.1"
}
En console, aucune erreur n'est affichée.

C- La sécurité des sandboxes
Des développeurs ont remarqué que l'interface Visual Code affiche dans le terminal sous l'onglet Problems deux erreurs de sécurité avec les sandboxes 
1- The image contains 1 critical and 1 high vulnerabilities et un lien vers l'URL : https://hub.docker.com/layers/library/node/22-bookworm-slim/images/sha256-3efebb4f5f2952af4c86fe443a4e219129cc36f90e93d1ea2c4aa6cf65bdecf2
2- The image contains 1 critical vulnerability et un lien vers l'URL https://hub.docker.com/layers/library/python/3.12-slim-bookworm/images/sha256-38f794ff7afccc577d6b4beb6ab5fae2dff155e5a6f038aa7f13d6dd8487ce82