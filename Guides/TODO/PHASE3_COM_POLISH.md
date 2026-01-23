# Phase 3 - Finalisation POCs COM (Corrections Visuelles & Interactivité)

## 🎯 Objectif Principal
Finaliser les POCs du robot COM en corrigeant la charte graphique (VERT, non bleu) et en implémentant des fonctionnalités d'interaction avancées pour les pages Connexions API et Bases de Données.

---

## ⚠️ BLOC 1: CORRECTION PRIORITAIRE - Identité Visuelle COM

**Contexte**: Le robot COM doit être associé à la couleur VERT (`green-500` / `emerald-500`), non bleu.

### 1.1 Mettre à jour IconSidebar.tsx - Couleur COM
**File**: `components/IconSidebar.tsx` + `components/IconMenuItem.tsx`
**Action**: 
- Modifier le colorMap pour COM: remplacer `cyan` par `green`/`emerald`
- Icône menu ouvert: `text-green-400` (au lieu de cyan-400)
- Icône page active: `text-white` + `bg-green-600` (au lieu de cyan-600)
- Shadow glow: `shadow-green-500/30` (au lieu de cyan-500/30)

**Files à modifier**:
- `components/IconMenuItem.tsx` (colorMap)

**Status**: ⬜ NOT STARTED

---

### 1.2 Mettre à jour ComApiPage.tsx - Couleurs vertes
**File**: `components/ComApiPage.tsx`
**Actions**:
- Header: "Créer une connexion" button gradient → `from-green-600 to-emerald-600` (au lieu de cyan)
- COM badge background: `bg-green-500/20` border `border-green-500/30` text `text-green-300/100`
- All cyan accents (bordures, glow) → green equivalents
- Hover states pour boutons: `hover:from-green-500 hover:to-emerald-500`
- Icon colors dans sections: ElectricPlugIcon → `text-green-400`

**Search patterns**:
- `from-cyan-600 to-blue-600` → `from-green-600 to-emerald-600`
- `cyan-500` → `green-500`
- `cyan-600` → `green-600`
- `cyan-400` → `green-400`
- `border-cyan-500` → `border-green-500`
- `focus:border-cyan-500` → `focus:border-green-500`
- `shadow-cyan-500/50` → `shadow-green-500/50`
- `text-cyan-2xx` → `text-green-2xx`
- `hover:from-cyan-500` → `hover:from-green-500`
- `hover:to-blue-500` → `hover:to-emerald-500`

**Status**: ⬜ NOT STARTED

---

### 1.3 Mettre à jour ComDatabasesPage.tsx - Couleurs vertes
**File**: `components/ComDatabasesPage.tsx`
**Actions**: Même pattern que ComApiPage
- Header button gradients → green
- COM badge → green
- Border, shadows, hover states → green
- Icons → green accents

**Status**: ⬜ NOT STARTED

---

## 📊 BLOC 2: FONCTIONNALITÉS - ComApiPage.tsx

### 2.1 Colonne Gauche - Interactivité et Edit
**File**: `components/ComApiPage.tsx` (ou nouveau sous-composant `ApiConnectionListItem.tsx`)
**Actions**:
1. **Rendre les blocs cliquables**:
   - Au clic sur un bloc: charger les détails dans la colonne droite (setState selectedConnectionId)
   - Ajouter visual feedback: highlight border, background color change

2. **Ajouter bouton Edit (crayon) dans le header**:
   - Icon: PencilIcon ou EditIcon (ajouter à Icons.tsx si manquant)
   - Position: Top-right du bloc
   - Action: Mode édition - précharger les données du formulaire

3. **Connection Status Display**:
   - Icon visual (● pour connected, ✗ pour disconnected, ⟳ pour testing)
   - Intégrer avec la liste existante

**Sub-components à créer**:
- `ApiConnectionListItem.tsx`: Item individuel avec edit button
- Exporter depuis ComApiPage.tsx

