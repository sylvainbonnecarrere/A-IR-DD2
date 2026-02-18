# 📋 PLAN D'IMPLÉMENTATION : TEMPLATES D'AGENTS PERSISTÉS

**Rédigé par**: ARC-1 (Agent IA Architecte)  
**Date**: 18 février 2026  
**Criticité**: 🟠 HAUTE (Fondation du système multi-workflows)  
**Impact Guest Mode**: ✅ AUCUN (Mode guest inchangé)  
**Durée Estimée**: 2-3 semaines

---

## 🎯 VISION GLOBALE

### Contexte Actuel
```
Utilisateur Connecté (1 Workflow)
    ↓
    └── Prototypes d'agents (stockés MongoDB)
            ├── Accessibles uniquement pour ce workflow
            └── Si besoin sur autre workflow → créer à nouveau
    
Utilisateur Invité (Mode démo)
    ↓
    └── Prototypes d'agents (Zustand volatile)
            ├── Perdus au refresh
            └── Pas de persistance
```

### Vision Cible
```
Utilisateur Connecté (N Workflows planifiés)
    ↓
    ├── Prototypes d'agents
    │   ├── 🔒 Liés à une carte de workflow (accessibilité locale)
    │   └── Stockés: MongoDB (AgentPrototype.model.ts)
    │
    ├── Templates d'agents (⭐ NOUVEAU)
    │   ├── 🌍 Communs à TOUS les workflows
    │   ├── 📚 Reusable across all cards
    │   ├── Stockés: MongoDB (AgentTemplate.model.ts ⭐)
    │   └── Accessible via modal "Choisir un template"
    │
    └── Workflow Card 1
        ├── Agents instances
        └── Templates disponibles
        
Utilisateur Invité (Mode démo - INCHANGÉ)
    ↓
    ├── Prototypes d'agents (Zustand volatile + localStorage)
    │   └── Perdus au refresh
    │
    └── Templates d'agents (localStorage)
        └── Perdus au refresh OU login
```

---

## 📊 ANALYSE DÉTAILLÉE DE L'IMPACT SYSTÈME

### 1️⃣ ANALYSE BASE DE DONNÉES

#### État Actuel MongoDB
```
Collection: agent_prototypes
├── userId (FK → User)
├── name
├── role
├── systemPrompt
├── llmProvider / llmModel
├── capabilities[]
├── tools[]
├── outputConfig
├── robotId
├── createdAt
└── updatedAt

Hiérarchie: User → Workflow → AgentInstance (via workflowId)
Limitation: Prototypes NON liés à Workflow (scope: user GLOBAL)
```

#### État Cible MongoDB (⭐ NOUVELLE TABLE)
```
Collection: agent_templates  ⭐ NEW
├── userId (FK → User) 
├── name
├── description
├── category ('assistant' | 'specialist' | 'automation' | 'analysis')
├── robotId
├── icon (emoji)
├── template{
│   ├── name
│   ├── role
│   ├── systemPrompt
│   ├── llmProvider / llmModel
│   ├── capabilities[]
│   ├── tools[]
│   ├── outputConfig
│   └── historyConfig
├── sourcePrototypeId (optional - traçabilité origine)
├── usageCount (statistiques)
├── isStarred (favoris utilisateur)
├── tags[] (organisation)
├── createdAt
└── updatedAt

Schéma: IDENTIQUE à AgentPrototype sauf :
- Pas de liage workflow
- Champ `template{}` (nested)
- Métadonnées supplémentaires
```

### 2️⃣ ANALYSE FRONTEND - STORES & SERVICES

#### État Actuel (localStorage)
```
templateService.ts
├── loadCustomTemplates()  → localStorage
├── saveCustomTemplates()  → localStorage
├── addPrototypeToTemplates() → localStorage UNIQUEMENT
├── deleteCustomTemplate() → localStorage
└── updateCustomTemplate() → localStorage

Limitation: Templates GUEST/INVITÉS uniquement (pas de persistence user)
```

#### État Cible (Hybrid: localStorage + MongoDB)
```
templateService.ts (MODIFIÉ)
├── Mode Guest (isAuthenticated = false)
│   ├── loadCustomTemplates() → localStorage
│   ├── addPrototypeToTemplates() → localStorage
│   └── Comportement EXACT actuel (inchangé)
│
└── Mode Authenticated (isAuthenticated = true)
    ├── loadCustomTemplates() → API backend (/api/agent-templates)
    ├── addPrototypeToTemplates() → API backend
    ├── deleteCustomTemplate() → API backend
    └── updateCustomTemplate() → API backend

templateAPI.ts (⭐ NEW)
├── createTemplate(template, accessToken)
├── fetchTemplates(accessToken)
├── updateTemplate(id, updates, accessToken)
├── deleteTemplate(id, accessToken)
└── starTemplate(id, accessToken)
```

