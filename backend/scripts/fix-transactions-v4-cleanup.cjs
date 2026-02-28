/**
 * fix-transactions-v4-cleanup.cjs
 * 
 * The previous script miscalculated route endings, leaving duplicate tails.
 * This script takes a different approach: it rewrites the entire file from scratch,
 * replacing the 3 problematic sections using brace-depth tracking to find the 
 * correct route boundaries.
 */
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'src', 'routes', 'workflows.routes.ts');

console.log('[cleanup] Reading file from disk...');
const content = fs.readFileSync(FILE_PATH, 'utf8');
const EOL = content.includes('\r\n') ? '\r\n' : '\n';
const lines = content.split(EOL);
console.log(`[cleanup] File has ${lines.length} lines, EOL: ${EOL === '\r\n' ? 'CRLF' : 'LF'}`);

/**
 * Find the end of a router.method(...) call starting at lineIdx.
 * Tracks parenthesis depth from the `router.xxx(` opening.
 * Returns the line index of the closing `);`
 */
function findRouteEndByParen(lineIdx) {
    let depth = 0;
    let started = false;
    
    for (let i = lineIdx; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
            if (ch === '(') {
                depth++;
                started = true;
            } else if (ch === ')') {
                depth--;
                if (started && depth === 0) {
                    return i;
                }
            }
        }
    }
    return -1;
}

/**
 * Find the first line at or after startIdx containing pattern
 */
function findLine(pattern, startFrom = 0) {
    for (let i = startFrom; i < lines.length; i++) {
        if (lines[i].includes(pattern)) return i;
    }
    return -1;
}

// ============================================================================
// STEP 1: Identify all route boundaries
// ============================================================================
const sections = [];

// Find POST route
const postCommentIdx = findLine('// POST /api/workflows - Créer nouveau workflow');
if (postCommentIdx !== -1) {
    // Find the router.post line (may be same line or next)
    const postRouterIdx = findLine('router.post(', postCommentIdx);
    const postEndIdx = findRouteEndByParen(postRouterIdx);
    // But we might have our V4 FIX comment that shifts things, AND there might be
    // duplicate code. Let's find all `});` after the clean route to the PUT route.
    const putCommentIdx = findLine('// PUT /api/workflows/:id', postCommentIdx + 1);
    
    console.log(`[cleanup] POST route: comment at ${postCommentIdx + 1}, router at ${postRouterIdx + 1}`);
    console.log(`[cleanup] POST route end (paren tracking): ${postEndIdx + 1}`);
    console.log(`[cleanup] PUT route comment: ${putCommentIdx + 1}`);
    
    sections.push({
        name: 'POST',
        startLine: postCommentIdx,
        // Everything from POST comment to the line before PUT comment should be replaced
        endLine: putCommentIdx - 1, // -1 to leave a blank line before PUT
    });
}

// Find DELETE route
const deleteCommentIdx = findLine('// DELETE /api/workflows/:id');
if (deleteCommentIdx !== -1) {
    // Find the next route after DELETE
    const nextAfterDelete = findLine('// ⭐ POST /api/workflows/:id/select', deleteCommentIdx + 1) ||
                            findLine('POST /api/workflows/:id/select', deleteCommentIdx + 1);
    const selectCommentIdx = findLine('/select', deleteCommentIdx + 10);
    
    // Find the actual next route comment
    let nextRouteIdx = -1;
    for (let i = deleteCommentIdx + 5; i < lines.length; i++) {
        // Look for the next top-level comment (route definition)
        if (lines[i].match(/^\/\/ ⭐.*POST|^\/\/.*POST.*\/select|^\/\/.*GET.*\/stats/)) {
            nextRouteIdx = i;
            break;
        }
    }
    
    console.log(`[cleanup] DELETE route: comment at ${deleteCommentIdx + 1}`);
    console.log(`[cleanup] Next route after DELETE: ${nextRouteIdx + 1}`);
    
    if (nextRouteIdx !== -1) {
        sections.push({
            name: 'DELETE',
            startLine: deleteCommentIdx,
            endLine: nextRouteIdx - 1,
        });
    }
}