**Dependencies**:
- Icônes: PencilIcon (créer si absent)
- Icons.tsx

**Status**: ⬜ NOT STARTED

---

### 2.2 Colonne Droite - Visualisation Résultats (Response Viewer)
**File**: `components/ComApiPage.tsx` (ou nouveau `JsonResultViewer.tsx`)
**Actions**:
1. **Lors du test**: Afficher la réponse dans zone dédiée avec 3 onglets

2. **3 Onglets de Visualisation**:
   
   a) **Objet (Tree View)**:
      - Component: `JsonTreeViewer.tsx`
      - Affiche JSON expandable/collapsible
      - Syntax highlighting (key colors, value types)
      - Ex: `{ "users": [...], "count": 2 }`
   
   b) **Tableau (Grid View)**:
      - Component: `JsonTableViewer.tsx`
      - Si array d'objets: affiche grille avec colonnes
      - Scrollable horizontalement
      - Trier colonnes (optionnel pour POC)
   
   c) **Schéma (Schema View)**:
      - Component: `JsonSchemaViewer.tsx`
      - Affiche structure des types: `{ "users": "Array<Object>", "count": "Number" }`
      - Hiérarchique avec indentation

3. **Intégration dans Response Section**:
   - Remplacer le texte brut JSON par le viewer avec onglets
   - Header: Badges (Status 200, Time 245ms, Size 1.2KB)
   - Tab navigation
   - Réutilisable et standalone

**Sub-components à créer**:
- `JsonResultViewer.tsx`: Wrapper avec onglets
- `JsonTreeViewer.tsx`: Vue arborescente
- `JsonTableViewer.tsx`: Vue grille
- `JsonSchemaViewer.tsx`: Vue schéma

**Status**: ⬜ NOT STARTED

---

### 2.3 Onglet Body (Formulaire) - Editor multi-vues
**File**: `components/ComApiPage.tsx`
**Actions**:
1. **Remplacer le textarea simple par un éditeur multi-vues**:
   - 3 onglets identiques à la response (Objet/Tableau/Schéma)
   - Onglet "Objet": Tree editor visual (ou JSON editor avec syntax highlight)
   - Onglet "Tableau": Form fields pour entrer un array d'objets
   - Onglet "Schéma": Vue schéma (read-only ou assistant)

2. **Component réutilisable**:
   - `TabbedDataEditor.tsx`: Wrapper avec 3 onglets
   - Peut être utilisé pour Body, pour Response, etc.

**Sub-components**:
- `TabbedDataEditor.tsx`: Wrapper
- Réutiliser: JsonTreeViewer, JsonTableViewer, JsonSchemaViewer
- Ajouter: JsonEditor.tsx (textarea avec syntax coloring)

**Status**: ⬜ NOT STARTED

---

## 📊 BLOC 3: FONCTIONNALITÉS - ComDatabasesPage.tsx

### 3.1 Colonne Gauche - Interactivité et Edit
**File**: `components/ComDatabasesPage.tsx` (ou `DatabaseListItem.tsx`)
**Actions**:
1. **Rendre les blocs cliquables**:
   - Au clic: charger config correspondante dans colonne droite
   - Visual feedback: highlight, background change

2. **Ajouter bouton Edit (crayon)**:
   - Position: Top-right du bloc
   - Action: Déclencher mode édition du formulaire

3. **Status Indicator**:
   - Visuel cohérent avec ComApiPage
   - Connected/Disconnected/Testing states

**Sub-components**:
- `DatabaseListItem.tsx`: Item avec edit button
- Exporter depuis ComDatabasesPage.tsx

**Status**: ⬜ NOT STARTED

---

### 3.2 Colonne Droite - Pré-charge Config au Clic
**File**: `components/ComDatabasesPage.tsx`
**Actions**:
1. **Au clic sur un bloc**: Pré-charger les données du formulaire
2. **Au clic Edit**: Passer en mode édition
3. **Afficher nom du nœud sélectionné**: Dans le header du formulaire

