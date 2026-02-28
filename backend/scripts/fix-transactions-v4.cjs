/**
 * fix-transactions-v4.cjs
 * 
 * Script de correction directe sur disque pour workflows.routes.ts
 * Supprime les transactions MongoDB des 3 routes (POST, DELETE, SELECT)
 * car MongoDB standalone ne supporte pas les transactions.
 * 
 * Approche : remplacement 1:1 de chaque section avec le code sans transaction.
 * Même logique métier, juste sans session/startSession/commitTransaction/abortTransaction.
 */
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'src', 'routes', 'workflows.routes.ts');

console.log('[fix-transactions-v4] Reading file from disk...');
let content = fs.readFileSync(FILE_PATH, 'utf8');
const originalLength = content.length;

// ============================================================================
// FIX 1: POST /api/workflows - Remove transactions
// ============================================================================
const POST_OLD = `// POST /api/workflows - Créer nouveau workflow
router.post('/', requireAuth, validateRequest(createWorkflowSchema), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user = req.user as IUser;
        const userId = user._id.toString();

        console.log(\`[Workflows POST] Creating workflow for user: \${userId}\`);

        // ⭐ Use repository to count existing workflows (SOLID)
        const existingCount = await Workflow.countDocuments({ userId }).session(session);
        const isFirstWorkflow = existingCount === 0;

        // ⭐ Create workflow via repository
        const newWorkflow = new Workflow({
            userId,
            name: req.body.name,
            description: req.body.description,
            isActive: isFirstWorkflow,
            isDefault: isFirstWorkflow,
            isDirty: false,
            canvasState: {
                zoom: 1,
                panX: 0,
                panY: 0
            }
        });

        await newWorkflow.save({ session });
        console.log(\`[Workflows POST] Created workflow: \${newWorkflow._id}\`);

        // ⭐ Sync User record - if first workflow, set as default
        if (isFirstWorkflow) {
            await User.findByIdAndUpdate(
                userId,
                {
                    $set: {
                        defaultWorkflowId: newWorkflow._id,
                        workflowCount: 1,
                        lastActiveWorkflowId: newWorkflow._id
                    }
                },
                { session, new: true }
            );
            console.log(\`[Workflows POST] First workflow - User updated with defaultWorkflowId\`);
        } else {
            // Just increment count
            await User.findByIdAndUpdate(
                userId,
                { $inc: { workflowCount: 1 } },
                { session }
            );
        }

        await session.commitTransaction();
        res.status(201).json(newWorkflow);

    } catch (error) {
        await session.abortTransaction();
        console.error('[Workflows POST] Error:', error);
        res.status(500).json({ error: 'Erreur création workflow', details: error instanceof Error ? error.message : String(error) });
    } finally {
        await session.endSession();
    }
});`;

const POST_NEW = `// POST /api/workflows - Créer nouveau workflow
// ⭐ V4 FIX: Transactions retirées (MongoDB standalone ne supporte pas les transactions)
// Opérations séquentielles suffisantes — self-healing corrige les incohérences éventuelles
router.post('/', requireAuth, validateRequest(createWorkflowSchema), async (req, res) => {
    try {
        const user = req.user as IUser;
        const userId = user._id.toString();

        console.log(\`[Workflows POST] Creating workflow for user: \${userId}\`);

        // ⭐ Count existing workflows
        const existingCount = await Workflow.countDocuments({ userId });
        const isFirstWorkflow = existingCount === 0;

        // ⭐ Create workflow
        const newWorkflow = new Workflow({
            userId,
            name: req.body.name,
            description: req.body.description,
            isActive: isFirstWorkflow,
            isDefault: isFirstWorkflow,
            isDirty: false,
            canvasState: {
                zoom: 1,
                panX: 0,
                panY: 0
            }
        });

        await newWorkflow.save();
        console.log(\`[Workflows POST] Created workflow: \${newWorkflow._id}\`);

        // ⭐ Sync User record - if first workflow, set as default
        if (isFirstWorkflow) {
            await User.findByIdAndUpdate(
                userId,
                {
                    $set: {
                        defaultWorkflowId: newWorkflow._id,
                        workflowCount: 1,
                        lastActiveWorkflowId: newWorkflow._id
                    }
                },
                { new: true }
            );
            console.log(\`[Workflows POST] First workflow - User updated with defaultWorkflowId\`);
        } else {
            // Just increment count
            await User.findByIdAndUpdate(
                userId,
                { $inc: { workflowCount: 1 } }
            );
        }

        res.status(201).json(newWorkflow);
        
    } catch (error) {
        console.error('[Workflows POST] Error:', error);
        res.status(500).json({ error: 'Erreur création workflow', details: error instanceof Error ? error.message : String(error) });
    }
});`;

