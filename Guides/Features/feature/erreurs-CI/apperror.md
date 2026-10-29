 le problème ressemble donc à une translation incorrecte du contenu de la carte, pas à un défaut du calcul géométrique du centre en soi.

Les pièges les plus probables sont :

canvasWidth et canvasHeight proviennent de la fenêtre ou d’un parent, plutôt que de la zone réelle de React Flow ;
les dimensions des nœuds sont absentes ou mesurées avant que les nœuds personnalisés aient leur taille finale ;
le calcul mélange coordonnées écran et coordonnées de la carte, ou applique un offset du conteneur une seconde fois ;
un autre effet réapplique ensuite un viewport ou un fitView incorrect.
Je conseillerais à l’agent de ne plus calculer viewportX/Y à la main. Si le projet utilise bien React Flow, son API propose setCenter(x, y, { zoom }) pour centrer sur des coordonnées de la carte, et getNodesBounds pour obtenir les limites d’un groupe de nœuds. Cela évite de devoir reproduire manuellement la conversion à partir de la taille du canvas. 
reactflow.dev
1

tsx


const { getNodes, getZoom, setCenter } = useReactFlow();

const centerNodes = async () => {
  const nodes = getNodes();

  if (nodes.length === 0) return;

  const bounds = getNodesBounds(nodes);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  await setCenter(centerX, centerY, {
    zoom: getZoom(),
    duration: 0,
  });
};
Il faut appeler cette fonction après l’initialisation du viewport et la mesure des nœuds, avec un conteneur ayant une largeur et une hauteur réelles. Un problème de dimensions périmées au moment du cadrage a déjà été signalé dans React Flow après un changement de taille de panneau ; cela renforce la piste d’un calcul exécuté avant la mise à jour effective du canvas. 
GitHub

Test rapide pour localiser le bug : journaliser getViewport() juste après le centrage, puis à la frame suivante. Si le viewport est correct immédiatement puis redevient décalé, un autre effet écrase le centrage. S’il est déjà incorrect, vérifier en priorité que les nœuds sont mesurés et que la zone utilisée pour le centrage est bien le viewport réel de la carte — pas la fenêtre entière.