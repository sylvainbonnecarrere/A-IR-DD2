/**
 * fix-transactions-v4-v2.cjs
 * 
 * Approche robuste par lignes: identifie les sections à remplacer via les
 * signatures de début/fin, puis remplace le bloc entier.
 */
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'src', 'routes', 'workflows.routes.ts');

console.log('[fix-v4-v2] Reading file from disk...');
const content = fs.readFileSync(FILE_PATH, 'utf8');
const lines = content.split('\n');
const EOL = content.includes('\r\n') ? '\r\n' : '\n';
console.log(`[fix-v4-v2] File has ${lines.length} lines, EOL: ${EOL === '\r\n' ? 'CRLF' : 'LF'}`);

// Strip \r from lines for easier processing
const cleanLines = lines.map(l => l.replace(/\r$/, ''));

// Helper: find line index containing a pattern
function findLine(pattern, startFrom = 0) {
    for (let i = startFrom; i < cleanLines.length; i++) {
        if (cleanLines[i].includes(pattern)) return i;
    }
    return -1;
}

// Helper: find the closing of a router method (matching the final `);` at correct indent)
function findRouteEnd(startIdx) {
    // Look for `);` at the start of a line (top-level route closing)
    for (let i = startIdx + 1; i < cleanLines.length; i++) {
        if (cleanLines[i].trim() === ');') {
            return i;
        }
    }
    return -1;
}

let fixCount = 0;

// ============================================================================
// FIX 1: POST /api/workflows
// ============================================================================
const postStart = findLine("// POST /api/workflows - Créer nouveau workflow");
if (postStart === -1) {
    console.log('[fix-v4-v2] ⚠️ POST route comment not found');
} else {
    const postEnd = findRouteEnd(postStart);
    console.log(`[fix-v4-v2] POST route found at lines ${postStart + 1}-${postEnd + 1}`);
    
    if (cleanLines[postStart + 2]?.includes('startSession')) {
        const postNew = [
`// POST /api/workflows - Créer nouveau workflow`,
`// ⭐ V4 FIX: Transactions retirées (MongoDB standalone ne supporte pas les transactions)`,
`router.post('/', requireAuth, validateRequest(createWorkflowSchema), async (req, res) => {`,
`    try {`,
`        const user = req.user as IUser;`,
`        const userId = user._id.toString();`,
``,
`        console.log(\`[Workflows POST] Creating workflow for user: \${userId}\`);`,
``,
`        // ⭐ Count existing workflows`,
`        const existingCount = await Workflow.countDocuments({ userId });`,
`        const isFirstWorkflow = existingCount === 0;`,
``,
`        // ⭐ Create workflow`,
`        const newWorkflow = new Workflow({`,
`            userId,`,
`            name: req.body.name,`,
`            description: req.body.description,`,
`            isActive: isFirstWorkflow,`,
`            isDefault: isFirstWorkflow,`,
`            isDirty: false,`,
`            canvasState: {`,
`                zoom: 1,`,
`                panX: 0,`,
`                panY: 0`,
`            }`,
`        });`,
``,
`        await newWorkflow.save();`,
`        console.log(\`[Workflows POST] Created workflow: \${newWorkflow._id}\`);`,
``,
`        // ⭐ Sync User record - if first workflow, set as default`,
`        if (isFirstWorkflow) {`,
`            await User.findByIdAndUpdate(`,
`                userId,`,
`                {`,
`                    $set: {`,
`                        defaultWorkflowId: newWorkflow._id,`,
`                        workflowCount: 1,`,
`                        lastActiveWorkflowId: newWorkflow._id`,
`                    }`,
`                },`,
`                { new: true }`,
`            );`,
`            console.log(\`[Workflows POST] First workflow - User updated with defaultWorkflowId\`);`,
`        } else {`,
`            // Just increment count`,
`            await User.findByIdAndUpdate(`,
`                userId,`,
`                { $inc: { workflowCount: 1 } }`,
`            );`,
`        }`,
``,
`        res.status(201).json(newWorkflow);`,
``,
`    } catch (error) {`,
`        console.error('[Workflows POST] Error:', error);`,
`        res.status(500).json({ error: 'Erreur création workflow', details: error instanceof Error ? error.message : String(error) });`,
`    }`,
`});`,
        ];
        
        cleanLines.splice(postStart, postEnd - postStart + 1, ...postNew);
        console.log(`[fix-v4-v2] ✅ FIX 1: POST route replaced (${postEnd - postStart + 1} lines → ${postNew.length} lines)`);
        fixCount++;
    } else {
        console.log('[fix-v4-v2] ℹ️ POST route already fixed (no startSession found)');
    }
}

