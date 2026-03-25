import type { IWorkspaceManifests, IWorkspaceRuntimeRoots, WorkspaceScopeType, WorkspaceStatus } from '../../models';

export interface WorkspaceScopeRef {
    ownerUserId: string;
    scopeType: WorkspaceScopeType;
    scopeId: string;
}

export interface WorkspaceResolvedPaths {
    storageRoot: string;
    logicalRoot: string;
    runtimeRoots: IWorkspaceRuntimeRoots;
}

export interface WorkspaceProvisioningResult {
    workspaceId: string;
    wasCreated: boolean;
    logicalRoot: string;
    runtimeRoots: IWorkspaceRuntimeRoots;
    manifests: IWorkspaceManifests;
    status: WorkspaceStatus;
    lastScanAt?: Date | null;
}