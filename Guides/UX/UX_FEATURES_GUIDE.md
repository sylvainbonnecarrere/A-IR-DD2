# Guide UX et Fonctionnalités - A-IR-DD2

> **Objectif** : Référence complète pour comprendre rapidement l'expérience utilisateur, les workflows et les fonctionnalités de l'application.

---

## 🎯 Vue d'ensemble

**A-IR-DD2** est un orchestrateur de workflow multi-agents avec support de multiples LLM. L'interface est conçue avec un style **gaming futuriste** inspiré de Blur Racing (néons cyan/violet, effets laser, animations fluides).

### Vision V2 : Architecture "5 Robots Manufacturiers"

L'application évolue vers un système où **5 robots spécialisés** créent des prototypes pour orchestrer des workflows :

| Robot | Spécialité | Prototypes gérés |
|-------|-----------|------------------|
| **Archi** | Architecture & orchestration | Agents, logique workflow |
| **Bos** | Supervision & monitoring | Debugging, coûts, logs |
| **Com** | Connectivité externe | APIs, authentification, webhooks |
| **Phil** | Transformation de données | Files, parsing, validation |
| **Tim** | Événements & scheduling | Triggers, rate limiting, async |

---

## 🖥️ Structure de l'Interface

### 1. **Sidebar Verticale à Icônes** (V2)

**Objectif** : Maximiser l'espace canvas pour l'éditeur de workflow React Flow.

```
┌─────┐
│  🏠 │  Accueil (non implémenté)
│  🔧 │  Archi → Prototypage
│  👁️ │  Bos → Supervision
│  🔌 │  Com → Connexions
│  📊 │  Phil → Données
│  ⏱️ │  Tim → Événements
└─────┘
```

**Interaction** :
- Hover → Tooltip avec nom du robot (traduit)
- Clic → Affiche sous-menu contextuel (pour Archi) ou page dédiée (autres robots)

#### Archi - Sous-menu Prototypage

Clic sur Archi ouvre un sous-menu flottant :
- **Créer Prototype** → Ouvre `ArchiPrototypingPage`
- **Bibliothèque** → Liste des prototypes existants
- Fermeture : clic extérieur ou bouton X

---

### 2. **Canvas Workflow** (React Flow)

**Zone centrale** : Édition visuelle des workflows avec drag & drop.

#### Nœuds Agents (V2AgentNode)

Chaque agent apparaît comme un **nœud interactif** :

```
┌─────────────────────────────┐
│ 🤖 Agent Name         [−][✕]│  ← Header (drag, minimize, close)
├─────────────────────────────┤
│ 💬 Chat Messages           │  ← Historique conversationnel
│                             │
│ [Image avec overlay hover] │  ← Images avec boutons fullscreen/edit
│                             │
├─────────────────────────────┤
│ [📎] [🖼️] [Input] [Send]   │  ← Mediabar
└─────────────────────────────┘
```

**Capabilities-driven UI** :
- Icône 📎 → visible si `FileUpload` capability
- Icône 🖼️ → visible si `ImageGeneration` OU `ImageModification`
- Bouton Edit (sur image) → visible si `ImageModification`

---

### 3. **Système de Capabilities LLM**

Les fonctionnalités UI s'affichent dynamiquement selon les capabilities de l'agent :

```typescript
enum LLMCapability {
  Chat,                  // Conversation basique
  FileUpload,            // Upload de fichiers
  ImageGeneration,       // Génération d'images via prompt
  ImageModification,     // Édition d'images existantes
  WebSearch,             // Recherche web intégrée
  URLAnalysis,           // Analyse de contenu URL
  FunctionCalling,       // Appel de fonctions/tools
  OutputFormatting,      // JSON structuré, Markdown
  Embedding,             // Génération d'embeddings
  OCR,                   // Reconnaissance optique
  Reasoning,             // Raisonnement avancé (DeepSeek)
  CacheOptimization,     // Cache de prompts (DeepSeek)
  LocalDeployment,       // Déploiement local (LMStudio)
  CodeSpecialization     // Spécialisation code (LMStudio)
}
```

**Règles d'affichage** :
- `ImageGeneration` seule → Bouton "Generate" dans panneau
- `ImageModification` seule → Bouton "Import Image" uniquement
- Les deux → "Import" + "Generate" + "Edit" après génération/import

---

## 🎨 Workflows Utilisateur