**Status**: ⬜ NOT STARTED

---

## 🧩 BLOC 4: COMPOSANTS RÉUTILISABLES (Architecture SOLID)

### 4.1 Créer Composants de Visualisation JSON
**Files à créer**:
```
components/
├── JsonResultViewer.tsx      // Wrapper principal avec onglets
├── JsonTreeViewer.tsx        // Vue arborescente (Tree)
├── JsonTableViewer.tsx       // Vue grille (Table)
├── JsonSchemaViewer.tsx      // Vue schéma (Schema)
├── JsonEditor.tsx            // Textarea avec syntax highlight (optionnel)
└── TabbedDataEditor.tsx      // Wrapper pour Body input avec onglets
```

### 4.2 Créer Composants de Liste (List Items)
**Files à créer**:
```
components/
├── ApiConnectionListItem.tsx    // Item pour liste connexions
└── DatabaseListItem.tsx         // Item pour liste BDD
```

### 4.3 Exigences par Component

**JsonResultViewer.tsx**:
- Props: `data: any, isLoading: boolean, error?: string`
- Render: Header (status badges) + Tabs + Content
- Valide JSON ou message d'erreur

**JsonTreeViewer.tsx**:
- Props: `data: any`
- Expandable/collapsible nodes
- Syntax coloring (keys, strings, numbers, etc.)

**JsonTableViewer.tsx**:
- Props: `data: any`
- Si Array<Object>: tableau avec colonnes
- Si non-array: message "Not a list"
- Scrollable

**JsonSchemaViewer.tsx**:
- Props: `data: any`
- Infer structure: `{ key: typeof(value) }`
- Hiérarchique

**TabbedDataEditor.tsx**:
- Props: `value: string, onChange: (value: string) => void`
- 3 onglets: Tree Edit, Table Edit, Schema View
- Synchronise état entre onglets

**ApiConnectionListItem.tsx**:
- Props: `connection: ApiConnection, isSelected: boolean, onSelect: () => void, onEdit: () => void, onDelete: () => void`
- Rendre cliquable
- Edit button
- Status indicator

**DatabaseListItem.tsx**:
- Props: `node: DatabaseNode, isSelected: boolean, onSelect: () => void, onEdit: () => void, onDelete: () => void`
- Même pattern que ApiConnectionListItem

**Status**: ⬜ NOT STARTED

---

## 🧹 BLOC 5: CODE PROPRE & QUALITÉ

### 5.1 Code Cleanup
**Actions**:
- [ ] Supprimer tous les `console.log()` de debug
- [ ] Supprimer code mort (fonctions/variables inutilisées)
- [ ] Vérifier nommage des variables (explicite)
- [ ] Simplifier logique complexe
- [ ] Ajouter commentaires pour sections critiques

**Checklist par fichier**:
- [ ] ComApiPage.tsx: Cleanup + couleurs
- [ ] ComDatabasesPage.tsx: Cleanup + couleurs
- [ ] IconMenuItem.tsx: Cleanup + couleurs
- [ ] Nouveaux composants: Clean first time

**Status**: ⬜ NOT STARTED

---

### 5.2 Validation TypeScript
**Actions**:
- [ ] Vérifier 0 erreurs TypeScript
- [ ] Vérifier tous les types sont explicites (pas de `any` si possible)
- [ ] Vérifier props interfaces sont complètes

**Command**: `npx tsc --noEmit`

**Status**: ⬜ NOT STARTED

---

### 5.3 Validation React
**Actions**:
- [ ] Pas de warnings: clés manquantes dans listes
- [ ] Pas de warnings: dépendances useEffect incomplètes
- [ ] Vérifier callbacks sont stables (useCallback si nécessaire)

**Command**: Ouvrir DevTools, Console tab

**Status**: ⬜ NOT STARTED

---

### 5.4 i18n Keys - Complétude
**Actions**:
- [ ] Vérifier tous les nouveaux textes ont clés dans `i18n/fr.ts`
- [ ] Pas de textes hardcodés en JSX
- [ ] Clés sont bien nommées (format snake_case)