#### État Actuel des Prototypes
```
Prototypes (useDesignStore)
├── Zustand: agents[] (volatile)
├── MongoDB (users connectés): AgentPrototype collection
├── Liés au: User GLOBAL (pas de scope workflow)
└── Accessible: ANY workflow via same work area
```

#### État Cible des Prototypes
```
Prototypes (useDesignStore) - INCHANGÉ pour V1
├── Zustand: agents[] (volatile)
├── MongoDB: AgentPrototype collection (inchangé)
├── Liés au: Workflow (scope local) 
│   ⚠️ À mettre en place lors du jalon "Multi-Workflows"
└── Accessible: CETTE carte uniquement
```

### 3️⃣ ANALYSE FRONTEND - COMPOSANTS UI

#### État Actuel
```
ArchiPrototypingPage.tsx
├── Button: "💾 Ajouter aux Templates"
│   └── Modal: "Ajouter aux Templates"
│       ├── textinput: customName
│       ├── textarea: customDescription
│       └── Button: "Créer le template"
│
└── Button: "Template"
    └── Modal: "Choisir un template de prototype"
        ├── list: templates (prédéfinis + custom)
        ├── search/filter
        └── Button: "Charger"

Limitation: Aucune distinction Guest vs Authenticated
```

#### État Cible (Hybrid)
```
ArchiPrototypingPage.tsx (MODIFIÉ)
├── useAuth() pour détecter mode
│
├── Mode Guest (isAuthenticated = false)
│   ├── Templates: localStorage UNIQUEMENT
│   ├── Comportement: EXACT actuel (inchangé)
│   └── Note: Templates perdus au login
│
└── Mode Authenticated (isAuthenticated = true)
    ├── Templates: MongoDB (chargement API)
    ├── UI: Même modal, source différente
    ├── Persistance: Automatique backend
    ├── Partage: Entre workflows (futur)
    └── Note: Templates survivent logout (liés user)

TemplateSelectionModal.tsx (MODIFIÉ)
├── const { isAuthenticated } = useAuth()
├── useQuery/useMutation pour chargement async
├── Loading state pendant fetch
└── Error handling (API, network)
```

---

## 🏗️ PLAN D'IMPLÉMENTATION PAR COUCHE

### PHASE 1: BACKEND (8-10 jours)

#### **1.1 Modèle MongoDB** ✨ NEW

**Fichier**: `backend/src/models/AgentTemplate.model.ts`

```typescript
import mongoose, { Document, Schema } from 'mongoose';

export interface IAgentTemplate extends Document {
  userId: mongoose.Types.ObjectId;        // FK → User
  name: string;
  description: string;
  category: 'assistant' | 'specialist' | 'automation' | 'analysis';
  robotId: string;                        // Metadata (no restriction)
  icon: string;
  
  // Template data (nested, inchangé structure)
  template: {
    name: string;
    role: string;
    systemPrompt: string;
    llmProvider: string;
    llmModel: string;
    capabilities: string[];
    tools?: any[];
    outputConfig?: any;
    historyConfig?: any;
  };
  
  // Metadata
  sourcePrototypeId?: mongoose.Types.ObjectId;  // Traçabilité
  usageCount: number;                           // Stats
  isStarred: boolean;                           // Favoris
  tags: string[];                               // Organisation
  
  createdAt: Date;
  updatedAt: Date;
}

const AgentTemplateSchema = new Schema<IAgentTemplate>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  category: {
    type: String,
    enum: ['assistant', 'specialist', 'automation', 'analysis'],
    default: 'assistant'
  },
  robotId: {
    type: String,
    required: true,
    enum: ['AR_001', 'BOS_001', 'COM_001', 'PHIL_001', 'TIM_001'],
    index: true
  },
  icon: String,
  
  template: {
    type: {
      name: { type: String, required: true },
      role: { type: String, required: true },
      systemPrompt: { type: String, required: true },
      llmProvider: { type: String, required: true },
      llmModel: { type: String, required: true },
      capabilities: [String],
      tools: [Schema.Types.Mixed],
      outputConfig: Schema.Types.Mixed,
      historyConfig: Schema.Types.Mixed
    },
    required: true
  },
  
  sourcePrototypeId: {
    type: Schema.Types.ObjectId,
    ref: 'AgentPrototype',
    index: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  isStarred: {
    type: Boolean,
    default: false
  },
  tags: [String],
  
}, {
  timestamps: true
});

// Index composés
AgentTemplateSchema.index({ userId: 1, createdAt: -1 });
AgentTemplateSchema.index({ userId: 1, category: 1 });
AgentTemplateSchema.index({ userId: 1, isStarred: 1 });

export const AgentTemplate = mongoose.model<IAgentTemplate>(
  'AgentTemplate', 
  AgentTemplateSchema
);
```

