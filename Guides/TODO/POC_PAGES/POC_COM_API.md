
Représentation des noeuds API sur la page COM
I La page est divisée en 3 colonnes :
1- Première colonne
Sur la première la liste des nodes de connexion API déjà créés par l'utilisateur. 
Sur cette représentation, chaque node a un header avec son nom et à droite un bouton de modification et un bouton de suppression. Dans le bloc de contenu la signature de l'API, le format et la méthode encadrée. Sous cette ligne une information de type "Non testée" ou "Disponible"/"Erreur" avec une icône corresponsante et la date de test.
Le bouton de modification permet au clic d'afficher dans les deux autres colonnes les entry points pour la deuxième colonne et les endpoints pour la seconde colonne.
En footer d'un bloc de noeud API d'utilisateur, il faut ajouter un bouton "Ajouter au workflow" qui permettra d'envoyer dans un développement fuutur ce node sur la map de workflow.
2- Deuxième colonne
Représentation d'un noeud API, on a le formulaire détaillé d'interrogation d'API

II Représentation d'un noeud API
L'enjeu ici est de passer d'un schéma JSON brut à une interface utilisateur dynamique capable de gérer des configurations complexes sans exploser en plein vol.

1. Anatomie d'un Nœud API (Data Schema)

Chaque nœud API n'est pas qu'une simple fonction ; c'est un objet riche qui définit à la fois son comportement et son rendu visuel (via l'UI). Pour ton POC, nous devons isoler l'objet description.
Structure de base du schéma
JSON

{
  "displayName": "Nom du Nœud",
  "name": "nodeName",
  "icon": "fa:server",
  "description": "Description du Nœud",
  "format": "Format de l'API"
  "group": ["transform"],
  "version": 1,
  "defaults": { "name": "Mon Nœud" },
  "inputs": ["main"],
  "outputs": ["main"],
  "properties": [ ... ] 
}

2. Analyse des properties (Le moteur de l'UI) et du format

C'est ici que le travail d'UX Designer intervient. Chaque entrée dans properties doit être mappée à un composant React.
Type noeud API :	Composant React suggéré	Usage UX
string	InputText	Nom du nœud.
string	InputText	Description du nœud.
string	InputText	Valeurs simples, IDs, étiquettes.
options	Select / Dropdown	Choix uniques (ex: Méthode HTTP).
boolean	Switch / Checkbox	Activation de flags ou options secondaires.
collection	Fieldset dynamique	Groupes de paramètres (ex: Headers).
resourceLocator	Combobox avec recherche	Sélection d'entités via API (ex: ID de projet).
Logique Conditionnelle (displayOptions)

Format des API
réponses API
Format	Extension	Usage principal
JSON	.json	Le standard actuel : léger, lisible par l'humain et parfait pour JavaScript/React.
XML	.xml	L'ancêtre (toujours vivant). Très utilisé dans les services bancaires ou les vieilles API SOAP.
HTML	.html	Parfois, une API te renvoie un morceau de page (SSR) ou, plus souvent, une page d'erreur 404/500 complète.
CSV	.csv	Idéal pour l'export de grosses bases de données ou de feuilles de calcul.
Binary	.bin / .png / .pdf	Pour les images, les PDFs ou les fichiers audio. Dans n8n, c'est ce qu'on appelle la structure binary.
Protobuf	.proto	Utilisé par Google (gRPC). C'est du binaire ultra-compressé, illisible tel quel, mais ultra rapide.

Le payload contient souvent un champ displayOptions. Pour ton POC, tu devras implémenter un moteur de visibilité :

    Règle : Le composant ne s'affiche que si parentField === value.

    Impact UX : Réduit la charge cognitive en masquant les options inutiles.

3. Flux de Données & Payloads (Entrypoints/Endpoints)

Pour la reproduction technique, notre application utilise deux flux distincts :
A. Le flux de configuration (Design Time)

Il est situé sur la colonne centrale de la page, sous le formulaire de création/modification d'un nœud.
Dans le formulaire ane pas oublier le nom de l'API (en création ou modification)

Lorsqu'un utilisateur configure un nœud, le front-end interroge souvent des endpoints pour remplir les options dynamiques.

    Endpoint type : GET /v1/nodes/nodeName/methods/loadOptions

    Payload attendu : Les credentials et les paramètres actuels du nœud pour filtrer les résultats.

B. Le flux d'exécution (Run Time) et le flux de résultat

Il est situé sur la colonne de droite de la page, sous le bouton de sauvegarde du noeud.
Le payload envoyé au moteur d'exécution (ou simulé dans ton POC) suit une arborescence standardisée :
JSON

{
  "node": "NomDuNoeud",
  "parameters": {
    "resource": "user",
    "operation": "get",
    "additionalFields": { "active": true }
  },
  "credentials": { "apiKey": "..." }
}

La représentation doit être en arborescence si c'est du json ou du XML, et utilisable en drag and drop. Proposer les options de représentation de  tableau ou d'objet. Si c'est du CSV, proposer une représentation en tableau.

Sous ce bloc de résultat, dans le cas de blocs json,XML ou CSV, proposer à l'utilisateur de drag and drop uniquement certaines valeurs ou lignes ou partie de l'arborescence vers un bloc "Sélection partielle du résultat" et un bouton on/off. Cela permet à l'utilisateur de choisir d'envoyer tout le résultat ou seulement une partie.

4. Stratégie d'implémentation React (POC)

Pour rendre ce POC robuste et fidèle à l'expérience n8n, je recommande l'approche suivante :

    State Management : Utilise un useForm (type React Hook Form) pour gérer l'objet parameters en temps réel.

    Recursive Rendering : Crée un composant NodePropertyRenderer qui boucle sur le tableau properties et rend le composant adéquat selon le type.

    Validation : Intègre la logique required: true du schéma n8n directement dans tes schémas de validation (Zod ou Yup).

    Note technique : N'oublie pas de gérer les Expressions. Dans notre application, n'importe quel champ peut passer d'une valeur statique à une expression dynamique (ex: {{ $node["Variable"].json["id"] }}). 
    L'utilisateur doit pourvoir sélectionner facilement ces variables.
    Ton UI React doit prévoir un "toggle" pour ce mode.
    Si l'utilisateur le souhaite il peut modifier le endpoint et ne sélectionner que certaines variables du endpoint.