### Workflow 1 : Création d'Agent (Prototypage Archi)

1. **Clic sidebar** → Icône Archi (🔧)
2. **Sous-menu** → "Créer Prototype"
3. **Formulaire** (`ArchiPrototypingPage`) :
   - Nom, description, tags
   - **Sélection LLM** → Auto-détecte capabilities disponibles
   - **Prompt système** → Instructions de l'agent
   - **Tools** → Sélection dans whitelist Python
   - **Output Config** → JSON schema (optionnel)
   - **History Config** → Résumé automatique au-delà de limites (tokens/mots/messages)
4. **Validation** → Vérifie `creator_id` (doit être "archi")
5. **Ajout au workflow** → Drag prototype sur canvas

### Workflow 2 : Génération d'Image

**Cas A : Agent avec ImageGeneration**

1. **Clic icône 🖼️** dans mediabar
2. **Panneau ImageGenerationPanel** s'ouvre :
   - Textarea pour prompt
   - Bouton "Generate"
3. **Génération** → Image s'affiche dans panneau
4. **Actions** :
   - "Add to Chat" → Envoie au chat de l'agent
   - "Edit" (si `ImageModification`) → Ouvre panneau modification

**Cas B : Agent avec ImageModification seule**

1. **Clic icône 🖼️** → Panneau s'ouvre SANS textarea
2. **Bouton "Import Image"** uniquement
3. **Import** → Image chargée s'affiche
4. **Actions** :
   - "Add to Chat" → Envoie directement
   - "Edit" → Ouvre panneau modification avec prompt

### Workflow 3 : Modification d'Image

**Depuis panneau génération** :
1. Clic "Edit" → `ImageModificationPanel` s'ouvre
2. Preview image source
3. Textarea prompt (ex: "Rendre l'arrière-plan flou")
4. "Modify" → LLM génère nouvelle version
5. "Add to Chat" → Envoie au chat

**Depuis chat (hover overlay)** :
1. Hover sur image dans message → Overlay apparaît
2. Boutons :
   - **⛶ Fullscreen** (cyan) → Affichage plein écran
   - **✎ Edit** (violet, si capability) → Ouvre panneau modification

### Workflow 4 : Conversation avec Agent

1. **Input texte** dans mediabar
2. **Attachement fichier** (optionnel, si `FileUpload`)
3. **Clic Send** → Message utilisateur ajouté
4. **Streaming LLM** → Réponse apparaît progressivement
5. **Tool calls** (si `FunctionCalling`) :
   - Icône 🔧 sur message
   - Résultat outil affiché en gris

**Gestion historique** (`HistoryConfig`) :
- **Désactivé** → Chaque message est standalone
- **Activé sans limite** → Tout l'historique envoyé
- **Activé avec limites** → Résumé auto si dépassement :
  ```
  Tokens: 500 / Mots: 200 / Messages: 10
  → Résumé généré par LLM
  → Seuls résumé + dernier message envoyés
  ```

---

## 🌐 Système de Traduction (i18n)

### Langues supportées
- 🇫🇷 Français (par défaut)
- 🇬🇧 Anglais
- 🇪🇸 Espagnol
- 🇩🇪 Allemand
- 🇵🇹 Portugais

### Hook d'utilisation
```typescript
const { t, currentLanguage, changeLanguage } = useLocalization();

// Traduction simple
<h1>{t('archi_prototyping_header')}</h1>

// Traduction avec interpolation
<h1>{t('imageGen_title', { agentName: 'GPT-4' })}</h1>
```

### Clés de traduction par domaine

**Navigation** : `robot_archi_name`, `nav_prototyping`, `nav_library`...  
**Archi Prototyping** : `archi_*` (form labels, validation)  
**Tim Events** : `tim_*` (triggers, scheduling)  
**Phil Data** : `phil_*` (transformations, validation)  
**Com Connections** : `com_*` (API, auth)  
**Image Panels** : `imageGen_*`, `imageMod_*`

---

## 🎮 Style Gaming & Animations

### Palette de couleurs

```css
/* Primaires */
--cyan-neon: #00D9FF;      /* Actions, hover states */
--purple-neon: #A855F7;    /* Secondaire, édition */
--gray-dark: #1F2937;      /* Backgrounds */
--gray-light: #D1D5DB;     /* Texte */

/* États */
--success: #10B981;
--error: #EF4444;
--warning: #F59E0B;
```

