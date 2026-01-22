# Guide de Design pour l'Application Workflow Agentique

## 1. Introduction et Contexte Général
- **Description de l'Application** : Application desktop pour workflow agentique ludique, novateur et moderne. Facile à prendre en main, elle guide l'utilisateur à travers des flux interactifs de manière gamifiée et intuitive, favorisant l'exploration et la productivité sans surcharge cognitive. L'interface immersive renforce le sentiment de progression et d'accomplissement.
- **Objectifs du Design** : Créer une UX/UI splendide, attractive et hors du commun. Fusionner une énergie dynamique (néons vifs mais maîtrisés, effets lumineux subtils) avec un aspect futuriste spatial apaisant (espace infini, calme immuable). Prioriser la sobriété : les effets visuels guident sans distraire ni assommer l'utilisateur.
- **Plateforme Cible** : Desktop PC uniquement (Windows/Mac/Linux). Pas d'optimisation mobile (écrans trop petits pour la complexité du workflow). Responsivité obligatoire pour tailles d'écrans PC variées.

## 2. Références Visuelles Principales
- **Style Dynamique et Énergique** :
  - Interfaces slick et high-energy avec néons électriques (bleus intenses, rouges vifs, accents jaunes glow).
  - Reflets métalliques futuristes sur éléments interactifs (effet chrome poli, brillant).
  - Halos lumineux subtils (glow bleu laser ou néon) sur focus/hover/clic.
  - Effets de blur dynamique pour transitions et mouvements, simulant fluidité et vitesse sans excès.
  - Micro-interactions engageantes : trails lumineux sur drag, particules néon sur validation, light beams pour actions clés.
  - Tout reste sobre et efficace : effets servent uniquement à guider et à rendre l'expérience addictive.

- **Twist Futuriste Spatial** :
  - Fond cosmique apaisant (noirs profonds, gradients stellaires subtils, si demandées ajouter des reflets métal ou des étoiles discrètes).
  - Éléments holographiques : overlays laser, faisceaux lumineux, halos glowy inspirés d'interfaces spatiales high-tech.
  - Vue "galactique" pour la map du workflow : nœuds comme étoiles/constellations, connexions comme nébuleuses fluides.
  - Équilibre : énergie dynamique des néons + calme immuable de l'espace pour une immersion sereine et motivante.

- **Fusion Globale** : Reflets métalliques et lasers dynamiques sur fond spatial. Exemple : bouton focus = halo laser glow + reflet chrome sur gradient cosmique.

## 3. Principes de Design Visuel
- **Palette de Couleurs** :
  - Primaire : Bleu électrique néon (#00BFFF) pour accents futuristes et focus.
  - Secondaire : Rouge néon (#FF4500) pour actions/alertes, Jaune glow (#FFD700) pour highlights.
  - Neutres : Gris métallique (#A9A9A9 avec reflets), Noir cosmique (#000814) pour fonds apaisants.
  - Modes : Sombre (cosmique dominant) et Clair (fond subtil avec néons atténués). Utiliser hex pour précision.
- **Typographie** :
  - Principale : Font futuriste lisible (ex. Orbitron, Exo 2) pour titres et accents.
  - Secondaire : Font sobre et moderne (ex. Montserrat, Inter) pour textes corps.
  - Tailles scalables (rem/em) pour responsivité.
- **Icônes et Éléments Graphiques** :
  - Style vectoriel minimaliste avec reflets métalliques, glows et contours laser.
  - Animations : Scale + glow sur hover, fade-in avec blur subtil, trails sur mouvements.
- **Layouts Généraux** :
  - Dashboard central comme "carte galactique" interactive.
  - Sidebars fluides avec slide-in néon.
  - 60% espace négatif pour sobriété, 40% éléments interactifs avec effets ciblés.

## 4. Guidelines UX (Expérience Utilisateur)
- **Flux Utilisateur** :
  - Onboarding ludique et progressif.
  - Progression gamifiée : niveaux spatiaux, badges glowy, connexions visuelles fluides.
  - Intuitivité : auto-suggestions avec halos, feedback visuel immédiat (laser pulse sur succès).
  - Minimiser frictions : Fitts' Law (éléments larges/proches), gestures (drag pour lier tâches).
- **Immersion et Feedback** :
  - Micro-sons (laser subtils si demandé pour l'implémentation uniquement).
  - Personnalisation : thèmes "énergie" vs "espace calme".
- **Accessibilité** :
  - Contrastes WCAG, alternatives textuelles, support clavier complet.

## 5. Responsivité et Contraintes Techniques
- **Responsivité PC uniquement** :
  - Breakpoints :
    - Small (laptops 1024–1440px) : Layout compact, sidebars pliables.
    - Medium (1440–1920px) : Espacements équilibrés, map élargie.
    - Large/Ultrawide (>1920px) : Multi-colonnes, parallax spatial amplifié.
  - Techniques : Media queries, flex/grid, scalable units.
- **Performance** : Effets optimisés (CSS/WebGL si web). Pas de lag sur PC mid-range.
- **Outils** : Figma pour prototypes, Electron/React pour implémentation.

## 6. Règles Strictes
- Cohérence absolue avec ce guide.
- Prioriser sobriété et efficacité : effets = guidage, pas distraction.
- Design modulaire pour évolutions futures.