// ============================================================================
// FIX 2: DELETE /api/workflows/:id - Remove transactions
// ============================================================================
const DELETE_OLD = `// DELETE /api/workflows/:id - Supprimer workflow (cascade atomique)
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const user = req.user as IUser;

            // ⭐ PHASE 1: Fetch workflow within transaction
            const workflow = await Workflow.findOne({
                _id: req.params.id,
                userId: user.id
            }).session(session);

            if (!workflow) {
                await session.abortTransaction();
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // ⭐ PHASE 1: Check if this is the last workflow
            const otherWorkflowCount = await Workflow.countDocuments({
                userId: user.id,
                _id: { $ne: workflow.id }
            }).session(session);

            if (otherWorkflowCount === 0) {
                await session.abortTransaction();
                return res.status(400).json({
                    error: 'Impossible de supprimer le seul workflow',
                    code: 'LAST_WORKFLOW',
                    message: 'Chaque utilisateur doit avoir au moins un workflow'
                });
            }

            // ⭐ PHASE 1: ATOMIC CASCADE DELETE
            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;
            const AgentJournal = require('../models/AgentJournal.model').AgentJournal;

            const deletionResults = await Promise.all([
                // Delete related data
                AgentInstance.deleteMany({ workflowId: workflow.id }, { session }),
                WorkflowEdge.deleteMany({ workflowId: workflow.id }, { session }),
                WorkflowNodeV2.deleteMany({ workflowId: workflow.id }, { session }),
                AgentJournal.deleteMany({ workflowId: workflow.id }, { session }),
                // Delete workflow itself
                Workflow.deleteOne({ _id: workflow.id }, { session })
            ]);

            // ⭐ PHASE 1: If this was defaultWorkflowId, reassign to another
            const { User } = require('../models/User.model');
            const userDoc = await User.findById(user.id).session(session);

            if (userDoc?.defaultWorkflowId?.equals(workflow.id)) {
                // Find next oldest workflow to assign as default
                const nextWorkflow = await Workflow
                    .findOne({ userId: user.id })
                    .sort({ createdAt: 1 })
                    .session(session);

                if (nextWorkflow) {
                    // ⭐ PHASE 1: Update defaultWorkflowId AND mark as default
                    await Workflow.updateOne(
                        { _id: nextWorkflow.id },
                        { isDefault: true },
                        { session }
                    );

                    await User.findByIdAndUpdate(
                        user.id,
                        {
                            defaultWorkflowId: nextWorkflow._id,
                            $inc: { workflowCount: -1 }
                        },
                        { session, new: true }
                    );

                    console.log('[Workflows] DELETE - Reassigned defaultWorkflowId:', {
                        userId: user.id,
                        deletedWorkflowId: workflow.id,
                        newDefaultWorkflowId: nextWorkflow.id
                    });
                }
            } else {
                // Just decrement workflowCount
                await User.findByIdAndUpdate(
                    user.id,
                    { $inc: { workflowCount: -1 } },
                    { session }
                );
            }

            await session.commitTransaction();

            res.json({
                success: true,
                message: 'Workflow supprimé avec succès',
                deletedWorkflowId: workflow.id,
                cascade: {
                    agentsDeleted: deletionResults[0].deletedCount,
                    edgesDeleted: deletionResults[1].deletedCount,
                    nodesDeleted: deletionResults[2].deletedCount,
                    journalsDeleted: deletionResults[3].deletedCount
                }
            });
        } catch (error) {
            await session.abortTransaction();
            console.error('[Workflows] DELETE error:', error);
            res.status(500).json({
                error: 'Erreur suppression workflow',
                details: error instanceof Error ? error.message : String(error)
            });
        } finally {
            await session.endSession();
        }
    }
);`;