**Clés à ajouter** (exemple):
```typescript
// JsonResultViewer
json_viewer_tab_tree: 'Objet',
json_viewer_tab_table: 'Tableau',
json_viewer_tab_schema: 'Schéma',
json_not_available: 'Données non disponibles',

// ComApiPage
api_connection_edit_button: 'Modifier',
api_connection_delete_button: 'Supprimer',
api_test_results: 'Résultats du test',

// etc.
```

**Status**: ⬜ NOT STARTED

---

## ✅ BLOC 6: VALIDATION FINALE

### 6.1 Checklist de Déploiement
- [ ] **Navigation**: Sidebar et Header restent accessibles
- [ ] **Scroll**: Contenu scrollable sur petits écrans
- [ ] **Traductions**: Tous les textes via `t('key')`
- [ ] **Couleurs**: COM = vert partout (sidebar, pages, boutons)
- [ ] **Feedback**: Actions donnent retour visuel (toast, loader)
- [ ] **Interactivité**: Clics, edits, tests fonctionnent
- [ ] **TypeScript**: 0 erreurs
- [ ] **React**: 0 warnings
- [ ] **Code Quality**: Pas de console.log, code propre
- [ ] **Responsive**: Fonctionne sur petit écran (w<768px)

### 6.2 Tests Manuels
**Scénarios**:
1. Ouvrir ComApiPage
   - [ ] Clic sur connexion → détails chargés
   - [ ] Clic Edit → formulaire prérempli
   - [ ] Test → résultats affichés avec 3 onglets
   - [ ] Modifier Body → 3 onglets éditables

2. Ouvrir ComDatabasesPage
   - [ ] Clic sur BDD → config chargée
   - [ ] Clic Edit → formulaire prérempli
   - [ ] Colors = green partout

3. Sidebar
   - [ ] COM icon = vert
   - [ ] Menu open → green icon on gray bg
   - [ ] Page active → white icon on green bg

### 6.3 Audits
- [ ] Lighthouse: Performance, Accessibility
- [ ] WCAG: Contrast ratios (vert suffisamment visible)
- [ ] Bundle size: Pas de croissance excessive

**Status**: ⬜ NOT STARTED

---

## 📋 RÉSUMÉ DES LIVRABLES

**Files à modifier**:
1. ✏️ `components/IconMenuItem.tsx` - Couleur COM
2. ✏️ `components/ComApiPage.tsx` - Couleurs + Interactivité
3. ✏️ `components/ComDatabasesPage.tsx` - Couleurs + Interactivité
4. ✏️ `i18n/fr.ts` - Nouvelles clés i18n

**Files à créer**:
1. 🆕 `components/JsonResultViewer.tsx`
2. 🆕 `components/JsonTreeViewer.tsx`
3. 🆕 `components/JsonTableViewer.tsx`
4. 🆕 `components/JsonSchemaViewer.tsx`
5. 🆕 `components/TabbedDataEditor.tsx`
6. 🆕 `components/ApiConnectionListItem.tsx`
7. 🆕 `components/DatabaseListItem.tsx`

**Total**: 7 fichiers modifiés + 7 fichiers créés = **14 fichiers touchés**

---

## 🎯 SUCCESS CRITERIA

✅ **Phase 3 - Réussie quand**:
- All files compiled with 0 TypeScript errors
- All UI colors use green for COM
- API page: List interactive, Edit button works, 3-tab result viewer works
- Database page: List interactive, Edit button works, colors are green
- Sidebar: COM icon is green with correct states
- No React warnings (keys, dependencies, etc.)
- No console.log left
- All text via i18n
- Tests manuels passent all checkboxes

**Estimated effort**: 8-10 hours
**Priority**: BLOCKER pour Phase 4 (Production)

---

**Status**: 🟡 IN PLANNING → 🟠 IN PROGRESS → 🟢 DONE
