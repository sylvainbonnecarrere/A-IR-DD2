import { promises as fs } from 'fs';
import mongoose from 'mongoose';
import { Workspace } from '../../models';
import type { IWorkspaceManifests, WorkspaceScopeType } from '../../models';
import UserSettings from '../../models/UserSettings.model';
import { WorkspacePathResolver } from './WorkspacePathResolver';
import type { WorkspaceProvisioningResult, WorkspaceScopeRef } from './types';

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export class WorkspaceManager {
    constructor(private readonly pathResolver: WorkspacePathResolver = new WorkspacePathResolver()) {}

    async getWorkspace(scope: WorkspaceScopeRef): Promise<WorkspaceProvisioningResult | null> {
        if (!mongoose.Types.ObjectId.isValid(scope.ownerUserId)) {
            throw new Error('ownerUserId must be a valid ObjectId');
        }

        if (!mongoose.Types.ObjectId.isValid(scope.scopeId)) {
            throw new Error('scopeId must be a valid ObjectId');
        }

        const workspace = await Workspace.findOne({
            ownerUserId: new mongoose.Types.ObjectId(scope.ownerUserId),
            scopeType: scope.scopeType,
            scopeId: new mongoose.Types.ObjectId(scope.scopeId)
        }).lean();

        if (!workspace) {
            return null;
        }

        return {
            workspaceId: workspace._id.toString(),
            wasCreated: false,
            logicalRoot: workspace.logicalRoot,
            runtimeRoots: workspace.runtimeRoots,
            manifests: workspace.manifests,
            status: workspace.status,
            lastScanAt: workspace.lastScanAt ?? null
        };
    }

    async ensureWorkspace(scope: WorkspaceScopeRef): Promise<WorkspaceProvisioningResult> {
        if (!mongoose.Types.ObjectId.isValid(scope.ownerUserId)) {
            throw new Error('ownerUserId must be a valid ObjectId');
        }

        if (!mongoose.Types.ObjectId.isValid(scope.scopeId)) {
            throw new Error('scopeId must be a valid ObjectId');
        }

        const ownerUserId = new mongoose.Types.ObjectId(scope.ownerUserId);
        const scopeId = new mongoose.Types.ObjectId(scope.scopeId);
        const resolved = this.pathResolver.resolve(scope);

        await this.ensureFilesystemRoots(resolved.logicalRoot, resolved.runtimeRoots);
        const manifests = await this.detectManifests(resolved.runtimeRoots);

        const existing = await Workspace.findOne({ ownerUserId, scopeType: scope.scopeType, scopeId });
        const nextPayload = {
            logicalRoot: resolved.logicalRoot,
            runtimeRoots: resolved.runtimeRoots,
            manifests,
            status: 'active' as const,
            lastScanAt: new Date()
        };

        const workspace = existing
            ? await Workspace.findOneAndUpdate(
                { _id: existing._id },
                { $set: nextPayload },
                { new: true, runValidators: true }
            )
            : await Workspace.create({
                ownerUserId,
                scopeType: scope.scopeType,
                scopeId,
                snapshotVersion: 1,
                ...nextPayload
            });

        if (!workspace) {
            throw new Error('Failed to provision workspace');
        }

        return {
            workspaceId: workspace._id.toString(),
            wasCreated: !existing,
            logicalRoot: workspace.logicalRoot,
            runtimeRoots: workspace.runtimeRoots,
            manifests: workspace.manifests,
            status: workspace.status,
            lastScanAt: workspace.lastScanAt ?? null
        };
    }

    async ensureWorkflowWorkspace(ownerUserId: string, workflowId: string): Promise<WorkspaceProvisioningResult> {
        return this.ensureWorkspace({ ownerUserId, scopeType: 'workflow', scopeId: workflowId });
    }

    async syncLegacyFunctionPaths(ownerUserId: string, workflowId: string): Promise<void> {
        const workspace = await this.ensureWorkflowWorkspace(ownerUserId, workflowId);

        const legacyFunctionPaths = {
            workflowId,
            pythonPath: workspace.runtimeRoots.sourceRoot,
            tsPath: workspace.runtimeRoots.sourceRoot
        };

        await UserSettings.updateOne(
            { userId: new mongoose.Types.ObjectId(ownerUserId) },
            {
                $setOnInsert: {
                    preferences: {
                        language: 'fr',
                        theme: 'dark',
                        saveMode: 'manual'
                    },
                    version: 1,
                    lastSync: null
                },
                $pull: {
                    functionPaths: { workflowId }
                }
            },
            { upsert: true }
        );

        await UserSettings.updateOne(
            { userId: new mongoose.Types.ObjectId(ownerUserId) },
            {
                $push: { functionPaths: legacyFunctionPaths }
            }
        );
    }

    private async ensureFilesystemRoots(logicalRoot: string, runtimeRoots: WorkspaceProvisioningResult['runtimeRoots']): Promise<void> {
        await fs.mkdir(logicalRoot, { recursive: true });
        await Promise.all([
            fs.mkdir(runtimeRoots.sourceRoot, { recursive: true }),
            fs.mkdir(runtimeRoots.manifestsRoot, { recursive: true }),
            fs.mkdir(runtimeRoots.buildRoot, { recursive: true }),
            fs.mkdir(runtimeRoots.outputRoot, { recursive: true })
        ]);
    }

    private async detectManifests(runtimeRoots: WorkspaceProvisioningResult['runtimeRoots']): Promise<IWorkspaceManifests> {
        const { sourceRoot, manifestsRoot } = runtimeRoots;
        const packageJson = await pathExists(`${sourceRoot}/package.json`) || await pathExists(`${manifestsRoot}/package.json`);
        const packageLockJson = await pathExists(`${sourceRoot}/package-lock.json`) || await pathExists(`${manifestsRoot}/package-lock.json`);
        const requirementsTxt = await pathExists(`${sourceRoot}/requirements.txt`) || await pathExists(`${manifestsRoot}/requirements.txt`);
        const pyprojectToml = await pathExists(`${sourceRoot}/pyproject.toml`) || await pathExists(`${manifestsRoot}/pyproject.toml`);

        return {
            packageJson,
            packageLockJson,
            requirementsTxt,
            pyprojectToml
        };
    }
}

export function createWorkspaceManager(): WorkspaceManager {
    return new WorkspaceManager();
}