#### **1.2 API Routes** ✨ NEW

**Fichier**: `backend/src/routes/agent-templates.routes.ts`

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOwnership } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { AgentTemplate } from '../models/AgentTemplate.model';

const router = Router();

// Schemas Zod
const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.enum(['assistant', 'specialist', 'automation', 'analysis']),
  robotId: z.enum(['AR_001', 'BOS_001', 'COM_001', 'PHIL_001', 'TIM_001']),
  icon: z.string().optional(),
  template: z.object({
    name: z.string().min(1),
    role: z.string().min(1),
    systemPrompt: z.string().min(1),
    llmProvider: z.string(),
    llmModel: z.string(),
    capabilities: z.array(z.string()),
    tools: z.array(z.any()).optional(),
    outputConfig: z.any().optional(),
    historyConfig: z.any().optional()
  }),
  sourcePrototypeId: z.string().optional(),
  tags: z.array(z.string()).optional()
});

// GET /api/agent-templates
// Récupérer tous les templates utilisateur
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const templates = await AgentTemplate.find({ userId })
      .sort({ createdAt: -1 })
      .lean();
    
    res.json({ success: true, data: templates });
  } catch (error) {
    console.error('[AgentTemplates] GET error:', error);
    res.status(500).json({ success: false, error: 'Erreur fetch templates' });
  }
});

// GET /api/agent-templates/:id
// Récupérer un template spécifique
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const template = await AgentTemplate.findOne({
      _id: req.params.id,
      userId
    });
    
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    
    res.json({ success: true, data: template });
  } catch (error) {
    console.error('[AgentTemplates] GET by ID error:', error);
    res.status(500).json({ success: false, error: 'Erreur fetch template' });
  }
});

// POST /api/agent-templates
// Créer un nouveau template
router.post(
  '/',
  requireAuth,
  validateRequest(createTemplateSchema),
  async (req, res) => {
    try {
      const userId = (req.user as any).id;
      
      const template = new AgentTemplate({
        userId,
        ...req.body
      });
      
      await template.save();
      res.status(201).json({ success: true, data: template });
    } catch (error) {
      console.error('[AgentTemplates] CREATE error:', error);
      res.status(500).json({ success: false, error: 'Erreur création template' });
    }
  }
);

// PUT /api/agent-templates/:id
// Mettre à jour un template
router.put(
  '/:id',
  requireAuth,
  validateRequest(createTemplateSchema.partial()),
  async (req, res) => {
    try {
      const userId = (req.user as any).id;
      
      const template = await AgentTemplate.findOneAndUpdate(
        { _id: req.params.id, userId },
        { $set: req.body },
        { new: true }
      );
      
      if (!template) {
        return res.status(404).json({ success: false, error: 'Template not found' });
      }
      
      res.json({ success: true, data: template });
    } catch (error) {
      console.error('[AgentTemplates] UPDATE error:', error);
      res.status(500).json({ success: false, error: 'Erreur update template' });
    }
  }
);

// DELETE /api/agent-templates/:id
// Supprimer un template
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    
    const template = await AgentTemplate.findOneAndDelete({
      _id: req.params.id,
      userId
    });
    
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    
    res.json({ success: true, message: 'Template supprimé' });
  } catch (error) {
    console.error('[AgentTemplates] DELETE error:', error);
    res.status(500).json({ success: false, error: 'Erreur suppression template' });
  }
});

// PATCH /api/agent-templates/:id/star
// Marquer/démarquer comme favori
router.patch('/:id/star', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const template = await AgentTemplate.findOne({
      _id: req.params.id,
      userId
    });
    
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    
    template.isStarred = !template.isStarred;
    await template.save();
    
    res.json({ success: true, data: template });
  } catch (error) {
    console.error('[AgentTemplates] STAR error:', error);
    res.status(500).json({ success: false, error: 'Erreur star template' });
  }
});

// PATCH /api/agent-templates/:id/usage
// Incrémenter usage count
router.patch('/:id/usage', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const template = await AgentTemplate.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $inc: { usageCount: 1 } },
      { new: true }
    );
    
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    
    res.json({ success: true, data: template });
  } catch (error) {
    console.error('[AgentTemplates] USAGE error:', error);
    res.status(500).json({ success: false, error: 'Erreur update usage' });
  }
});

export default router;
```

#### **1.3 Intégration dans `server.ts`**

Ajouter dans `backend/src/server.ts` :

```typescript
import agentTemplatesRoutes from './routes/agent-templates.routes';

