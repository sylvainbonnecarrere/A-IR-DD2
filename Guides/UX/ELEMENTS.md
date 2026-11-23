# Charte graphique — éléments UX

## Composant : TabIconBlurNeon

**Style de référence** : bouton d'onglet de la modale de configuration d'instance d'agent
(Configuration, Historique, Fonctions, Formatage, Persistance, Liens, Tâches, Logs, Erreurs) — version validée.

**Implémentation** : `components/agent-tabs/TabIconNeon.tsx` (`NeonIcon` générique + wrapper
`TabIconNeon` pour les onglets ; contrôles de run dans `components/workflow/RunControls.tsx`).
États pilotés par CSS dans `index.css` via `.neon-icon` + classes de contexte
(`.agent-tab-btn` / `.tab-active`, `.run-control-btn`) + `:hover` / `:disabled`.
**Exports statiques** (état par défaut) : `public/icons/agent-tabs/<libellé>.svg` (ton bleu) et
`public/icons/run-controls/{play,pause,stop}.svg` (ton vert).

### Tons

| Ton | Usage | Verre (dégradé) | Reflet bas | Accent lueur glyphe | Bordure actif | Remplissage glyphe |
|---|---|---|---|---|---|---|
| **blue** | onglets modale agent | `#a5f3fc` 0.32 → `#0e7490` 0.16 → `#22d3ee` 0.30 | `#cffafe` | `#22d3ee` | `#22d3ee` / cœur `#a5f3fc` | `#082f49` 0.4 |
| **green** | contrôles run play/pause/stop | `#a3e635` 0.32 → `#4d7c0f` 0.16 → `#84cc16` 0.30 | `#ecfccb` | `#a3e635` | `#84cc16` / cœur `#f7fee7` | `#1a2e05` 0.45 |

### Contrôles de run (carte workflow)