### Classes réutilisables

**Boutons laser** :
```css
.laser-glow {
  box-shadow: 0 0 10px rgba(0, 217, 255, 0.5);
  transition: all 0.2s;
}
.laser-glow:hover {
  box-shadow: 0 0 20px rgba(0, 217, 255, 0.8);
  transform: scale(1.1);
}
```

**Overlays d'images** :
```css
.group:hover .overlay {
  opacity: 1;
  background: rgba(0, 0, 0, 0.6);
}
```

---

## 📊 Pages Spécialisées des Robots
### Couleurs spécialisées par robot
*   Style : **Cyberpunk/Space** (Fonds `slate-900`, Bordures Néon, Glassmorphism).
**Identité Visuelle du Robot** : La page doit utiliser la couleur d'accentuation du robot concerné :
*   🤖 **Archi** : Cyan (`purple-500`)
*   📊 **Bos** : Jaune  (`yellow-500`)
*   🔌 **Com** : Vert (`green-500`)
*   🧠 **Phil** : Bleu (`cyan-500`)
*   ⏱️ **Tim** : Rouge (`red-500`)


### TimEventsPage
**Gestion des déclencheurs** :
- Manual triggers
- Scheduled (cron)
- Webhooks
- Conditional events

**UI** : Liste + formulaire création avec validations cron.

### PhilDataPage
**Transformations de données** :
- Parsers (JSON, CSV, XML)
- Validators (schemas)
- Formatters (output)

**UI** : Pipelines de transformation visuels.

### ComConnectionsPage
**Gestion APIs externes** :
- OAuth2 flows
- API keys storage
- Rate limiting
- Retry policies

**UI** : Liste connexions + tests endpoints.

---

## 🗺️ Maps Grounding - Guide Complet

### Fonctionnalité

**Maps Grounding** permet aux agents LLM de rechercher des lieux réels avec géolocalisation via Google Maps (Gemini) ou API Arc-LLM.

**Providers supportés** :
- ✅ Gemini (via `generateContentWithSearch` + Google Search tools)
- ✅ Arc-LLM (mock avec données simulées)

### Workflow UX

#### 1. Activation
L'utilisateur clique sur le bouton **🗺️ Maps** dans la toolbar de l'agent (visible si `LLMCapability.MapsGrounding` activée).

#### 2. Panel de Configuration (`MapsGroundingConfigPanel`)
Un **SlideOver** s'ouvre à droite avec :

**Champs** :
- **Requête de recherche** (textarea, requis)
  - Placeholder : "Ex: Restaurants japonais à Paris"
  - Validation : minimum 1 caractère

- **Géolocalisation** (checkbox optionnel)
  - ☑️ Utiliser ma position
  - Bouton "Détecter ma position" → `navigator.geolocation`
  - Champs Latitude/Longitude (modifiables manuellement)
  - Par défaut : Paris (48.8566, 2.3522)

**Exemples suggérés** :
- "Restaurants italiens avec terrasse à Lyon"
- "Pharmacies ouvertes 24h/24 à proximité"
- "Hôtels avec spa et piscine à Marseille"

**Actions** :
- **Annuler** → Ferme le panel
- **🔍 Rechercher** → Lance la recherche Maps

#### 3. Exécution
```typescript
llmService.generateContentWithMaps(
  provider,
  apiKey,
  model,
  query,
  systemInstruction,
  userLocation?: { lat: number; lng: number }
)
```

**Loading** : Message "🗺️ Recherche de lieux..." affiché dans l'agent.

#### 4. Résultats

**Double affichage** :

**A) Dans le chat de l'agent** :
```tsx
<ChatMessage>
  {text}
  <MapsGroundingResults>
    {mapSources.map(place => (
      <PlaceCard>
        <Title>{place.placeTitle}</Title>
        <Coordinates>📍 {lat}, {lng}</Coordinates>
        <Link href={place.uri}>🔗 Voir sur Maps</Link>
      </PlaceCard>
    ))}
  </MapsGroundingResults>
</ChatMessage>
```

**B) Panel SlideOver dédié** (`MapGroundingResultsPanel`) :
- Texte de réponse complète
- Liste détaillée des lieux :
  - Nom du lieu
  - Coordonnées GPS précises (6 décimales)
  - Place ID
  - Extraits d'avis (si disponibles)
  - Lien Google Maps cliquable

