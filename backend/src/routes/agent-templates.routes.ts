import { Router } from 'express';
import { z } from 'zod';
import { AgentTemplate } from '../models/AgentTemplate.model';
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { IUser } from '../models/User.model';

const router = Router();

// ============================================
// ZOD VALIDATION SCHEMAS
// ============================================

/**
 * Schema pour création de template
 * Tous les champs requis sauf description, icon, sourcePrototypeId, tags
 */
const createAgentTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.enum(['assistant', 'specialist', 'automation', 'analysis']),
  robotId: z.enum(['AR_001', 'BOS_001', 'COM_001', 'PHIL_001', 'TIM_001']),
  icon: z.string().optional(),
  sourcePrototypeId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  template: z.object({
    name: z.string().min(1),
    role: z.string().min(1),
    systemPrompt: z.string().min(1),
    llmProvider: z.string().min(1),
    llmModel: z.string().min(1),
    capabilities: z.array(z.string()),
    tools: z.array(z.any()).optional(),
    outputConfig: z.any().optional(),
    historyConfig: z.any().optional()
  })
});

/**
 * Schema pour mise à jour de template
 * Tous les champs optionnels (partial update)
 */
const updateAgentTemplateSchema = createAgentTemplateSchema.partial();

// ============================================
// 1️⃣ GET /api/agent-templates - List All Templates
// ============================================
/**
 * Récupère tous les templates de l'utilisateur connecté
 * Supporte filtering (category, isStarred, search), pagination, sorting
 * Query params: category, isStarred, search, limit, skip, sortBy, sortOrder
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.user as IUser;
    const {
      category,
      isStarred,
      search,
      limit = '10',
      skip = '0',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build MongoDB query
    const query: any = { userId: user.id };

    // Filter: category
    if (category && typeof category === 'string') {
      query.category = category;
    }

    // Filter: isStarred
    if (isStarred !== undefined) {
      query.isStarred = isStarred === 'true';
    }

    // Filter: search (name, description, tags)
    if (search && typeof search === 'string') {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Parse pagination params with safety limits
    const pageSize = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const offset = Math.max(0, parseInt(skip as string) || 0);

    // Build sort object
    const sort: any = {};
    const sortField = (sortBy as string) || 'createdAt';
    const sortDir = sortOrder === 'asc' ? 1 : -1;
    sort[sortField] = sortDir;

    // Execute query
    const total = await AgentTemplate.countDocuments(query);
    const templates = await AgentTemplate.find(query)
      .sort(sort)
      .limit(pageSize)
      .skip(offset)
      .lean();

    res.json({
      success: true,
      data: templates,
      meta: {
        total,
        limit: pageSize,
        skip: offset
      }
    });
  } catch (error) {
    console.error('[AgentTemplates] GET error:', error);
    res.status(500).json({ success: false, error: 'Erreur récupération templates' });
  }
});

// ============================================
// 2️⃣ GET /api/agent-templates/:id - Get Single Template
// ============================================
/**
 * Récupère UN template spécifique (ownership validé)
 */
router.get('/:id',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const template = await AgentTemplate.findById(req.params.id);
    return template ? template.userId.toString() : null;
  }),
  async (req, res) => {
    try {
      const template = await AgentTemplate.findById(req.params.id);

      if (!template) {
        return res.status(404).json({ success: false, error: 'Template not found' });
      }

      res.json({ success: true, data: template });
    } catch (error) {
      console.error('[AgentTemplates] GET/:id error:', error);
      res.status(500).json({ success: false, error: 'Erreur récupération template' });
    }
  }
);

// ============================================
// 3️⃣ POST /api/agent-templates - Create Template
// ============================================
/**
 * Crée un nouveau template pour l'utilisateur connecté
 * Assigne automatiquement userId, usageCount (0), isStarred (false)
 */
router.post('/',
  requireAuth,
  validateRequest(createAgentTemplateSchema),
  async (req, res) => {
    try {
      const user = req.user as IUser;

      const template = new AgentTemplate({
        userId: user.id,
        usageCount: 0,
        isStarred: false,
        ...req.body
      });

      await template.save();

      res.status(201).json({ success: true, data: template });
    } catch (error) {
      console.error('[AgentTemplates] POST error:', error);
      res.status(500).json({ success: false, error: 'Erreur création template' });
    }
  }
);