// ============================================================================
// FIX 2: DELETE /api/workflows/:id 
// ============================================================================
const deleteStart = findLine("// DELETE /api/workflows/:id");
if (deleteStart === -1) {
    console.log('[fix-v4-v2] ⚠️ DELETE route comment not found');
} else {
    const deleteEnd = findRouteEnd(deleteStart);
    console.log(`[fix-v4-v2] DELETE route found at lines ${deleteStart + 1}-${deleteEnd + 1}`);
    
    // Check if it still has sessions
    const hasSession = cleanLines.slice(deleteStart, deleteEnd + 1).some(l => l.includes('startSession'));
    if (hasSession) {
        const deleteNew = [
`// DELETE /api/workflows/:id - Supprimer workflow (cascade séquentielle)`,
`// ⭐ V4 FIX: Transactions retirées (MongoDB standalone)`,
`router.delete('/:id',`,
`    requireAuth,`,
`    requireOwnershipAsync(async (req) => {`,
`        const workflow = await Workflow.findById(req.params.id);`,
`        return workflow ? workflow.userId.toString() : null;`,
`    }),`,
`    async (req, res) => {`,
`        try {`,
`            const user = req.user as IUser;`,
``,
`            // ⭐ Fetch workflow`,
`            const workflow = await Workflow.findOne({`,
`                _id: req.params.id,`,
`                userId: user.id`,
`            });`,
``,
`            if (!workflow) {`,
`                return res.status(404).json({ error: 'Workflow introuvable' });`,
`            }`,
``,
`            // ⭐ Check if this is the last workflow`,
`            const otherWorkflowCount = await Workflow.countDocuments({`,
`                userId: user.id,`,
`                _id: { $ne: workflow.id }`,
`            });`,
``,
`            if (otherWorkflowCount === 0) {`,
`                return res.status(400).json({`,
`                    error: 'Impossible de supprimer le seul workflow',`,
`                    code: 'LAST_WORKFLOW',`,
`                    message: 'Chaque utilisateur doit avoir au moins un workflow'`,
`                });`,
`            }`,
``,
`            // ⭐ CASCADE DELETE (séquentiel, pas de transaction)`,
`            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;`,
`            const AgentJournal = require('../models/AgentJournal.model').AgentJournal;`,
``,
`            const deletionResults = await Promise.all([`,
`                AgentInstance.deleteMany({ workflowId: workflow.id }),`,
`                WorkflowEdge.deleteMany({ workflowId: workflow.id }),`,
`                WorkflowNodeV2.deleteMany({ workflowId: workflow.id }),`,
`                AgentJournal.deleteMany({ workflowId: workflow.id }),`,
`                Workflow.deleteOne({ _id: workflow.id })`,
`            ]);`,
``,
`            // ⭐ If this was defaultWorkflowId, reassign to another`,
`            const { User } = require('../models/User.model');`,
`            const userDoc = await User.findById(user.id);`,
``,
`            if (userDoc?.defaultWorkflowId?.equals(workflow.id)) {`,
`                const nextWorkflow = await Workflow`,
`                    .findOne({ userId: user.id })`,
`                    .sort({ createdAt: 1 });`,
``,
`                if (nextWorkflow) {`,
`                    await Workflow.updateOne(`,
`                        { _id: nextWorkflow.id },`,
`                        { isDefault: true }`,
`                    );`,
``,
`                    await User.findByIdAndUpdate(`,
`                        user.id,`,
`                        {`,
`                            defaultWorkflowId: nextWorkflow._id,`,
`                            $inc: { workflowCount: -1 }`,
`                        },`,
`                        { new: true }`,
`                    );`,
``,
`                    console.log('[Workflows] DELETE - Reassigned defaultWorkflowId:', {`,
`                        userId: user.id,`,
`                        deletedWorkflowId: workflow.id,`,
`                        newDefaultWorkflowId: nextWorkflow.id`,
`                    });`,
`                }`,
`            } else {`,
`                await User.findByIdAndUpdate(`,
`                    user.id,`,
`                    { $inc: { workflowCount: -1 } }`,
`                );`,
`            }`,
``,
`            res.json({`,
`                success: true,`,
`                message: 'Workflow supprimé avec succès',`,
`                deletedWorkflowId: workflow.id,`,
`                cascade: {`,
`                    agentsDeleted: deletionResults[0].deletedCount,`,
`                    edgesDeleted: deletionResults[1].deletedCount,`,
`                    nodesDeleted: deletionResults[2].deletedCount,`,
`                    journalsDeleted: deletionResults[3].deletedCount`,
`                }`,
`            });`,
`        } catch (error) {`,
`            console.error('[Workflows] DELETE error:', error);`,
`            res.status(500).json({`,
`                error: 'Erreur suppression workflow',`,
`                details: error instanceof Error ? error.message : String(error)`,
`            });`,
`        }`,
`    }`,
`);`,
        ];
        
        cleanLines.splice(deleteStart, deleteEnd - deleteStart + 1, ...deleteNew);
        console.log(`[fix-v4-v2] ✅ FIX 2: DELETE route replaced (${deleteEnd - deleteStart + 1} lines → ${deleteNew.length} lines)`);
        fixCount++;
    } else {
        console.log('[fix-v4-v2] ℹ️ DELETE route already fixed');
    }
}