// ... après autres imports

// À ajouter dans le setup des routes
app.use('/api/agent-templates', agentTemplatesRoutes);
```

#### **1.4 Service Métier** ✨ NEW (Optional)

**Fichier**: `backend/src/services/agentTemplateService.ts`

```typescript
import { AgentTemplate, IAgentTemplate } from '../models/AgentTemplate.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import mongoose from 'mongoose';

export class AgentTemplateService {
  /**
   * Créer un template à partir d'un prototype
   */
  static async createFromPrototype(
    userId: mongoose.Types.ObjectId,
    prototypeId: mongoose.Types.ObjectId,
    customName?: string
  ): Promise<IAgentTemplate> {
    const prototype = await AgentPrototype.findOne({
      _id: prototypeId,
      userId
    });
    
    if (!prototype) {
      throw new Error('Prototype not found');
    }
    
    const template = new AgentTemplate({
      userId,
      name: customName || `Template: ${prototype.name}`,
      description: `Créé à partir du prototype "${prototype.name}"`,
      category: 'assistant',
      robotId: prototype.robotId,
      icon: '🔧',
      template: {
        name: prototype.name,
        role: prototype.role,
        systemPrompt: prototype.systemPrompt,
        llmProvider: prototype.llmProvider,
        llmModel: prototype.llmModel,
        capabilities: prototype.capabilities,
        tools: prototype.tools,
        outputConfig: prototype.outputConfig,
        historyConfig: prototype.historyConfig
      },
      sourcePrototypeId: prototypeId
    });
    
    return template.save();
  }

  /**
   * Récupérer templates favoris utilisateur
   */
  static async getStarred(userId: mongoose.Types.ObjectId): Promise<IAgentTemplate[]> {
    return AgentTemplate.find({ userId, isStarred: true })
      .sort({ updatedAt: -1 });
  }

  /**
   * Récupérer templates par catégorie
   */
  static async getByCategory(
    userId: mongoose.Types.ObjectId,
    category: string
  ): Promise<IAgentTemplate[]> {
    return AgentTemplate.find({ userId, category })
      .sort({ usageCount: -1 });
  }

  /**
   * Rechercher templates
   */
  static async search(
    userId: mongoose.Types.ObjectId,
    query: string
  ): Promise<IAgentTemplate[]> {
    return AgentTemplate.find({
      userId,
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { tags: { $in: [new RegExp(query, 'i')] } }
      ]
    });
  }
}
```

---

### PHASE 2: FRONTEND - SERVICES (5-6 jours)

#### **2.1 API Client** ✨ NEW

**Fichier**: `frontend/src/services/templateAPI.ts`

```typescript
/**
 * @file templateAPI.ts
 * @description API client pour templates persistés (MongoDB)
 * @domain Design Domain - Persistence
 * @scope Utilisateurs CONNECTÉS uniquement
 */

import { getBackendUrl } from '../config/api.config';
import { Agent, LLMProvider } from '../types';

const API_BASE = `${getBackendUrl()}/api/agent-templates`;