// Find SELECT route
const selectCommentIdx = findLine('POST /api/workflows/:id/select');
if (selectCommentIdx !== -1) {
    // Find next route after SELECT
    let nextAfterSelect = -1;
    for (let i = selectCommentIdx + 5; i < lines.length; i++) {
        if (lines[i].match(/^\/\/ ⭐.*GET.*\/stats|^\/\/.*GET.*\/api\/workflows/)) {
            nextAfterSelect = i;
            break;
        }
    }
    
    console.log(`[cleanup] SELECT route: comment at ${selectCommentIdx + 1}`);
    console.log(`[cleanup] Next route after SELECT: ${nextAfterSelect + 1}`);
    
    if (nextAfterSelect !== -1) {
        sections.push({
            name: 'SELECT',
            startLine: selectCommentIdx,
            endLine: nextAfterSelect - 1,
        });
    }
}

console.log('\n[cleanup] Sections to replace:');
sections.forEach(s => {
    const sectionLines = lines.slice(s.startLine, s.endLine + 1);
    const hasSession = sectionLines.some(l => l.includes('startSession'));
    const hasCommit = sectionLines.some(l => l.includes('commitTransaction'));
    console.log(`  ${s.name}: lines ${s.startLine + 1}-${s.endLine + 1} (${s.endLine - s.startLine + 1} lines, session: ${hasSession}, commit: ${hasCommit})`);
});

// ============================================================================
// STEP 2: Build replacement blocks
// ============================================================================
const POST_REPLACEMENT = [
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
``,
];

const DELETE_REPLACEMENT = [
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
`            // ⭐ CASCADE DELETE (séquentiel)`,
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
``,
];

const SELECT_REPLACEMENT = [
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
`                error: \`Erreur lors de l'activation du workflow\`,`,
`                details: error instanceof Error ? error.message : String(error)`,
`            });`,
`        }`,
`    }`,
`);`,
``,
];

// ============================================================================
// STEP 3: Apply replacements (reverse order to preserve line numbers)
// ============================================================================
// Sort sections by startLine descending
sections.sort((a, b) => b.startLine - a.startLine);

for (const section of sections) {
    const replacement = section.name === 'POST' ? POST_REPLACEMENT :
                       section.name === 'DELETE' ? DELETE_REPLACEMENT :
                       SELECT_REPLACEMENT;
    
    const removed = section.endLine - section.startLine + 1;
    lines.splice(section.startLine, removed, ...replacement);
    console.log(`[cleanup] Replaced ${section.name}: removed ${removed} lines, inserted ${replacement.length} lines`);
}

// ============================================================================
// STEP 4: Remove blank line duplicates (cleanup)
// ============================================================================
const result = [];
let prevBlank = false;
for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue; // Skip consecutive blank lines
    result.push(line);
    prevBlank = isBlank;
}

// ============================================================================
// STEP 5: Write and verify
// ============================================================================
const output = result.join(EOL);
fs.writeFileSync(FILE_PATH, output, 'utf8');
console.log(`\n[cleanup] 📝 Written ${result.length} lines to disk`);

// Final verification
const verify = fs.readFileSync(FILE_PATH, 'utf8');
const sessionCount = (verify.match(/startSession\(\)/g) || []).length;
const commitCount = (verify.match(/commitTransaction\(\)/g) || []).length;
const abortCount = (verify.match(/abortTransaction\(\)/g) || []).length;
const endSessionCount = (verify.match(/\.endSession\(\)/g) || []).length;
const dotSessionCount = (verify.match(/\.session\(session\)/g) || []).length;

console.log(`[cleanup] 🔍 Final verification:`);
console.log(`   startSession():       ${sessionCount}`);
console.log(`   commitTransaction():  ${commitCount}`);
console.log(`   abortTransaction():   ${abortCount}`);
console.log(`   endSession():         ${endSessionCount}`);
console.log(`   .session(session):    ${dotSessionCount}`);

if (sessionCount === 0 && commitCount === 0 && abortCount === 0 && endSessionCount === 0 && dotSessionCount === 0) {
    console.log(`[cleanup] ✅ PERFECT - Zero transaction patterns remaining`);
} else {
    console.log(`[cleanup] ⚠️ Some transaction patterns still found - investigating...`);
    const vLines = verify.split(EOL);
    vLines.forEach((l, i) => {
        if (l.includes('startSession') || l.includes('commitTransaction') || 
            l.includes('abortTransaction') || l.includes('.session(session)') ||
            l.includes('endSession')) {
            console.log(`   Line ${i + 1}: ${l.trim()}`);
        }
    });
}

console.log('[cleanup] Done.');