- Bloc `RunControls` placé à **gauche** de la toolbar, juste après l'info de run, avec un petit
  espace (`ml-1`) : 3 boutons icônes **sans texte** — play (remplace « Exécuter »), pause, stop
  (pause/stop désactivés tant que le serveur n'expose pas pause/resume — cf. backlog US-J7-02).
- **Bloc de largeur fixe** (`flex-shrink-0`, 3 × `w-10 h-10` + `gap-2`) et éléments voisins à
  largeur fixe (nom `w-56`, statut `w-32`, `truncate`) → le bloc ne bouge pas quand l'état du
  workflow change (corrige le déplacement de l'ancien bouton « Exécuter »).

### Géométrie (template unique, viewBox 0 0 240 240)

| Élément | Valeur |
|---|---|
| Tube néon externe | `rect x=32 y=32 w=176 h=176 rx=38`, épaisseur 4 |
| Cœur du néon | même rect, épaisseur 1.6 |
| Tube interne | `rect x=38.5 y=38.5 w=163 h=163 rx=32`, épaisseur 1.4 |
| Fond verre | `rect x=36 y=36 w=168 h=168 rx=34` (radius ≈ 20 % du cadre) |
| Biseau interne | `rect x=38 y=38 w=164 h=164 rx=32`, blanc 0.28, épaisseur 1.5 |
| Reflet haut | path bombe `M30 30 L210 30 L210 82 Q120 105 30 82 Z` (dégradé blanc 0.58 → 0) |
| Reflet bas | path `M30 210 L210 210 L210 182 Q120 168 30 182 Z` (dégradé #cffafe 0.35 → 0) |
| Sheen (survol) | rect verre plein, dégradé blanc 0.9 → 0, opacité pilotée par état |
| Marge glyphe/bordure | glyphe mis à l'échelle 0.88–0.92 autour du centre (120,120) → ~25–30 unités d'air avec le tube |

### Couleurs (thème bleu)

| Usage | Couleur |
|---|---|
| Teinte principale / bleu actif | cyan **#22d3ee** (identique aux libellés `text-cyan-400`) |
| Verre (dégradé diagonal) | `#a5f3fc` 0.32 → `#0e7490` 0.16 → `#22d3ee` 0.30 |
| Reflet bas | `#cffafe` |
| Lueur du glyphe (stroke 6) | `#22d3ee` (état normal : `rgba(34,211,238,0.35)`) |
| Cœur du glyphe (stroke 2.4) | blanc (état normal : `rgba(255,255,255,0.5)`) |
| Remplissage foncé des glyphes | `#082f49` opacité 0.4 |

### États (transition 0.25 s)

| État | Bordure | Glow bordure | Glyphe |
|---|---|---|---|
| **Défaut** | `rgba(255,255,255,0.4)` / cœur 0.32 / interne 0.25 | drop-shadow 3px + 10px @ 0.14 | lueur `rgba(34,211,238,0.35)`, cœur `rgba(255,255,255,0.5)`, glow 0.2 |
| **Hover** | blanc plein (0.95/0.8) | 5px @ 0.85 + 16px @ 0.5 + sheen opacité 0.16 | lueur #22d3ee, cœur #ffffff, glow 0.55 |
| **Actif (tab-active)** | `#22d3ee` / cœur `#a5f3fc` / interne `rgba(103,232,249,0.9)` | 6px @ 0.95 + 18px @ 0.55 + 32px @ 0.3 (cyan) | lueur #22d3ee, cœur #ffffff, glow #a5f3fc 0.8 |
| **Disabled** | — | `grayscale(0.6)` + opacité 0.55 | idem |

Règle : au repos l'icône est **assombrie** (bordure moins blanche, glyphe bleu terne) ; la luminosité
revient au survol et au sélectionné.

### Glyphes (9 onglets, centrés, traits adoucis `stroke-linecap/linejoin=round`)

| Onglet | Fichier export | Glyphe |
|---|---|---|
| config | `configuration.svg` | roue crantée (2 cercles r=34/r=12 + 8 dents) |
| historique | `historique.svg` | livre ouvert (contour + arête, sans lignes de texte) |
| fonctions | `fonctions.svg` | clé à molette seule, rotation −38° |
| formatage | `formatage.svg` | chevrons de décodage `</>` |
| persistence | `persistance.svg` | cylindre de base de données |
| links | `liens.svg` | maillon de chaîne (2 anneaux obliques) |
| tasks | `taches.svg` | coche |
| logs | `logs.svg` | document à lignes |
| errors | `erreurs.svg` | croix |

Glyphes supplémentaires (ton **green**, contrôles de run) : `play` = triangle `94,76 94,164 166,120` ;
`pause` = 2 barres **verticales** `| |` (`rect 86,80 22×80 rx6` + `rect 132,80 22×80 rx6`) ;
`stop` = **rond** (`circle cx=120 cy=120 r=38`).

### Note technique — uniformisation des headers de pages robot (2026-11-20)

- **Boutons d'action du header** : tous les boutons d'action des headers de pages robot passent
  par le composant partagé `Button` (`components/UI.tsx`) avec le nouveau prop **`tone`**
  (`indigo | yellow | cyan | green | blue | red`, classes littérales compilées par Tailwind).
  Effets communs : `rounded-md`, `focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900`,
  `transition-colors`, `disabled:opacity-50 disabled:cursor-not-allowed`, `inline-flex`,
  `px-4 py-2 font-semibold text-sm`, plus un **léger halo lumineux** (`shadow-[0_0_12px_rgba(...)]`
  de la couleur du ton, renforcé au survol). La **couleur du robot est respectée via `tone`** :
  BOS=jaune, COM=vert, PHIL=bleu, TIM=rouge, ARCHI=indigo.
  Référence d'origine : bouton « Créer une connexion » de la page Connexions API (COM, `tone="green"`).
- **Bloc « Robot Actuel »** : composant partagé `RobotIndicator` (`components/RobotPageChrome.tsx`),
  affiché dans le header de **toutes** les pages robot, **toujours complètement à droite de la
  ligne** (dernier élément du header). Couleur = couleur du robot : **BOS=jaune, COM=vert,
  PHIL=bleu, TIM=rouge, ARCHI=indigo**.
  Le prop **`robotId` est obligatoire** : il est passé explicitement par chaque page
  (`RobotId.Bos` sur Dashboard/Carte/Gérer vos workflows, `RobotId.Com` sur COM, `RobotId.Phil` sur
  Gestion des Données + Fonctions personnalisées, `RobotId.Tim` sur toutes les pages TIM,
  `RobotId.Archi` sur ARCHI) car le `currentRobotId` du store ne reflète pas forcément la page.
  Nom affiché = nom i18n du robot (`robot_*_name`, dérivé du `robotId`) ;
  `data-testid="robot-indicator"` + `data-robot-color`. Label i18n commun : `current_robot_label`.
  **Nom du robot toujours en gras et majuscules** (affichage unifié sur toutes les pages) :
  `text-sm font-bold uppercase tracking-wide` + couleur du robot.
  Ne pas réintroduire de bloc ad hoc.
- **PhilFunctionsPage** : le badge runtime (`SandboxHealthLoader` : « Runtime dev/test (dev-only) ·
  imports natifs à vérifier… ») n'est PAS dans le header mais **descendu sur la barre des onglets,
  collé à droite** (`ml-auto` dans le conteneur des tabs).

### Note technique — boutons « Gestion des fichiers » et cartes workflow BOS (2026-11-20)

- **Bouton « Gestion des fichiers » identique sur les deux pages BOS** : le modèle est celui de
  « Gérer vos workflows » (`BosWorkflowManagementPage.tsx`) — `<Button variant="outline" tone="yellow">`.
  La page « Carte du workflow » (header passé via `RobotPageRouter.tsx` → `bosMediaHeaderAction` sur
  `WorkflowPage`) utilise **le même** `variant="outline" tone="yellow"` (et non plus `primary`).
  **Au survol, le bouton outline jaune s'illumine** : halo renforcé
  `hover:shadow-[0_0_18px_rgba(234,179,8,0.6)]`, bordure `hover:border-yellow-400`, texte
  `hover:text-yellow-50`, et **fond intérieur en dégradé du jaune de la charte**
  `hover:bg-gradient-to-r hover:from-yellow-400/50 hover:via-yellow-500/25 hover:to-amber-400/40`
  (classes du `outline` `tone="yellow"` dans `components/UI.tsx` ; quand `tone` est posé, le
  `variant="outline"` de base est entièrement remplacé). Au repos : `border-yellow-500/50
  bg-yellow-500/10 text-yellow-100`.
- **Carte workflow (liste, `components/workflow/WorkflowCard.tsx`)** : le bouton au **jaune le plus
  vif est celui du workflow actif**, le **jaune sombre** celui de « Sélectionner par défaut » :
  actif = `!bg-yellow-400 !text-black hover:!bg-yellow-400 disabled:!opacity-100` + halo
  `shadow-[0_0_12px_rgba(250,204,21,0.45)]`, `cursor-default`, disabled ; non actif =
  `!bg-yellow-600 !text-yellow-100 hover:!bg-yellow-500`. Les `!` (important) sont nécessaires :
  sinon les classes du `variant` (`text-gray-200`, `disabled:opacity-50`…) écrasent le className
  selon l'ordre CSS de Tailwind — et le `disabled:opacity-50` rendait l'actif plus terne que le
  « sélectionner » (inversion perçue). Badge « ⭐ Workflow par défaut » : texte `text-yellow-400`.

### Note technique — connexions du canvas workflow : poignées, lasso et edges (2026-11-20)

Contexte : React Flow **11.11.4**, `connectionMode={ConnectionMode.Strict}`, `nodesConnectable`,
`connectOnClick=true` (défaut), `elementsSelectable={false}` (seuls les edges sont sélectionnables,
via `selected: true` posé par l'app).

#### Contrat d'interaction

| Action utilisateur | Résultat attendu |
|---|---|
| Survol d'une poignée | sphère `scale(1.18)`, halo **fort** couleur créateur + cœur blanc (contraste net avec le repos très sombre) |
| Clic / appui sur une poignée | sphère s'illumine **immédiatement** (`:active` + `.connecting`) + **lasso** (fil) entre la poignée et le curseur |
| Lasso actif, survol d'une poignée cible valide | la cible s'allume aussi (`.valid` / `:hover`) |
| Clic / relâcher sur la poignée cible | edge créé ; les deux poignées reviennent au repos (transition 0.3 s) |
| Clic / relâcher ailleurs qu'une poignée | **annulation** : boule éteinte, lasso disparu, aucune edge |
| Survol d'un edge | bleu plus ardent + glow renforcé |
| Clic sur un edge | edge **sélectionné** : bleu plus clair + glow maximal |
| `Suppr` (`Delete`) ou `Backspace` avec un edge sélectionné | edge supprimé |

#### Poignées (sphères lumineuses) — `components/workflow/NodeHandleSphere.tsx` + `index.css`

- Rendu : **SVG inline** enfant du `<Handle className="node-handle">` dans `V2AgentNode.tsx`.
  Contrat `AGENT_NODE_HANDLES` (`components/workflow/connectionContracts.ts`) inchangé côté
  ids/positions : `target-top-left` (`Position.Left`) et `source-top-right` (`Position.Right`),
  `style: { top: -8 }` (⭐ 2026-11-21 : sphère remontée de 8px — elle empiète sur la marge
  au-dessus du node ; sphère de 20px donc 8px dehors / 12px dedans).
- Sphère **20px**, fausse 3D : au repos elle est **extrêmement sombre et de la couleur du robot
  créateur du node** — prop `color` de `NodeHandleSphere` = `getRobotColor(data.robotId).primary`
  (helper exporté de `BaseWorkflowNode.tsx` : BOS violet `#8b5cf6`, COM orange `#f97316`,
  PHIL emerald `#10b981`, TIM amber `#f59e0b`, ARCHI cyan `#06b6d4`). Le dégradé radial est
  calculé à partir de cette couleur en l'assombrissant fortement (⭐ 2026-11-21 : mix noir
  0.5/0.75/0.92, reflet blanc 0.06) + reflet spéculaire 0.1 + anneau 0.1 ; halos via les vars
  CSS inline `--sphere-rest-glow: rgba(couleur, 0.22)` (repos) et
  `--sphere-hover-glow: rgba(couleur, 0.95)` (survol). `useId` pour l'id du dégradé.
- États CSS (`.react-flow__handle.node-handle …`, transition `transform .18s ease, filter .3s ease`) :

  | État | Sélecteur | Rendu |
  |---|---|---|
  | repos | `.node-handle-sphere` | halo `drop-shadow(0 0 1px var(--sphere-rest-glow, rgba(99,102,241,.2)))` — **extrêmement sombre**, couleur créateur (⭐ 2026-11-21 : halo minimal pour contraste net) |
  | survol | `.node-handle:hover .node-handle-sphere` | `scale(1.18)` + double halo `drop-shadow(0 0 10px var(--sphere-hover-glow, couleur créateur @0.95))` + `drop-shadow(0 0 4px rgba(255,255,255,.55))` — **nettement plus lumineux** que le repos (⭐ 2026-11-21) |
  | clic / tracé | `:active`, `.connecting` (+ variantes `:hover`, placées APRÈS, spécificité sup.) | `scale(1.22)` + double halo `12px rgba(199,210,254,1)` + `6px rgba(255,255,255,.9)` |
  | cible atteinte | `.valid` | `10px rgba(165,180,252,1)` + `4px rgba(255,255,255,.8)` |

  Le `:active` garantit l'illumination **dès le mousedown** : en mode drag, RF ne pose
  `.connecting` qu'au premier `mousemove` (ajout impératif dans `onPointerMove`).
- Règles techniques indispensables (pièges RF 11.11.4) :
  - `.react-flow__handle.node-handle { pointer-events: all; cursor: crosshair; }` — la feuille
    RF met `pointer-events: none` sur `.react-flow__handle` par défaut (sauf `.connectionindicator`) ;
  - `.node-handle-sphere, .node-handle-sphere * { pointer-events: none; }` — au mousedown, RF fait
    `doc.elementFromPoint(x, y)` et exige que l'élément touché porte `source`/`target` (posés sur le
    `<Handle>`) ; si le `<svg>`/`<circle>` intercepte le point, `getHandleType()` renvoie `null` et
    **la connexion ne démarre jamais** (aucun lasso).

#### Lasso (fil poignée → curseur)

- **Mode drag** : lasso natif RF restylé — `.react-flow__connectionline .react-flow__connection-path`
  = laser cyan `#22d3ee`, épaisseur 2, `stroke-dasharray: 6 4` animé (keyframes
  `node-handle-lasso-dash`), glow `drop-shadow(0 0 6px rgba(34,211,238,.9))`, spécificité (0,2,0)
  pour battre la règle par défaut gris `#b1b1b7` de `reactflow/dist/style.css`.
  `.react-flow__connectionline { z-index: 1001; pointer-events: none; }`.
- **Mode clic** (`connectOnClick=true`) : RF 11.11.4 ne rend **aucune** ligne dans ce mode
  (`ConnectionLineWrapper` ne lit que `connectionNodeId`, posé uniquement au drag) → le lasso est
  **recréé par l'app** dans `components/WorkflowCanvas.tsx` :
  `onClickConnectStart` mémorise le centre du handle (coordonnées relatives à `canvasRootRef`),
  un `mousemove` window met à jour le curseur, et le fil est rendu dans un **svg overlay sibling
  de `<ReactFlow>`** : `.workflow-click-lasso` (absolute inset-0, `pointer-events:none`,
  `z-index:1002`) + `.workflow-click-lasso-path` (bézier horizontale orientée selon `handleType`
  source/target, même style laser cyan animé, `index.css`). Fin via `onClickConnectEnd`.
- **Annulation** (clic hors poignée) : écoute `mousedown` sur `window` en **capture**
  (`capture: true` — le mousedown du pane est stoppé en propagation par d3-zoom/RF avant d'atteindre
  window en phase bubble) → clic synthétique (`dispatchEvent(new MouseEvent('click', {bubbles:true}))`)
  sur la poignée de départ : le `onClick` de RF, avec `connectionClickStartHandle` set et la même
  poignée, calcule `isValidHandle` = false → annulation propre (`connectionClickStartHandle` cleared
  + `onClickConnectEnd`) ; l'app fait aussi `setClickLasso(null)` → boule éteinte, lasso disparu.

#### Edges (liens établis entre nodes)

- CSS `index.css`, `.react-flow .react-flow__edge-path` (spécificité (0,2,0)+ > RF),
  transition `stroke / stroke-width / filter .15s ease` :

  | État | Sélecteur | Couleur | Épaisseur | Glow |
  |---|---|---|---|---|
  | repos | `.react-flow .react-flow__edge-path` | `#22d3ee` | 2 | `0 0 4px rgba(34,211,238,.55)` |
  | survol | `.react-flow__edge:hover .react-flow__edge-path` | `#38bdf8` | 2.5 | `0 0 9px rgba(56,189,248,.95)` |
  | sélectionné | `.react-flow__edge.selected .react-flow__edge-path` | `#a5f3fc` | 3 | `0 0 14px rgba(165,243,252,1)` + `0 0 5px rgba(255,255,255,.9)` |

- Sélection : `WorkflowCanvas.tsx` — `onEdgeClick` → `setSelectedEdgeId(edge.id)` ;
  `edgesWithSelection` (`useMemo` sur `[edges, selectedEdgeId]`) pose `selected: true` sur l'edge ;
  `handlePaneClick` → `setSelectedEdgeId(null)` (désélection au clic pane).
- Suppression : `deleteKeyCode={['Backspace', 'Delete']}` sur `<ReactFlow>` — le handler global de
  RF supprime les éléments `selected` du store via `onEdgesChange` (change `remove`) ;
  `handleEdgesChange` (wrapper de `onEdgesChange`) clear `selectedEdgeId` quand l'edge est removed.
  Backspace dans un input/textarea reste sans effet (garde RF `actInsideInputWithModifier: false`).

#### Note associée — toolbar de la carte workflow

- Le bloc **RunControls (3 boutons) est placé AVANT** le texte de statut « chargement / X run »
  (`workflow-run-status`) ; les deux blocs ont une largeur fixe (`flex-shrink-0` / `w-32`),
  donc aucun déplacement quand l'état du workflow change.

#### Note associée — fenêtre agrandie d'un node agent (FullscreenChatModal)

- Le bouton **« Supprimer l'agent {agentName} »** (haut droite de la fenêtre agrandie,
  `FullscreenChatModal.tsx`) est **retiré** (recommandation utilisateur : risque d'erreur ;
  la suppression se fait depuis le node sur la carte). Le modal de confirmation et le handler
  restent en place mais ne sont plus déclenchés depuis le header.

### Note technique — modale « Media du workflow » (BosMediaModal, 2026-11-20, taille revue 2026-11-21)

- Modale **encore un peu plus large et beaucoup plus haute** (apercus de fichiers/images lisibles) :
  conteneur `flex h-[95vh] w-full max-w-[88rem] flex-col overflow-hidden` (au lieu de
  `max-h-[85vh] max-w-7xl`) ; apercu image `max-h-[80vh]`, vidéo `max-h-[80vh]`, iframe PDF
  `h-[80vh]` (au lieu de 70vh), conteneur de scroll de l'aperçu `max-h-[80vh]` (au lieu de 55vh).
  Toutes les colonnes tiennent dans le format horizontal (`table-fixed`).
- **Colonne Actions en PREMIERE colonne** (`w-[110px]`) : boutons **icônes seules** (`EyeIcon` /
  `DownloadIcon` / `TrashIcon`, 32×32), intitulés dans une **infobulle standard** `.info-bubble`
  (variante compacte `.info-bubble-sm` : largeur auto, nowrap). `aria-label` = intitulé (pas de
  `title`, règle infobulle). `data-testid="bos-media-action-{preview|download|delete}-<mediaId>"`.
- **Colonne Source à largeur fixe** (`w-[200px]`) : le localisateur est tronqué aux **30 derniers
  caractères** max (`…` + `slice(-30)`, helper `truncateTail`) ; **clic sur la case = sélection du
  texte** (`selectTextOnClick` via `window.getSelection()` + Range). `data-testid="bos-media-source-<mediaId>"`.
- **Header du panneau d'aperçu** (2026-11-21) : le bouton **« Fermer l'aperçu » est placé à
  GAUCHE**, à la place de l'ancien kicker « Aperçu actif » (kicker supprimé) ; à sa droite le titre
  de l'aperçu (nom du fichier, `h3`) puis le type MIME. Le bouton suit la charte boutons :
  composant partagé `Button` (`components/UI.tsx`), `variant="outline" tone="red"` (action de
  fermeture = rouge), `data-testid="bos-media-preview-close"` — plus de style ad hoc.

### Note technique — contrôles de run et infobulles (2026-11-20)

- **Recoloration au survol/clic** : seul le **glyphe central** change de couleur (`.glyph-core` +
  `.glyph-under` + glow du `.neon-glyph`), jamais la bordure ni les reflets de verre. La couleur est
  portée par la variable CSS `--glyph-accent` posée inline sur chaque bouton `.run-control-btn` :
  play → vert pomme `#8DB600`, pause → jaune `#FACC15`, stop → rouge `#EF4444`. Sélecteurs
  `:hover` **et** `:active` (bouton cliqué).
- **Groupement** : les 3 boutons sont rapprochés (`gap-1`) et forment un bloc de largeur fixe
  (`flex-shrink-0`, 3 × `w-10 h-10`) placé à gauche de la toolbar, après l'info de run (`ml-1`),
  avec nom (`w-56`) et statut (`w-32`) à largeur fixe → **aucun déplacement** quand l'état du
  workflow change.
- **Infobulle standard** : classe `.info-bubble` (index.css) = exactement le style de la diode
  « canal temps réel » (fond `gray-900/95`, bordure `gray-700`, largeur **14rem**, `text-xs`,
  ombre, affichage au survol via `.group:hover .info-bubble`). **À utiliser pour toutes les
  infobulles de l'app** — ne JAMAIS remettre d'attribut `title` sur ces éléments : le tooltip
  natif du navigateur s'afficherait en plus de l'infobulle (accessibilité : `aria-label` seul).
  La diode de la toolbar et les 3 boutons run l'utilisent déjà (`.group` sur le parent,
  `.info-bubble` sur la bulle, `data-testid="…-bubble"`). Bulle du bouton play :
  `workflow.runControlsPlay` (« Exécuter le workflow »).

### Tailles

- Master : SVG viewBox **240×240**, fond transparent.
- Affichage dans l'onglet : **40×40 px** (`w-10 h-10`), icône au-dessus du libellé (`flex-col`, `mb-1`).
- Exports : SVG (prioritaire) dans `public/icons/agent-tabs/` ; PNG @1x/@2x/@3x si besoin sur fond transparent.

### Consignes de style

- Formes simplifiées et adoucies, aspect « néon sign » / enseigne lumineuse.
- Centrage parfait, épaisseur de trait cohérente dans toute la série (lueur 6 / cœur 2.4).
- Pas de cercle, pas de chrome lourd, pas de relief 3D, pas de détails superflus.
- Fond toujours transparent ; glassmorphism bleu à opacité 16–32 %.