export interface AgentTemplateDTO {
  _id?: string;
  name: string;
  description: string;
  category: 'assistant' | 'specialist' | 'automation' | 'analysis';
  robotId: string;
  icon: string;
  template: {
    name: string;
    role: string;
    systemPrompt: string;
    llmProvider: string;
    llmModel: string;
    capabilities: string[];
    tools?: any[];
    outputConfig?: any;
    historyConfig?: any;
  };
  sourcePrototypeId?: string;
  usageCount: number;
  isStarred: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Récupérer tous les templates utilisateur
 */
export async function fetchTemplates(accessToken: string): Promise<APIResponse<AgentTemplateDTO[]>> {
  try {
    const response = await fetch(API_BASE, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data: data.data || [] };
  } catch (err) {
    console.error('[templateAPI] Fetch error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Créer un nouveau template
 */
export async function createTemplate(
  template: Omit<AgentTemplateDTO, '_id' | 'createdAt' | 'updatedAt' | 'usageCount'>,
  accessToken: string
): Promise<APIResponse<AgentTemplateDTO>> {
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(template)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data: data.data };
  } catch (err) {
    console.error('[templateAPI] Create error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Mettre à jour un template
 */
export async function updateTemplate(
  templateId: string,
  updates: Partial<AgentTemplateDTO>,
  accessToken: string
): Promise<APIResponse<AgentTemplateDTO>> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data: data.data };
  } catch (err) {
    console.error('[templateAPI] Update error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Supprimer un template
 */
export async function deleteTemplate(
  templateId: string,
  accessToken: string
): Promise<APIResponse<void>> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (err) {
    console.error('[templateAPI] Delete error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Marquer/démarquer template comme favori
 */
export async function toggleTemplateStar(
  templateId: string,
  accessToken: string
): Promise<APIResponse<AgentTemplateDTO>> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}/star`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data: data.data };
  } catch (err) {
    console.error('[templateAPI] Star error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Incrémenter usage count (appelé quand template utilisé)
 */
export async function recordTemplateUsage(
  templateId: string,
  accessToken: string
): Promise<APIResponse<void>> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}/usage`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      return { success: false };
    }

    return { success: true };
  } catch (err) {
    console.error('[templateAPI] Usage record error:', err);
    return { success: false };
  }
}
```

#### **2.2 Service Template Hybrid** (Modified)

**Fichier**: `frontend/src/services/templateService.ts` (MODIFICATIONS)

```typescript
/**
 * TemplateService - Gestion HYBRIDE des templates
 * 
 * Mode Guest: localStorage (comportement actuel - INCHANGÉ)
 * Mode Authenticated: MongoDB API + localStorage fallback
 */

import { Agent, RobotId } from '../types';
import { AgentTemplate, createAgentFromTemplate } from '../data/agentTemplates';
import * as templateAPI from './templateAPI';

const CUSTOM_TEMPLATES_STORAGE_KEY = 'custom_agent_templates';

export interface CustomTemplate extends AgentTemplate {
  isCustom: true;
  sourcePrototypeId?: string;
}

// ============================================
// MODE GUEST (localStorage) - INCHANGÉ
// ============================================

export const loadCustomTemplates = (): CustomTemplate[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY);
    if (!stored) return [];

    return JSON.parse(stored) as CustomTemplate[];
  } catch (error) {
    console.error('[templateService] Guest template load error:', error);
    return [];
  }
};

const saveCustomTemplates = (templates: CustomTemplate[]): boolean => {
  try {
    localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch (error) {
    console.error('[templateService] Guest template save error:', error);
    return false;
  }
};

export const addPrototypeToTemplates = (
  prototype: Agent,
  customName?: string,
  customDescription?: string,
  isAuthenticated: boolean = false,
  accessToken?: string
): CustomTemplate | null => {
  // Mode Guest: localStorage (COMPORTEMENT ACTUEL)
  if (!isAuthenticated) {
    return addPrototypeToTemplatesGuest(prototype, customName, customDescription);
  }
  
  // Mode Authenticated: Sera géré via API dans ArchiPrototypingPage
  // Cette fonction retourne null et l'appel API est fait séparément
  return null;
};

// ============================================
// MODE GUEST HELPERS - INCHANGÉ
// ============================================

function addPrototypeToTemplatesGuest(
  prototype: Agent,
  customName?: string,
  customDescription?: string
): CustomTemplate | null {
  try {
    if (!prototype || !prototype.id) {
      console.error('Prototype invalide');
      return null;
    }

    const existingTemplates = loadCustomTemplates();
    const existingIndex = existingTemplates.findIndex(t => t.sourcePrototypeId === prototype.id);

    if (existingIndex !== -1) {
      console.warn('Un template existe déjà pour ce prototype');
      return null;
    }

    const category: CustomTemplate['category'] = determineCategory(prototype.role, prototype.systemPrompt);
    const icon = determineIcon(prototype.name, prototype.role);

    const newTemplate: CustomTemplate = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: customName || `Template: ${prototype.name}`,
      description: customDescription || `Template créé depuis le prototype "${prototype.name}"`,
      category,
      robotId: prototype.creator_id || RobotId.Archi,
      icon,
      isCustom: true,
      sourcePrototypeId: prototype.id,
      template: {
        name: prototype.name,
        role: prototype.role,
        systemPrompt: prototype.systemPrompt,
        llmProvider: prototype.llmProvider,
        model: prototype.model,
        capabilities: [...prototype.capabilities],
        tools: prototype.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: JSON.parse(JSON.stringify(tool.parameters))
        })),
        outputConfig: { ...prototype.outputConfig },
        historyConfig: prototype.historyConfig ? { ...prototype.historyConfig } : undefined as any
      }
    };

    const updatedTemplates = [...existingTemplates, newTemplate];
    const saved = saveCustomTemplates(updatedTemplates);

    if (!saved) {
      console.error('Échec sauvegarde template');
      return null;
    }

    return newTemplate;
  } catch (error) {
    console.error('[templateService] Guest add error:', error);
    return null;
  }
}

export const deleteCustomTemplate = (templateId: string, isAuthenticated: boolean = false): boolean => {
  if (!isAuthenticated) {
    return deleteCustomTemplateGuest(templateId);
  }
  // API call handled elsewhere
  return false;
};