const DELETE_NEW = `// DELETE /api/workflows/:id - Supprimer workflow (cascade séquentielle)
// ⭐ V4 FIX: Transactions retirées (MongoDB standalone)
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;

            // ⭐ Fetch workflow
            const workflow = await Workflow.findOne({
                _id: req.params.id,
                userId: user.id
            });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // ⭐ Check if this is the last workflow
            const otherWorkflowCount = await Workflow.countDocuments({
                userId: user.id,
                _id: { $ne: workflow.id }
            });

            if (otherWorkflowCount === 0) {
                return res.status(400).json({
                    error: 'Impossible de supprimer le seul workflow',
                    code: 'LAST_WORKFLOW',
                    message: 'Chaque utilisateur doit avoir au moins un workflow'
                });
            }

            // ⭐ CASCADE DELETE (séquentiel, pas de transaction)
            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;
            const AgentJournal = require('../models/AgentJournal.model').AgentJournal;

            const deletionResults = await Promise.all([
                AgentInstance.deleteMany({ workflowId: workflow.id }),
                WorkflowEdge.deleteMany({ workflowId: workflow.id }),
                WorkflowNodeV2.deleteMany({ workflowId: workflow.id }),
                AgentJournal.deleteMany({ workflowId: workflow.id }),
                Workflow.deleteOne({ _id: workflow.id })
            ]);

            // ⭐ If this was defaultWorkflowId, reassign to another
            const { User } = require('../models/User.model');
            const userDoc = await User.findById(user.id);

            if (userDoc?.defaultWorkflowId?.equals(workflow.id)) {
                const nextWorkflow = await Workflow
                    .findOne({ userId: user.id })
                    .sort({ createdAt: 1 });

                if (nextWorkflow) {
                    await Workflow.updateOne(
                        { _id: nextWorkflow.id },
                        { isDefault: true }
                    );

                    await User.findByIdAndUpdate(
                        user.id,
                        {
                            defaultWorkflowId: nextWorkflow._id,
                            $inc: { workflowCount: -1 }
                        },
                        { new: true }
                    );

                    console.log('[Workflows] DELETE - Reassigned defaultWorkflowId:', {
                        userId: user.id,
                        deletedWorkflowId: workflow.id,
                        newDefaultWorkflowId: nextWorkflow.id
                    });
                }
            } else {
                await User.findByIdAndUpdate(
                    user.id,
                    { $inc: { workflowCount: -1 } }
                );
            }

            res.json({
                success: true,
                message: 'Workflow supprimé avec succès',
                deletedWorkflowId: workflow.id,
                cascade: {
                    agentsDeleted: deletionResults[0].deletedCount,
                    edgesDeleted: deletionResults[1].deletedCount,
                    nodesDeleted: deletionResults[2].deletedCount,
                    journalsDeleted: deletionResults[3].deletedCount
                }
            });
        } catch (error) {
            console.error('[Workflows] DELETE error:', error);
            res.status(500).json({
                error: 'Erreur suppression workflow',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }
);`;

// ============================================================================
// FIX 3: POST /api/workflows/:id/select - Remove transactions
// ============================================================================
const SELECT_OLD = `// ⭐ PHASE 1: POST /api/workflows/:id/select - Activer un workflow
router.post('/:id/select',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const user = req.user as IUser;
            const workflowId = req.params.id;

            // Validate workflow exists and belongs to user
            const workflow = await Workflow.findOne({
                _id: workflowId,
                userId: user.id
            }).session(session);

            if (!workflow) {
                await session.abortTransaction();
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // ⭐ PHASE 1: Update all workflows atomically
            // Disable others, enable this one
            await Workflow.updateMany(
                { userId: user.id, _id: { $ne: workflowId } },
                { isActive: false },
                { session }
            );

            await Workflow.updateOne(
                { _id: workflowId },
                {
                    isActive: true,
                    lastSavedAt: new Date()
                },
                { session }
            );

            // ⭐ PHASE 1: Update User lastActiveWorkflowId
            const { User } = require('../models/User.model');
            await User.findByIdAndUpdate(
                user.id,
                { lastActiveWorkflowId: workflow._id },
                { session }
            );

            // ⭐ PHASE 1: Fetch related data for this workflow
            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;
            const [agents, nodes, edges] = await Promise.all([
                AgentInstance.find({ workflowId }).session(session),
                WorkflowNodeV2.find({ workflowId }).session(session),
                WorkflowEdge.find({ workflowId }).session(session)
            ]);

            await session.commitTransaction();

            const updatedWorkflow = await Workflow.findById(workflowId);

            console.log('[Workflows] SELECT - Workflow activated:', {
                userId: user.id,
                workflowId: workflowId,
                agentsCount: agents?.length || 0,
                nodesCount: nodes?.length || 0
            });

            res.json({
                success: true,
                workflow: updatedWorkflow,
                reloadedData: {
                    agents: agents || [],
                    nodes: nodes || [],
                    edges: edges || [],
                    canvasState: workflow.canvasState
                }
            });

        } catch (error) {
            await session.abortTransaction();
            console.error('[Workflows] SELECT error:', error);
            res.status(500).json({
                error: 'Erreur lors de l\\'activation du workflow',
                details: error instanceof Error ? error.message : String(error)
            });
        } finally {
            await session.endSession();
        }
    }
);`;

