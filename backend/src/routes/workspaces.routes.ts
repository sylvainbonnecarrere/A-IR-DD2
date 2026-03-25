import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { UserTool } from '../models/UserTool.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { IUser } from '../models/User.model';
import { RuntimeCompatibilityService } from '../services/runtimeCompatibility.service';
import { createWorkspaceManager } from '../services/workspace/WorkspaceManager';

const router = Router();
const runtimeCompatibilityService = new RuntimeCompatibilityService();
const workspaceManager = createWorkspaceManager();

const idParamSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID doit être un ObjectId MongoDB valide');

router.get('/:workflowId', requireAuth, async (req, res) => {
    try {
        const workflowIdResult = idParamSchema.safeParse(req.params.workflowId);
        if (!workflowIdResult.success) {
            return res.status(400).json({ error: 'workflowId invalide' });
        }

        const user = req.user as IUser;
        const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
        runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);

        const workspace = await workspaceManager.ensureWorkflowWorkspace(user.id, workflowIdResult.data);

        const [toolCount, runCount] = await Promise.all([
            UserTool.countDocuments({ ownerUserId: user.id, workflowId: workflowIdResult.data, scopeType: 'user' }),
            UserToolRun.countDocuments({ ownerUserId: user.id, workflowId: workflowIdResult.data })
        ]);

        res.json({
            workspace: {
                id: workspace.workspaceId,
                logicalRoot: workspace.logicalRoot,
                runtimeRoots: workspace.runtimeRoots,
                manifests: workspace.manifests,
                status: workspace.status,
                lastScanAt: workspace.lastScanAt ?? null,
                workflowId: workflowIdResult.data
            },
            metrics: {
                toolCount,
                runCount
            },
            runtimeCompatibility
        });
    } catch (error) {
        console.error('[WorkspacesRoute] GET /:workflowId error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du workspace' });
    }
});

export default router;