// ============================================================================
// FIX 3: POST /api/workflows/:id/select
// ============================================================================
const selectStart = findLine("POST /api/workflows/:id/select");
if (selectStart === -1) {
    console.log('[fix-v4-v2] ⚠️ SELECT route comment not found');
} else {
    const selectEnd = findRouteEnd(selectStart);
    console.log(`[fix-v4-v2] SELECT route found at lines ${selectStart + 1}-${selectEnd + 1}`);
    
    const hasSession = cleanLines.slice(selectStart, selectEnd + 1).some(l => l.includes('startSession'));
    if (hasSession) {
        const selectNew = [
`// ⭐ POST /api/workflows/:id/select - Activer un workflow`,
`// ⭐ V4 FIX: Transactions retirées (MongoDB standalone)`,
`router.post('/:id/select',`,
`    requireAuth,`,
`    requireOwnershipAsync(async (req) => {`,
`        const workflow = await Workflow.findById(req.params.id);`,
`        return workflow ? workflow.userId.toString() : null;`,
`    }),`,
`    async (req, res) => {`,
`        try {`,
`            const user = req.user as IUser;`,
`            const workflowId = req.params.id;`,
``,
`            // Validate workflow exists and belongs to user`,
`            const workflow = await Workflow.findOne({`,
`                _id: workflowId,`,
`                userId: user.id`,
`            });`,
``,
`            if (!workflow) {`,
`                return res.status(404).json({ error: 'Workflow introuvable' });`,
`            }`,
``,
`            // ⭐ Disable others, enable this one (séquentiel)`,
`            await Workflow.updateMany(`,
`                { userId: user.id, _id: { $ne: workflowId } },`,
`                { isActive: false }`,
`            );`,
``,
`            await Workflow.updateOne(`,
`                { _id: workflowId },`,
`                {`,
`                    isActive: true,`,
`                    lastSavedAt: new Date()`,
`                }`,
`            );`,
``,
`            // ⭐ Update User lastActiveWorkflowId`,
`            const { User } = require('../models/User.model');`,
`            await User.findByIdAndUpdate(`,
`                user.id,`,
`                { lastActiveWorkflowId: workflow._id }`,
`            );`,
``,
`            // ⭐ Fetch related data for this workflow`,
`            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;`,
`            const [agents, nodes, edges] = await Promise.all([`,
`                AgentInstance.find({ workflowId }),`,
`                WorkflowNodeV2.find({ workflowId }),`,
`                WorkflowEdge.find({ workflowId })`,
`            ]);`,
``,
`            const updatedWorkflow = await Workflow.findById(workflowId);`,
``,
`            console.log('[Workflows] SELECT - Workflow activated:', {`,
`                userId: user.id,`,
`                workflowId: workflowId,`,
`                agentsCount: agents?.length || 0,`,
`                nodesCount: nodes?.length || 0`,
`            });`,
``,
`            res.json({`,
`                success: true,`,
`                workflow: updatedWorkflow,`,
`                reloadedData: {`,
`                    agents: agents || [],`,
`                    nodes: nodes || [],`,
`                    edges: edges || [],`,
`                    canvasState: workflow.canvasState`,
`                }`,
`            });`,
``,
`        } catch (error) {`,
`            console.error('[Workflows] SELECT error:', error);`,
`            res.status(500).json({`,
`                error: 'Erreur lors de l\\'activation du workflow',`,
`                details: error instanceof Error ? error.message : String(error)`,
`            });`,
`        }`,
`    }`,
`);`,
        ];
        
        cleanLines.splice(selectStart, selectEnd - selectStart + 1, ...selectNew);
        console.log(`[fix-v4-v2] ✅ FIX 3: SELECT route replaced (${selectEnd - selectStart + 1} lines → ${selectNew.length} lines)`);
        fixCount++;
    } else {
        console.log('[fix-v4-v2] ℹ️ SELECT route already fixed');
    }
}

// ============================================================================
// WRITE FILE
// ============================================================================
if (fixCount > 0) {
    // Rejoin with proper EOL
    const output = cleanLines.join(EOL);
    fs.writeFileSync(FILE_PATH, output, 'utf8');
    console.log(`\n[fix-v4-v2] 📝 Written to disk (${fixCount} fixes applied)`);
    
    // VERIFY
    const verify = fs.readFileSync(FILE_PATH, 'utf8');
    const sessionCount = (verify.match(/startSession\(\)/g) || []).length;
    const commitCount = (verify.match(/commitTransaction\(\)/g) || []).length;
    const abortCount = (verify.match(/abortTransaction\(\)/g) || []).length;
    const endSessionCount = (verify.match(/endSession\(\)/g) || []).length;
    
    console.log(`[fix-v4-v2] 🔍 Post-fix verification:`);
    console.log(`   startSession():     ${sessionCount}`);
    console.log(`   commitTransaction(): ${commitCount}`);
    console.log(`   abortTransaction():  ${abortCount}`);
    console.log(`   endSession():        ${endSessionCount}`);
    
    if (sessionCount === 0 && commitCount === 0) {
        console.log(`[fix-v4-v2] ✅ ALL CLEAR - Zero transaction patterns remaining`);
    } else {
        console.log(`[fix-v4-v2] ⚠️ Some transaction patterns still exist elsewhere`);
    }
} else {
    console.log('[fix-v4-v2] ℹ️ No changes made');
}

console.log('[fix-v4-v2] Done.');