#### 5. Interactions
- **Cliquer sur un lieu** → Ouvre Google Maps dans nouvel onglet
- **Fermer le panel** → Résultats restent dans le chat
- **Nouvelle recherche** → Ouvre à nouveau le panel de config

### Structure des Données

#### `MapsGroundingResponse`
```typescript
{
  text: string;               // Réponse textuelle de l'agent
  mapSources: MapSource[];    // Liste des lieux trouvés
}
```

#### `MapSource`
```typescript
{
  uri: string;                          // URL Google Maps
  placeTitle: string;                   // Nom du lieu
  placeId: string;                      // Identifiant Google Places
  coordinates: {
    latitude: number;
    longitude: number;
  };
  reviewExcerpts?: string[];            // Extraits d'avis (optionnel)
}
```

### Gestion d'Erreurs

**Géolocalisation refusée** :
```
⚠️ Erreur géolocalisation: User denied Geolocation
```
→ Fallback : Recherche sans coordonnées (contexte texte uniquement)

**Provider non supporté** :
```
❌ Erreur Maps Grounding: Maps Grounding not supported by OpenAI
```

**API Error** :
```
❌ Erreur Maps Grounding: {error.message}
```

### Exemples d'Usage

**Cas 1 : Recherche locale avec géolocalisation**
```
Requête : "Boulangeries ouvertes maintenant"
Position : 48.8566, 2.3522 (Paris)
Résultat : 5 boulangeries dans un rayon de 2km
```

**Cas 2 : Recherche sans géolocalisation**
```
Requête : "Hôtels 5 étoiles à New York"
Position : Non activée
Résultat : Hôtels à Manhattan (coordonnées extraites du texte)
```

**Cas 3 : Recherche spécifique**
```
Requête : "Restaurants végans avec Wi-Fi gratuit à Lyon"
Position : 45.7640, 4.8357 (Lyon)
Résultat : Restaurants filtrés avec critères
```

### Performance & Optimisation

**Polling** : Aucun (requête unique synchrone)  
**Cache** : Pas de cache côté client (chaque recherche = appel API)  
**Rate limiting** : Géré côté provider (Gemini, Arc-LLM)  
**Timeout** : 30 secondes par défaut

### Accessibilité

- **Keyboard** : Tab navigation, Enter pour submit, Esc pour fermer
- **Screen readers** : Labels aria sur tous les champs
- **Contraste** : Couleurs conformes WCAG AA
- **Focus** : Indicateurs visuels clairs (ring cyan)

---

## 🔒 Sécurité & Gouvernance

### Validation creator_id

Chaque prototype vérifie son créateur :
```typescript
if (prototype.creator_id !== 'archi' && prototype.type === 'agent') {
  throw new Error('Only Archi can create Agent prototypes');
}
```

### Whitelist Python Tools

Seuls les scripts dans `backend/src/config.ts` :
```typescript
const WHITELISTED_PYTHON_TOOLS = [
  'textAnalysis.py',
  'dataProcessing.py',
  'imageProcessing.py'
];
```

### Stockage API Keys

Les clés LLM sont stockées dans `localStorage` (à migrer vers backend sécurisé).

---

## 🚀 Fonctionnalités Avancées

### WebSocket Real-time Sync
- Collaboration multi-utilisateurs (prévu V2)
- Curseurs collaboratifs
- Synchro état workflow

### Fullscreen Chat Mode
- Clic sur icône expand → Modal plein écran
- Historique complet
- Même mediabar que nœud

### Export/Import Workflows
- Sauvegarde JSON des workflows
- Partage entre utilisateurs
- Versioning (prévu)

---

## 📱 Responsive & Accessibilité

### Breakpoints
- Desktop : > 1024px (optimal)
- Tablet : 768px - 1024px (sidebar collapse)
- Mobile : < 768px (non supporté V1)

### ARIA Labels
Tous les boutons iconiques ont `aria-label` :
```tsx
<button aria-label={t('fullscreenModal_close_aria')}>×</button>
```

### Keyboard Navigation
- `Tab` : Navigation entre champs
- `Enter` : Submit forms
- `Esc` : Fermeture modales/panneaux

---

## 🧪 Testing & Validation

### Points de validation UI

**Prototypage Agent** :
- [ ] Nom requis (3+ caractères)
- [ ] LLM sélectionné avec API key
- [ ] System prompt non vide
- [ ] JSON schema valide (si fourni)
- [ ] History limits cohérents (> 0)

