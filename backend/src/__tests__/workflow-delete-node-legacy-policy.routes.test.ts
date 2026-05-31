import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import passport from 'passport';
import request from 'supertest';
import mongoose from 'mongoose';
import '../middleware/auth.middleware';
import workflowsRoutes from '../routes/workflows.routes';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { MediaReference } from '../models/MediaReference.model';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { WorkflowNodeV2 } from '../models/WorkflowNodeV2.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/workflows', workflowsRoutes);

describe('legacy workflow node deletion media policy', () => {
    const testWorkspaceStorageRoot = path.join(process.cwd(), 'storage-test-workflow-delete-node-policy');

    beforeEach(() => {
        process.env.WORKSPACE_STORAGE_PATH = testWorkspaceStorageRoot;
    });

    afterEach(async () => {
        await fs.rm(testWorkspaceStorageRoot, { recursive: true, force: true }).catch(() => undefined);
        await WorkflowEdge.deleteMany({});
        await WorkflowNodeV2.deleteMany({});
        await MediaReference.deleteMany({});
        await AgentJournal.deleteMany({});
        await AgentInstance.deleteMany({});
        await Workflow.deleteMany({});
        await User.deleteMany({ email: /workflow-delete-node-policy-/i });
    });

    it('keeps media as orphans on the legacy node delete route', async () => {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const user = await User.create({
            email: `workflow-delete-node-policy-${suffix}@test.com`,
            password: 'hashedpassword12345',
            username: `workflowdeletenodepolicy${suffix}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Legacy Delete Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `legacy-delete-${suffix}`,
            status: 'running',
            name: 'Legacy Agent',
            role: 'assistant',
            systemPrompt: 'system',
            llmProvider: 'mock',
            llmModel: 'mock-model',
            capabilities: [],
            robotId: 'AR_001',
            position: { x: 0, y: 0 },
            isMinimized: false,
            isMaximized: false,
            zIndex: 1,
            content: [],
            metrics: {
                totalTokens: 0,
                totalErrors: 0,
                totalMediaGenerated: 0,
                callCount: 0,
            },
            persistenceConfig: {
                saveChat: true,
                saveChatHistory: true,
                saveErrors: true,
                saveTasks: false,
                saveTaskExecution: false,
                saveLinks: false,
                saveMedia: true,
                saveHistorySummary: false,
                mediaStorage: 'db',
            },
        });

        const node = await WorkflowNodeV2.create({
            workflowId: workflow._id,
            ownerId: user._id,
            instanceId: instance._id,
            nodeType: 'agent',
            position: { x: 0, y: 0 },
            uiConfig: { label: 'Legacy Agent', expanded: true },
        });

        const mediaJournal = await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'media',
            severity: 'info',
            payload: {
                mimeType: 'text/plain',
                fileName: 'legacy-orphan.txt',
                size: 18,
                storageMode: 'database',
                data: Buffer.from('keep me as orphan', 'utf-8'),
            },
            timestamp: new Date(),
        });

        await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'chat',
            severity: 'info',
            payload: { role: 'agent', content: 'remove chat history' },
            timestamp: new Date(),
        });

        const mediaReference = await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            storageMode: 'db',
            primaryStorageMode: 'db',
            canonicalLocator: `journal://${mediaJournal.id}`,
            journalEntryId: mediaJournal._id,
            fileName: 'legacy-orphan.txt',
            originalName: 'legacy-orphan.txt',
            mimeType: 'text/plain',
            size: 18,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Legacy Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Legacy Agent',
            isOrphan: false,
        });

        const response = await request(app)
            .delete(`/api/workflows/${workflow.id}/v2/nodes/${node.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ mediaPolicy: 'orphan_media' })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            deletedNodeId: node.id,
            deletedInstanceId: instance.id,
            mediaPolicy: 'orphan_media',
        }));
        expect(response.body.audit).toEqual(expect.objectContaining({
            severity: 'info',
            anomalyCount: 0,
            origin: 'workflow_v2_node_delete_route',
        }));
        expect(response.body.deletedCounts).toEqual(expect.objectContaining({
            mediaReferencesOrphaned: 1,
            retainedMediaEntries: 1,
        }));
        expect(await WorkflowNodeV2.findById(node.id)).toBeNull();
        expect(await AgentInstance.findById(instance.id)).toBeNull();
        expect(await AgentJournal.findById(mediaJournal.id)).not.toBeNull();
        expect(await AgentJournal.findOne({ agentInstanceId: instance._id, type: 'chat' })).toBeNull();

        const orphanedMediaReference = await MediaReference.findById(mediaReference.id).lean();
        expect(orphanedMediaReference).toEqual(expect.objectContaining({
            isOrphan: true,
            orphanReason: 'agent_deleted',
        }));

        const auditJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'system',
            'payload.event': 'media_deletion_policy_applied',
        }).lean();
        expect(auditJournal).toEqual(expect.objectContaining({
            severity: 'info',
            payload: expect.objectContaining({
                event: 'media_deletion_policy_applied',
                triggeredBy: user.id,
                details: expect.objectContaining({
                    origin: 'workflow_v2_node_delete_route',
                    mediaPolicy: 'orphan_media',
                }),
            }),
        }));
    });

    it('deletes workspace-backed media on the legacy node delete route', async () => {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const user = await User.create({
            email: `workflow-delete-node-policy-${suffix}@test.com`,
            password: 'hashedpassword12345',
            username: `workflowdeletenodepolicy${suffix}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Legacy Delete Workspace Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `legacy-delete-workspace-${suffix}`,
            status: 'running',
            name: 'Legacy Workspace Agent',
            role: 'assistant',
            systemPrompt: 'system',
            llmProvider: 'mock',
            llmModel: 'mock-model',
            capabilities: [],
            robotId: 'AR_001',
            position: { x: 0, y: 0 },
            isMinimized: false,
            isMaximized: false,
            zIndex: 1,
            content: [],
            metrics: {
                totalTokens: 0,
                totalErrors: 0,
                totalMediaGenerated: 0,
                callCount: 0,
            },
            persistenceConfig: {
                saveChat: true,
                saveChatHistory: true,
                saveErrors: true,
                saveTasks: false,
                saveTaskExecution: false,
                saveLinks: false,
                saveMedia: true,
                saveHistorySummary: false,
                mediaStorage: 'local',
                allowWorkspaceWrite: true,
            },
        });

        const node = await WorkflowNodeV2.create({
            workflowId: workflow._id,
            ownerId: user._id,
            instanceId: instance._id,
            nodeType: 'agent',
            position: { x: 0, y: 0 },
            uiConfig: { label: 'Legacy Workspace Agent', expanded: true },
        });

        const relativePath = path.posix.join('output', 'media', 'agents', instance.id, '2026-05', 'artifact.txt');
        const absolutePath = path.join(
            testWorkspaceStorageRoot,
            'users',
            user.id,
            'workflows',
            workflow.id,
            'output',
            'media',
            'agents',
            instance.id,
            '2026-05',
            'artifact.txt',
        );
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, 'delete me', 'utf-8');

        await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            canonicalLocator: `workspace://${relativePath}`,
            localPath: relativePath,
            fileName: 'artifact.txt',
            originalName: 'artifact.txt',
            mimeType: 'text/plain',
            size: 9,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Legacy Workspace Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Legacy Workspace Agent',
            isOrphan: false,
        });

        await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'chat',
            severity: 'info',
            payload: { role: 'agent', content: 'delete all related data' },
            timestamp: new Date(),
        });

        const response = await request(app)
            .delete(`/api/workflows/${workflow.id}/v2/nodes/${node.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ mediaPolicy: 'delete_media' })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            deletedNodeId: node.id,
            deletedInstanceId: instance.id,
            mediaPolicy: 'delete_media',
        }));
        expect(response.body.audit).toEqual(expect.objectContaining({
            severity: 'info',
            anomalyCount: 0,
            origin: 'workflow_v2_node_delete_route',
        }));
        expect(response.body.deletedCounts).toEqual(expect.objectContaining({
            mediaFiles: 1,
            mediaReferencesDeleted: 1,
        }));
        expect(await WorkflowNodeV2.findById(node.id)).toBeNull();
        expect(await AgentInstance.findById(instance.id)).toBeNull();
        expect(await MediaReference.findOne({ agentInstanceId: instance._id })).toBeNull();

        const remainingJournals = await AgentJournal.find({ agentInstanceId: instance._id }).lean();
        expect(remainingJournals).toHaveLength(1);
        expect(remainingJournals[0]).toEqual(expect.objectContaining({
            type: 'system',
            severity: 'info',
            payload: expect.objectContaining({
                event: 'media_deletion_policy_applied',
                details: expect.objectContaining({
                    origin: 'workflow_v2_node_delete_route',
                    mediaPolicy: 'delete_media',
                }),
            }),
        }));
        await expect(fs.access(absolutePath)).rejects.toThrow();
    });

    it('warns on the legacy node delete route when runtime artifacts remain referenced by user tool runs', async () => {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const user = await User.create({
            email: `workflow-delete-node-policy-${suffix}@test.com`,
            password: 'hashedpassword12345',
            username: `workflowdeletenodepolicyruntime${suffix}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Legacy Runtime Artifact Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `legacy-runtime-delete-${suffix}`,
            status: 'running',
            name: 'Legacy Runtime Agent',
            role: 'assistant',
            systemPrompt: 'system',
            llmProvider: 'mock',
            llmModel: 'mock-model',
            capabilities: [],
            robotId: 'AR_001',
            position: { x: 0, y: 0 },
            isMinimized: false,
            isMaximized: false,
            zIndex: 1,
            content: [],
            metrics: {
                totalTokens: 0,
                totalErrors: 0,
                totalMediaGenerated: 0,
                callCount: 0,
            },
            persistenceConfig: {
                saveChat: true,
                saveChatHistory: true,
                saveErrors: true,
                saveTasks: false,
                saveTaskExecution: false,
                saveLinks: false,
                saveMedia: true,
                saveHistorySummary: false,
                mediaStorage: 'local',
                allowWorkspaceWrite: true,
            },
        });

        const node = await WorkflowNodeV2.create({
            workflowId: workflow._id,
            ownerId: user._id,
            instanceId: instance._id,
            nodeType: 'agent',
            position: { x: 0, y: 0 },
            uiConfig: { label: 'Legacy Runtime Agent', expanded: true },
        });

        const executionId = `utr-runtime-legacy-${suffix}`;
        const relativePath = path.posix.join('output', 'runs', executionId, 'artifact.json');
        const absolutePath = path.join(
            testWorkspaceStorageRoot,
            'users',
            user.id,
            'workflows',
            workflow.id,
            'output',
            'runs',
            executionId,
            'artifact.json',
        );
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, '{"runtime":true}', 'utf-8');

        await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            provenance: 'runtime_output',
            sourceExecutionId: executionId,
            canonicalLocator: `workspace://${relativePath}`,
            localPath: relativePath,
            fileName: 'artifact.json',
            originalName: 'artifact.json',
            mimeType: 'application/json',
            size: 16,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Legacy Runtime Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Legacy Runtime Agent',
            isOrphan: false,
        });

        await UserToolRun.create({
            executionId,
            ownerUserId: user._id,
            toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1',
            toolContentHash: 'hash-runtime-legacy',
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            launchContext: 'workflow_run',
            status: 'completed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: {},
            outputs: {
                artifacts: [{ path: relativePath, kind: 'json' }],
            },
            policySnapshot: {
                networkMode: 'restricted',
            },
            timing: {
                queuedAt: new Date(),
                startedAt: new Date(),
                finishedAt: new Date(),
                durationMs: 1,
            },
        });

        const response = await request(app)
            .delete(`/api/workflows/${workflow.id}/v2/nodes/${node.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ mediaPolicy: 'delete_media' })
            .expect(200);

        expect(response.body.audit).toEqual(expect.objectContaining({
            severity: 'warn',
            origin: 'workflow_v2_node_delete_route',
        }));
        expect(response.body.audit.anomalyCodes).toEqual(expect.arrayContaining([
            'RUNTIME_OUTPUT_RUN_REFERENCES_RETAINED',
        ]));
        expect(response.body.deletedCounts).toEqual(expect.objectContaining({
            mediaFiles: 1,
            mediaReferencesDeleted: 1,
        }));
        expect(await MediaReference.findOne({ agentInstanceId: instance._id })).toBeNull();
        expect(await UserToolRun.findOne({ executionId }).lean()).not.toBeNull();
        await expect(fs.access(absolutePath)).rejects.toThrow();

        const auditJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'system',
            'payload.event': 'media_deletion_policy_applied',
        }).lean();
        expect(auditJournal).toEqual(expect.objectContaining({
            severity: 'warn',
            payload: expect.objectContaining({
                details: expect.objectContaining({
                    anomalies: expect.arrayContaining([
                        expect.objectContaining({ code: 'RUNTIME_OUTPUT_RUN_REFERENCES_RETAINED' }),
                    ]),
                }),
            }),
        }));
    });
});