function deleteCustomTemplateGuest(templateId: string): boolean {
  try {
    const templates = loadCustomTemplates();
    const filteredTemplates = templates.filter(t => t.id !== templateId);

    if (templates.length === filteredTemplates.length) {
      console.warn('Template non trouvé');
      return false;
    }

    return saveCustomTemplates(filteredTemplates);
  } catch (error) {
    console.error('[templateService] Guest delete error:', error);
    return false;
  }
}

// ============================================
// Utilities
// ============================================

function determineCategory(
  role: string,
  systemPrompt: string
): 'assistant' | 'specialist' | 'automation' | 'analysis' {
  const combined = `${role} ${systemPrompt}`.toLowerCase();
  
  if (combined.includes('analyst') || combined.includes('analysis')) {
    return 'analysis';
  } else if (combined.includes('automat')) {
    return 'automation';
  } else if (combined.includes('specialist') || combined.includes('expert')) {
    return 'specialist';
  }
  return 'assistant';
}

function determineIcon(name: string, role: string): string {
  const combined = `${name} ${role}`.toLowerCase();
  
  if (combined.includes('code') || combined.includes('developer')) return '👨‍💻';
  if (combined.includes('writer') || combined.includes('content')) return '✍️';
  if (combined.includes('analyst') || combined.includes('data')) return '📊';
  if (combined.includes('design')) return '🎨';
  if (combined.includes('test')) return '🧪';
  return '🤖';
}
```

---

### PHASE 3: FRONTEND - COMPOSANTS UI & MODALES (5-6 jours)

#### **3.1 Modification ArchiPrototypingPage.tsx**

Section clé à ajouter dans `components/ArchiPrototypingPage.tsx`:

```typescript
// === À la racine du composant, près des autres imports ===
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as templateAPI from '../services/templateAPI';

// === Dans le composant, ajouter ces hooks ===
const { isAuthenticated, accessToken } = useAuth();
const queryClient = useQueryClient();

// Query: Charger templates utilisateur (mode authenticated)
const { data: userTemplates = [], isLoading: templatesLoading } = useQuery({
  queryKey: ['user-templates'],
  queryFn: async () => {
    if (!isAuthenticated || !accessToken) return [];
    const result = await templateAPI.fetchTemplates(accessToken);
    return result.success ? result.data || [] : [];
  },
  enabled: isAuthenticated && !!accessToken,
  staleTime: 5 * 60 * 1000 // 5 min cache
});

// Mutation: Créer template
const createTemplateMutation = useMutation({
  mutationFn: async (newTemplate: any) => {
    if (!accessToken) throw new Error('Not authenticated');
    const result = await templateAPI.createTemplate(newTemplate, accessToken);
    if (!result.success) throw new Error(result.error || 'Failed to create template');
    return result.data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['user-templates'] });
    addNotification({
      type: 'success',
      title: t('template_created_title'),
      message: t('template_created_success', { agentName: agentToAddAsTemplate?.name || 'Template' })
    });
  },
  onError: (error: any) => {
    addNotification({
      type: 'error',
      title: t('template_creation_error_title'),
      message: error.message | t('template_creation_failed')
    });
  }
});

// === Modifier le handler "Ajouter aux Templates" ===
const handleAddToTemplates = async (template: Agent) => {
  setAgentToAddAsTemplate(template);
  setAddToTemplatesOpen(true);
};

// === Ajouter handler de création template ===
const handleCreateTemplate = async (
  template: Agent,
  customName: string,
  customDescription: string
) => {
  if (!isAuthenticated || !accessToken) {
    // Mode guest: localStorage
    const result = addPrototypeToTemplates(template, customName, customDescription, false);
    if (result) {
      addNotification({
        type: 'success',
        title: t('template_created_title'),
        message: t('template_created_success', { agentName: template.name })
      });
    } else {
      addNotification({
        type: 'error',
        title: t('template_creation_error_title'),
        message: t('template_creation_failed')
      });
    }
  } else {
    // Mode authenticated: API
    const newTemplate = {
      name: customName || template.name,
      description: customDescription,
      category: 'assistant' as const,
      robotId: template.creator_id,
      icon: '🔧',
      template: {
        name: template.name,
        role: template.role,
        systemPrompt: template.systemPrompt,
        llmProvider: template.llmProvider,
        llmModel: template.model,
        capabilities: template.capabilities,
        tools: template.tools,
        outputConfig: template.outputConfig,
        historyConfig: template.historyConfig
      },
      sourcePrototypeId: template.id,
      tags: []
    };
    
    createTemplateMutation.mutate(newTemplate);
  }

  setAddToTemplatesOpen(false);
  setAgentToAddAsTemplate(null);
};
```

#### **3.2 Modification TemplateSelectionModal.tsx** ✨ HYBRID

**File**: `components/modals/TemplateSelectionModal.tsx` (MODIFICATIONS)

```typescript
import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import * as templateAPI from '../../services/templateAPI';
import { loadCustomTemplates, CustomTemplate } from '../../services/templateService';
import { getAgentTemplatesFromConfig } from '../../data/agentTemplates';
import { Agent, LLMConfig } from '../../types';
import { Button, Input } from '../UI';
import { useLocalization } from '../../hooks/useLocalization';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: any) => void;
  llmConfigs: LLMConfig[];
}