**Image Generation** :
- [ ] Prompt requis si ImageGeneration
- [ ] Import fonctionnel si ImageModification
- [ ] Preview affichée après génération/import
- [ ] Boutons conditionnels selon capabilities

**Maps Grounding** (Gemini, Arc-LLM) :
- [ ] Panel de configuration s'ouvre au clic 🗺️
- [ ] Requête de recherche requise
- [ ] Géolocalisation optionnelle (détection auto ou manuelle)
- [ ] Coordonnées GPS affichées (lat/lng)
- [ ] Résultats affichés dans le chat + panel SlideOver
- [ ] Lieux cliquables → ouvrent Google Maps
- [ ] Extraits d'avis affichés si disponibles

**Chat Agent** :
- [ ] Messages streaming affichés progressivement
- [ ] Tool calls identifiables avec icône
- [ ] Scroll auto vers nouveau message
- [ ] Image overlay visible au hover

---

## 🎬 Workflow 5 : Génération de Vidéo (Veo 3.1)

**Prérequis** : Agent avec capability `VideoGeneration` (actuellement Gemini Veo 3.1 uniquement)

### UX Pattern : SlideOver Panel (Droite)

1. **Déclenchement** :
   - Clic sur bouton 🎬 dans mediabar de l'agent
   - **Panel s'ouvre sur la droite** (SlideOver, max-w-md)

2. **Configuration dans VideoGenerationConfigPanel** :
   
   **Sélection du mode** (5 options) :
   - 📝 **Text-to-Video** : Génération basique depuis description textuelle
   - 🖼️ **Image-to-Video** : Anime une image comme première frame
   - 🎞️ **Interpolation** : Génère transition entre 2 frames (first + last)
   - ➕ **Extension** : Continue une vidéo Veo existante (7s increments)
   - 🎨 **With Reference Images** : Utilise jusqu'à 3 images de référence pour le style

   **Inputs conditionnels** (selon mode) :
   - **Prompt** (requis) : Description de la vidéo
     * 💡 Audio cues: Use quotes for dialogue ("Hello"), describe sound effects (thunder crashes), describe ambient (bustling city)
   - **Negative Prompt** (optionnel) : Ce qu'il faut exclure (ex: "cartoon, low quality")
   - **First Frame** (image-to-video, interpolation) : Upload image première frame
   - **Last Frame** (interpolation uniquement) : Upload image dernière frame
   - **Reference Images** (with-references) : Max 3 images pour guider le style/contenu
   
   **Paramètres** :
   - **Resolution** : 720p (défaut) ou 1080p (uniquement 16:9 + 8s)
   - **Aspect Ratio** : 16:9 (landscape) ou 9:16 (portrait)
   - **Duration** : 4s, 6s, ou 8s
   - **Person Generation** : allow_all, allow_adult, dont_allow
   - **Seed** (optionnel) : Améliore déterminisme (légèrement)

3. **Génération** :
   - Clic "🎬 Generate Video"
   - **Validation automatique** :
     * Prompt minimum 3 mots
     * Frames requises selon mode
     * Max 3 reference images
     * Compatibilité résolution/aspect ratio
   - Panel se ferme
   - **Message de progression** apparaît dans chat agent :
     ```
     🎬 Génération en cours...
     "Description du prompt..." (tronquée à 50 char)
     Spinner animé
     ```

4. **Polling asynchrone** :
   - Backend appelle `ai.models.generateVideos()` (opération asynchrone)
   - Frontend polle `pollVideoOperation()` toutes les 10s
   - Message mis à jour avec progression

5. **Résultats** :
   
   **Success** :
   ```
   ✅ Vidéo générée avec succès !
   
   [Player vidéo avec controls natifs]
   [📥 Télécharger] [➕ Prolonger (7s)]
   
   Prompt: "Description complète..."
   ```
   
   **Failed** :
   ```
   ❌ Échec de la génération
   Error: [Message d'erreur]
   Prompt: "Description..."
   ```

6. **Actions post-génération** :
   - **Télécharger** : Download direct de la vidéo
   - **Prolonger** : Ouvre config panel avec mode "Extension" pré-sélectionné (TODO)

### API Pattern (Gemini Veo 3.1)

