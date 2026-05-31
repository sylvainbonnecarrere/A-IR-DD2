import type mongoose from 'mongoose';
import type { WorkspaceProvisioningResult } from '../services/workspace/types';

export interface FunctionWorkspaceContext {
    workspaceId: string;
    logicalRoot: string;
    runtimeRoots: WorkspaceProvisioningResult['runtimeRoots'];
    manifests: WorkspaceProvisioningResult['manifests'];
    status: WorkspaceProvisioningResult['status'];
    lastScanAt?: Date | null;
}

export interface LegacyFunctionReadModel {
    _id: string | mongoose.Types.ObjectId;
    name: string;
    displayName?: string;
    description: string;
    language: 'typescript' | 'python';
    origin: 'native' | 'custom';
    tags: string[];
    userId?: string | mongoose.Types.ObjectId | null;
    workflowId?: string | mongoose.Types.ObjectId | null;
    inputSchema: object;
    outputSchema: object;
    codePath?: string | null;
    codeInline?: string | null;
    dependencies?: {
        python?: string[];
        npm?: string[];
    } | string[];
    isEnabled: boolean;
    isReadonly: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    workspaceContext?: FunctionWorkspaceContext;
    resolvedCodePath?: string | null;
    codePathRoot?: 'workspace_source' | 'absolute' | 'native_repo' | 'legacy_relative' | null;
}
