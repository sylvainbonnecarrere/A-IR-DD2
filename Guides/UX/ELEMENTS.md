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
  Ne pas réintroduire de bloc ad hoc.
- **PhilFunctionsPage** : le badge runtime (`SandboxHealthLoader` : « Runtime dev/test (dev-only) ·
  imports natifs à vérifier… ») n'est PAS dans le header mais **descendu sur la barre des onglets,
  collé à droite** (`ml-auto` dans le conteneur des tabs).

### Note technique — poignées de connexion des nodes agent (2026-11-20)

- Rendu : `NodeHandleSphere` (`components/workflow/NodeHandleSphere.tsx`), **SVG inline** rendu
  en enfant du `<Handle>` React Flow (classe `node-handle`) ; le contrat `AGENT_NODE_HANDLES`
  (ids/positions) est inchangé.
- Sphère **20px**, fausse 3D : dégradé radial **violet tirant sur le bleu, sombre au repos**
  (indigo Archi) `#818cf8 → #6366f1 → #4338ca → #1e1b4b` + reflet spéculaire blanc atténué
  (0.55) + anneau `#a5b4fc` (0.3).
- États (CSS `index.css`, `.react-flow__handle.node-handle …`) :
  repos → sphère **très sombre**, halo à peine visible `2px rgba(99,102,241,.28)` ;
  **:hover** → `scale(1.18)` + halo `8px rgba(129,140,248,.95)` (luminosité retrouvée) ;
  **:active** (mousedown) **et** **`.connecting`** (classe posée par React Flow pendant le tracé,
  y compris en mode clic `clickConnecting`) → `scale(1.22)` + halo fort blanc/indigo clair
  (`12px rgba(199,210,254,1)` + `6px rgba(255,255,255,.9)`). Le `:active` garantit l'illumination
  **dès le clic**, même si la souris ne bouge pas (RF ne pose `.connecting` qu'au 1er mousemove
  en mode drag) ; les règles fortes sont placées après le `:hover` avec sélecteurs
  `.connecting:hover` / `:active:hover` (spécificité supérieure) pour primer sur le survol.
  `.valid` (cible atteinte pendant le tracé) → halo fort : la poignée cible s'allume au clic,
  puis les deux reviennent au repos (transition 0.3 s) quand l'edge est créé.
- Le `<Handle>` a `pointer-events: all` + `cursor: crosshair` (la feuille de style React Flow
  met `pointer-events: none` sur `.react-flow__handle` par défaut, sauf `.connectionindicator`).
- **Le SVG de la sphère a `pointer-events: none`** (`.node-handle-sphere, .node-handle-sphere *`) :
  au mousedown, React Flow fait `doc.elementFromPoint(x, y)` et exige que l'élément touché porte
  les classes `source`/`target` (posées sur le `<Handle>`) — si le `<svg>`/`<circle>` intercepte
  le point, `getHandleType()` renvoie null et **la connexion ne démarre jamais** (pas de lasso).
- **Lasso de connexion restauré** : `.react-flow__connectionline .react-flow__connection-path`
  restylé en laser cyan `#22d3ee` (épaisseur 2, glow drop-shadow, tirets animés
  `stroke-dasharray: 6 4` + keyframes), spécificité (0,2,0) pour battre la règle par défaut
  gris `#b1b1b7` de `reactflow/dist/style.css`.
- **Lasso du mode clic recréé par l'app** (`WorkflowCanvas.tsx`) : RF 11.11.4 avec
  `connectOnClick=true` (défaut) ne rend **aucune** ligne en mode clic (le wrapper ne lit que
  `connectionNodeId`, posé au drag). Le canvas trace donc lui-même le fil poignée→curseur :
  `onClickConnectStart` mémorise le centre du handle (coord. conteneur) + `mousemove` window
  met à jour la souris + svg overlay `.workflow-click-lasso` (bézier horizontale, laser cyan
  animé, `index.css`). Fin : `onClickConnectEnd` (2e clic sur une poignée).
  **Annulation** (clic ailleurs qu'une poignée) : écoute `mousedown` window en **capture**
  (`capture: true` — le mousedown du pane est stoppé en propagation par d3-zoom avant window en
  bubble) → clic synthétique sur la poignée de départ (que le `onClick` de RF traite comme une
  annulation : même handle = invalide) + `setClickLasso(null)` → boule éteinte, lasso disparu.
- Toolbar carte workflow : le bloc **RunControls (3 boutons) est placé AVANT** le texte de statut
  « chargement / X run » (`workflow-run-status`) ; les deux blocs ont une largeur fixe
  (`flex-shrink-0` / `w-32`), donc aucun déplacement quand l'état change.


### Note technique — edges (liens) du canvas workflow (2026-11-20)

- Style de base (CSS `index.css`, `.react-flow .react-flow__edge-path`, spécificité > RF) :
  **cyan lumineux** `#22d3ee`, épaisseur 2, léger glow `drop-shadow(0 0 4px rgba(34,211,238,.55))`.
- **Survol** (`.react-flow__edge:hover …`) : bleu plus ardent `#38bdf8`, épaisseur 2.5,
  glow `0 0 9px rgba(56,189,248,.95)`.
- **Sélectionné** (clic sur l'edge → `.react-flow__edge.selected …`) : bleu encore plus clair
  `#a5f3fc`, épaisseur 3, glow maximal (double drop-shadow blanc/cyan clair).
- Sélection : `WorkflowCanvas.tsx` pose `selected: true` sur l'edge cliqué (`onEdgeClick` +
  `edgesWithSelection`, mémoïsé) ; `elementsSelectable` reste `false` (les nodes ne sont pas
  sélectionnables, on ne gère que les edges). Clic sur le pane → désélection.
- **Suppression** : `deleteKeyCode={['Backspace', 'Delete']}` — RF supprime les éléments
  `selected` du store via `onEdgesChange` (remove) ; `handleEdgesChange` clear alors
  `selectedEdgeId`. Backspace dans un input/textarea reste sans effet (garde RF
  `actInsideInputWithModifier: false`).
### Note technique — modale « Media du workflow » (BosMediaModal, 2026-11-20)

- Modale **plus large** : `max-w-7xl` (au lieu de `max-w-5xl`), toutes les colonnes tiennent dans
  le format horizontal (`table-fixed`).
- **Colonne Actions en PREMIERE colonne** (`w-[110px]`) : boutons **icônes seules** (`EyeIcon` /
  `DownloadIcon` / `TrashIcon`, 32×32), intitulés dans une **infobulle standard** `.info-bubble`
  (variante compacte `.info-bubble-sm` : largeur auto, nowrap). `aria-label` = intitulé (pas de
  `title`, règle infobulle). `data-testid="bos-media-action-{preview|download|delete}-<mediaId>"`.
- **Colonne Source à largeur fixe** (`w-[200px]`) : le localisateur est tronqué aux **30 derniers
  caractères** max (`…` + `slice(-30)`, helper `truncateTail`) ; **clic sur la case = sélection du
  texte** (`selectTextOnClick` via `window.getSelection()` + Range). `data-testid="bos-media-source-<mediaId>"`.

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