const SELECT_NEW = `// ⭐ POST /api/workflows/:id/select - Activer un workflow
// ⭐ V4 FIX: Transactions retirées (MongoDB standalone)
router.post('/:id/select',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const workflowId = req.params.id;

            // Validate workflow exists and belongs to user
            const workflow = await Workflow.findOne({
                _id: workflowId,
                userId: user.id
            });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // ⭐ Disable others, enable this one (séquentiel)
            await Workflow.updateMany(
                { userId: user.id, _id: { $ne: workflowId } },
                { isActive: false }
            );

            await Workflow.updateOne(
                { _id: workflowId },
                {
                    isActive: true,
                    lastSavedAt: new Date()
                }
            );

            // ⭐ Update User lastActiveWorkflowId
            const { User } = require('../models/User.model');
            await User.findByIdAndUpdate(
                user.id,
                { lastActiveWorkflowId: workflow._id }
            );

            // ⭐ Fetch related data for this workflow
            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;
            const [agents, nodes, edges] = await Promise.all([
                AgentInstance.find({ workflowId }),
                WorkflowNodeV2.find({ workflowId }),
                WorkflowEdge.find({ workflowId })
            ]);

            const updatedWorkflow = await Workflow.findById(workflowId);

            console.log('[Workflows] SELECT - Workflow activated:', {
                userId: user.id,
                workflowId: workflowId,
                agentsCount: agents?.length || 0,
                nodesCount: nodes?.length || 0
            });

            res.json({
                success: true,
                workflow: updatedWorkflow,
                reloadedData: {
                    agents: agents || [],
                    nodes: nodes || [],
                    edges: edges || [],
                    canvasState: workflow.canvasState
                }
            });

        } catch (error) {
            console.error('[Workflows] SELECT error:', error);
            res.status(500).json({
                error: 'Erreur lors de l\\'activation du workflow',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }
);`;

// ============================================================================
// APPLY FIXES
// ============================================================================
let fixCount = 0;

// Fix 1: POST route
if (content.includes(POST_OLD)) {
    content = content.replace(POST_OLD, POST_NEW);
    console.log('[fix-transactions-v4] ✅ FIX 1: POST route - transactions removed');
    fixCount++;
} else {
    console.log('[fix-transactions-v4] ⚠️ FIX 1: POST route - pattern not found (may already be fixed)');
}

// Fix 2: DELETE route
if (content.includes(DELETE_OLD)) {
    content = content.replace(DELETE_OLD, DELETE_NEW);
    console.log('[fix-transactions-v4] ✅ FIX 2: DELETE route - transactions removed');
    fixCount++;
} else {
    console.log('[fix-transactions-v4] ⚠️ FIX 2: DELETE route - pattern not found (may already be fixed)');
}

// Fix 3: SELECT route
if (content.includes(SELECT_OLD)) {
    content = content.replace(SELECT_OLD, SELECT_NEW);
    console.log('[fix-transactions-v4] ✅ FIX 3: SELECT route - transactions removed');
    fixCount++;
} else {
    console.log('[fix-transactions-v4] ⚠️ FIX 3: SELECT route - pattern not found (may already be fixed)');
}

// ============================================================================
// WRITE & VERIFY
// ============================================================================
if (fixCount > 0) {
    fs.writeFileSync(FILE_PATH, content, 'utf8');
    console.log(`[fix-transactions-v4] 📝 File written to disk (${fixCount} fixes applied)`);
    
    // Verify no more transaction patterns exist in the fixed sections
    const verify = fs.readFileSync(FILE_PATH, 'utf8');
    const sessionMatches = (verify.match(/startSession\(\)/g) || []).length;
    const commitMatches = (verify.match(/commitTransaction\(\)/g) || []).length;
    const abortMatches = (verify.match(/abortTransaction\(\)/g) || []).length;
    
    console.log(`[fix-transactions-v4] 🔍 Verification:`);
    console.log(`   startSession() occurrences: ${sessionMatches}`);
    console.log(`   commitTransaction() occurrences: ${commitMatches}`);
    console.log(`   abortTransaction() occurrences: ${abortMatches}`);
    
    if (sessionMatches === 0 && commitMatches === 0 && abortMatches === 0) {
        console.log(`[fix-transactions-v4] ✅ ALL CLEAR - No transaction patterns remain`);
    } else {
        console.log(`[fix-transactions-v4] ⚠️ Some transaction patterns still exist (likely in deprecated V1 endpoints or elsewhere)`);
    }
} else {
    console.log('[fix-transactions-v4] ℹ️ No changes needed - file may already be correct');
}

console.log('[fix-transactions-v4] Done.');