export const TemplateSelectionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSelectTemplate,
  llmConfigs
}) => {
  const { t } = useLocalization();
  const { isAuthenticated, accessToken } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');

  // Prebuilt templates
  const builtinTemplates = getAgentTemplatesFromConfig(llmConfigs);

  // Guest mode: localStorage templates
  const guestTemplates = loadCustomTemplates();

  // Authenticated mode: MongoDB templates via API
  const { data: mongoTemplates = [], isLoading } = useQuery({
    queryKey: ['user-templates'],
    queryFn: async () => {
      if (!isAuthenticated || !accessToken) return [];
      const result = await templateAPI.fetchTemplates(accessToken);
      return result.success ? result.data || [] : [];
    },
    enabled: isAuthenticated && !!accessToken
  });

  // Merge templates based on auth mode
  const allTemplates = useMemo(() => {
    if (isAuthenticated) {
      // Mode authenticated: builtin + MongoDB
      return [
        ...builtinTemplates,
        ...mongoTemplates.map(t => ({
          id: t._id || t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          robotId: t.robotId,
          icon: t.icon || '🔧',
          isCustom: true,
          template: t.template
        }))
      ];
    } else {
      // Mode guest: builtin + localStorage
      return [
        ...builtinTemplates,
        ...guestTemplates
      ];
    }
  }, [isAuthenticated, builtinTemplates, mongoTemplates, guestTemplates]);

  // Filtered templates
  const filteredTemplates = useMemo(() => {
    if (!searchQuery) return allTemplates;

    const query = searchQuery.toLowerCase();
    return allTemplates.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query)
    );
  }, [allTemplates, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>{t('button_load_template')}</h2>

        {/* Search */}
        <Input
          type="text"
          placeholder={t('search_templates')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ marginBottom: '1rem' }}
        />

        {/* Loading state */}
        {isLoading && <p>{t('loading')}</p>}

        {/* Templates list */}
        <div className="templates-list">
          {filteredTemplates.length === 0 ? (
            <p>{t('no_templates_found')}</p>
          ) : (
            filteredTemplates.map(template => (
              <div key={template.id} className="template-item">
                <div className="template-info">
                  <span className="template-icon">{template.icon}</span>
                  <div>
                    <h4>{template.name}</h4>
                    <p>{template.description}</p>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    onSelectTemplate(template);
                    onClose();
                  }}
                >
                  {t('load')}
                </Button>
              </div>
            ))
          )}
        </div>

        <Button onClick={onClose} variant="secondary">
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
};
```

---

## 🔐 RÉGRESSION & SÉCURITÉ

### Matrices de Non-Régression

#### Mode Guest (Utilisateurs Invités)
```
AVANT (État actuel):
✅ Templates en localStorage
✅ Templates perdus au refresh
✅ Bouton "Ajouter aux Templates"
✅ Modal "Choisir un template"

APRÈS (Avec implémentation):
✅ Templates en localStorage (INCHANGÉ)
✅ Comportement EXACT identique
✅ Bouton "Ajouter aux Templates" (idem)
✅ Modal "Choisir un template" (idem)
✅ Templates perdus au refresh (INCHANGÉ)

RISQUE: ⚠️ Lors du login → templates localStorage PERDUS
MITIGATION: Notification utilisateur + suggestion de créer templates dans account
```

#### Mode Authenticated (Utilisateurs Connectés)
```
AVANT (État actuel):
❌ Templates NOT persistis (localStorage uniquement)
✅ Prototypes persistis (MongoDB)