// ============================================
// 4️⃣ PUT /api/agent-templates/:id - Update Template
// ============================================
/**
 * Met à jour UN template (ownership validé)
 * Empêche modification userId (sécurité)
 * Permet partial updates (tous les champs optionnels)
 */
router.put('/:id',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const template = await AgentTemplate.findById(req.params.id);
    return template ? template.userId.toString() : null;
  }),
  validateRequest(updateAgentTemplateSchema),
  async (req, res) => {
    try {
      const user = req.user as IUser;

      // Sécurité: empêcher modification userId
      delete req.body.userId;

      const template = await AgentTemplate.findOneAndUpdate(
        { _id: req.params.id, userId: user.id },
        { $set: req.body },
        { new: true }
      );

      if (!template) {
        return res.status(404).json({ success: false, error: 'Template not found' });
      }

      res.json({ success: true, data: template });
    } catch (error) {
      console.error('[AgentTemplates] PUT error:', error);
      res.status(500).json({ success: false, error: 'Erreur mise à jour template' });
    }
  }
);

// ============================================
// 5️⃣ DELETE /api/agent-templates/:id - Delete Template
// ============================================
/**
 * Supprime UN template (ownership validé)
 * Hard delete - pas de soft delete, pas de cascades
 */
router.delete('/:id',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const template = await AgentTemplate.findById(req.params.id);
    return template ? template.userId.toString() : null;
  }),
  async (req, res) => {
    try {
      const user = req.user as IUser;

      const template = await AgentTemplate.findOneAndDelete({
        _id: req.params.id,
        userId: user.id
      });

      if (!template) {
        return res.status(404).json({ success: false, error: 'Template not found' });
      }

      res.json({ success: true, message: 'Template supprimé avec succès' });
    } catch (error) {
      console.error('[AgentTemplates] DELETE error:', error);
      res.status(500).json({ success: false, error: 'Erreur suppression template' });
    }
  }
);

// ============================================
// 6️⃣ PATCH /api/agent-templates/:id/star - Toggle Star
// ============================================
/**
 * Toggle isStarred (true <-> false) sur un template
 * Utilise atomicité MongoDB (findOneAndUpdate avec $set)
 */
router.patch('/:id/star',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const template = await AgentTemplate.findById(req.params.id);
    return template ? template.userId.toString() : null;
  }),
  async (req, res) => {
    try {
      const user = req.user as IUser;

      // Fetch current state
      const template = await AgentTemplate.findOne({
        _id: req.params.id,
        userId: user.id
      });

      if (!template) {
        return res.status(404).json({ success: false, error: 'Template not found' });
      }

      // Toggle
      template.isStarred = !template.isStarred;
      await template.save();

      res.json({ success: true, data: template });
    } catch (error) {
      console.error('[AgentTemplates] STAR error:', error);
      res.status(500).json({ success: false, error: 'Erreur star/unstar template' });
    }
  }
);

// ============================================
// 7️⃣ PATCH /api/agent-templates/:id/usage - Increment Usage Count
// ============================================
/**
 * Incrémenter usageCount atomiquement quand un template est utilisé
 * Utilise MongoDB $inc operator pour atomicité
 */
router.patch('/:id/usage',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const template = await AgentTemplate.findById(req.params.id);
    return template ? template.userId.toString() : null;
  }),
  async (req, res) => {
    try {
      const user = req.user as IUser;

      const template = await AgentTemplate.findOneAndUpdate(
        { _id: req.params.id, userId: user.id },
        { $inc: { usageCount: 1 } },
        { new: true }
      );

      if (!template) {
        return res.status(404).json({ success: false, error: 'Template not found' });
      }

      res.json({ success: true, data: template });
    } catch (error) {
      console.error('[AgentTemplates] USAGE error:', error);
      res.status(500).json({ success: false, error: 'Erreur update usage count' });
    }
  }
);

// ============================================
// EXPORT
// ============================================

export default router;