**Génération** :
```javascript
const result = await llmService.generateVideo(
  LLMProvider.Gemini,
  apiKey, // Ignored, uses process.env.API_KEY
  {
    prompt: "A close up of two people... A man murmurs, 'This must be it.'",
    negativePrompt: "cartoon, drawing, low quality",
    mode: 'text-to-video',
    resolution: '720p',
    aspectRatio: '16:9',
    durationSeconds: 8,
    personGeneration: 'allow_all',
    // Mode-specific fields:
    // firstFrame?: { mimeType, data }
    // lastFrame?: { mimeType, data }
    // referenceImages?: [{ image: {...}, referenceType: 'asset' }]
    // existingVideo?: { uri, operationId }
  }
);
// Returns: { operationId, status: 'PROCESSING', progress: 0 }
```

**Polling** :
```javascript
const status = await llmService.pollVideoOperation(
  LLMProvider.Gemini,
  apiKey,
  operationId
);
// Returns: { operationId, status, progress, videoUrl?, error? }
// status: 'PROCESSING' | 'COMPLETED' | 'FAILED'
```

### Validation Checklist

**Panel Config** :
- [ ] Mode selector avec 5 options
- [ ] Prompt textarea avec placeholder audio cues
- [ ] Negative prompt input (optionnel)
- [ ] First frame upload (conditionnel : image-to-video, interpolation)
- [ ] Last frame upload (conditionnel : interpolation uniquement)
- [ ] Reference images upload (conditionnel : with-references, max 3)
- [ ] Resolution select (720p/1080p)
- [ ] Aspect ratio select (16:9/9:16)
- [ ] Duration select (4s/6s/8s)
- [ ] Person generation select
- [ ] Seed input (optionnel)
- [ ] Validation pré-submit (prompt requis, frames selon mode)
- [ ] Validation compatibilité 1080p (uniquement 16:9 + 8s)

**Intégration V2AgentNode** :
- [ ] Bouton 🎬 visible si capability `VideoGeneration`
- [ ] Bouton ouvre `VideoGenerationConfigPanel` (SlideOver)
- [ ] Callback `handleVideoGeneration(config)` créé message initial
- [ ] Polling `handleVideoPoll()` met à jour message
- [ ] Message affiche statut (processing/completed/failed)
- [ ] Video player natif si completed
- [ ] Bouton télécharger fonctionnel
- [ ] Bouton prolonger présent (TODO: implémentation extension)

**Service Layer** :
- [ ] `geminiService.generateVideo()` appelle `ai.models.generateVideos()`
- [ ] Support tous les paramètres Veo 3.1 (mode, frames, references, negative prompt)
- [ ] `geminiService.pollVideoOperation()` appelle `ai.operations.get()`
- [ ] `llmService.generateVideo()` dispatch vers provider
- [ ] `llmService.pollVideoOperation()` dispatch vers provider

**Types** :
- [ ] `VideoGenerationOptions` avec tous les champs (mode, frames, references, etc.)
- [ ] `ChatMessage.videoGeneration` avec operationId, videoUrl, status, error

**Documentation** :
- [ ] Section dans UX_FEATURES_GUIDE.md avec workflow complet
- [ ] Audio cues guidance (quotes, sound effects, ambient)
- [ ] Mode-specific requirements (frames, references)
- [ ] Resolution compatibility rules (1080p restrictions)

---

## 🎯 Checklist Onboarding Agent IA

Pour comprendre rapidement le système :

1. ✅ Lire `PLAN_JALONS_SYNTHETIQUE.md` (vision globale)
2. ✅ Étudier `types.ts` (contrats de données)
3. ✅ Analyser `robotNavigation.ts` (structure navigation)
4. ✅ Consulter ce guide UX
5. ✅ Lire `ARCHITECTURE_GUIDE.md` (patterns code)
6. ✅ Tester workflow complet : créer agent → ajouter au canvas → chatter → générer image

---

## 📞 Ressources Complémentaires

- **Architecture** : `Guides/ARCHITECTURE_GUIDE.md`
- **Plan jalons** : `documentation/PLAN_JALONS_SYNTHETIQUE.md`
- **Analyse initiale** : `documentation/ANALYSE_INITIALE.md`
- **Spec N8N** : `documentation/N8N_WORKFLOW_EDITOR_SPEC.md`
- **LLM Compatibility** : `documentation/LLM_COMPATIBILITY_REPORT.md`

---

**Dernière mise à jour** : 13 novembre 2025  
**Version** : V2.0 (Transition vers architecture 5 robots)