APRÈS (Avec implémentation):
✅ Templates persistis (MongoDB)
✅ Prototypes persistis (MongoDB) - INCHANGÉ
✅ Buttons/Modals conservés - idem UX
✅ Workflows inchangés - V1 toujours 1:1
```

### Checklist de Validation

**Backend**:
- [ ] Model AgentTemplate créé + migrations
- [ ] Routes CRUD implémentées
- [ ] Auth middleware validé (`requireAuth`)
- [ ] Ownership validation testé
- [ ] Index MongoDB créés (perf)
- [ ] Tests unitaires (CRUD, auth, ownership)
- [ ] Tests d'intégration (API flow)

**Frontend**:
- [ ] templateAPI.ts implémenté + tests
- [ ] templateService.ts hybrid (Guest + Auth)
- [ ] ArchiPrototypingPage modifiée
- [ ] TemplateSelectionModal hybrid
- [ ] React Query hooks intégrés
- [ ] Loading/error states gérés
- [ ] localStorage Guest mode INCHANGÉ

**Régression**:
- [ ] Mode Guest: Templates localStorage OK
- [ ] Mode Guest: Buttons/Modals OK
- [ ] Prototypes workflow: persistance OK
- [ ] Chat agent: exécution OK
- [ ] Canvas: interactions OK

---

## 📅 JALONS & LIVRABLES

### Jalon 1: Backend Modèle + Routes (Days 1-4)
**Livrables**:
- ✅ AgentTemplate.model.ts
- ✅ agent-templates.routes.ts
- ✅ Integration server.ts
- ✅ Tests backend (Jest)

### Jalon 2: Frontend Services & API Client (Days 5-8)
**Livrables**:
- ✅ templateAPI.ts
- ✅ templateService.ts (Hybrid)
- ✅ Unit tests

### Jalon 3: UI Components & Modales (Days 9-12)
**Livrables**:
- ✅ ArchiPrototypingPage modifications
- ✅ TemplateSelectionModal hybrid
- ✅ React Query integration
- ✅ Component tests

### Jalon 4: QA & Releases (Days 13-14+)
**Livrables**:
- ✅ E2E tests (Playwright/Cypress)
- ✅ Non-régression tests
- ✅ Security audit
- ✅ Production deployment

---

## 🎯 SUCCESS METRICS

- ✅ Utilisateurs authentifiés peuvent créer templates persistés (MongoDB)
- ✅ Templates accessibles sur tous les workflows futurs
- ✅ Utilisateurs invités: templates localStorage INCHANGÉ
- ✅ 0 régressions en mode guest
- ✅ Load API templates < 500ms
- ✅ Create template < 1s

---

## 📌 NOTES ARCHITECTURALES

### Domain Driven Design
```
Design Domain (Persistance):
├── Prototypes (Global - User scope, local future Workflow scope)
├── Templates (Global - User scope, reusable across workflows)
└── Metadata (Icons, categories, tags, usage stats)

Runtime Domain:
├── Agent Instances (Local - Workflow scope, execution)
├── Chat Messages (Persistence)
└── Execution State
```

### SOLID Principles
```
S - Single Responsibility: 
  ✅ templateAPI.ts: API calls only
  ✅ templateService.ts: Business logic (Guest/Auth switch)
  ✅ AgentTemplate.model: Data model

O - Open/Closed:
  ✅ AgentTemplateSchema: Extensible metadata

L - Liskov Substitution:
  ✅ CustomTemplate extends AgentTemplate

I - Interface Segregation:
  ✅ AgentTemplateDTO: Only needed fields in API

D - Dependency Inversion:
  ✅ ArchiPrototypingPage depends on abstractions (templateAPI, templateService)
```

---

## 🔄 VERSION CONTROL & COMMITS

### Commit Strategy
```
feat(backend): add AgentTemplate model and routes
  - MongoDB schema with indexes
  - CRUD endpoints (/api/agent-templates)
  - Ownership validation
  
feat(frontend): add hybrid template service
  - Guest mode: localStorage (unchanged)
  - Auth mode: MongoDB API
  - Backward compatibility: prebuilt templates
  
feat(ui): update ArchiPrototypingPage templates
  - React Query integration
  - Loading/error states
  - User feedback (toast notifications)
  
test: add e2e tests for template persistence
  - Guest mode regression
  - Auth mode CRUD
  - Multi-template scenarios
```

---

## 📚 RÉFÉRENCES EXISTANTES

**Fichiers clés existants**:
- `types.ts`: Agent interface (inchangé pour V1)
- `data/agentTemplates.ts`: Prebuilt templates
- `services/templateService.ts`: Actuel (à modifier)
- `services/agentPrototypeAPI.ts`: Pattern existant
- `backend/src/models/AgentPrototype.model.ts`: Pattern Mongoose
- `backend/src/routes/agent-prototypes.routes.ts`: Pattern routes

**Patterns à réutiliser**:
- JWT auth middleware (`backend/src/middleware/auth.middleware.ts`)
- API validation (`backend/src/middleware/validation.middleware.ts`)
- Zod schemas (voir auth.routes.ts)
- React Query hooks (UserSettings example)
- Zustand store pattern (useDesignStore.ts)
