import type {
    DeleteAgentInstancePolicyAudit,
    DeleteAgentInstanceWithPolicyParams,
    MediaDeletionAuditAnomaly,
} from './agentInstanceDeletionPolicy.service';
import type { RepairLegacyJournalMediaCatalogResult } from './mediaCatalog.service';

export interface AgentInstanceDeletionAuditCounters {
    journalsDeleted: number;
    mediaFilesDeleted: number;
    mediaReferencesDeleted: number;
    mediaReferencesOrphaned: number;
    retainedMediaEntries: number;
}

export interface BuildAgentInstanceDeletionAuditParams {
    instanceName: string;
    params: DeleteAgentInstanceWithPolicyParams;
    anomalies: MediaDeletionAuditAnomaly[];
    counters: AgentInstanceDeletionAuditCounters;
    mediaReferenceCount: number;
    mediaJournalCount: number;
    storageBreakdown: Record<'db' | 'local' | 'cloud', number>;
    legacyCatalogRepair: RepairLegacyJournalMediaCatalogResult;
}

export function buildAgentInstanceDeletionAudit(
    params: BuildAgentInstanceDeletionAuditParams,
): DeleteAgentInstancePolicyAudit {
    return {
        instanceId: params.params.instanceId,
        workflowId: params.params.workflowId,
        instanceName: params.instanceName,
        mediaPolicy: params.params.mediaPolicy,
        triggeredBy: params.params.triggeredBy || params.params.userId,
        origin: params.params.auditOrigin || 'agent_instance_delete_route',
        severity: params.anomalies.length > 0 ? 'warn' : 'info',
        anomalyCount: params.anomalies.reduce((total, anomaly) => total + anomaly.count, 0),
        mediaReferenceCount: params.mediaReferenceCount,
        mediaJournalCount: params.mediaJournalCount,
        anomalies: params.anomalies,
        details: {
            instanceId: params.params.instanceId,
            instanceName: params.instanceName,
            workflowId: params.params.workflowId,
            mediaPolicy: params.params.mediaPolicy,
            deleteInstanceRequested: params.params.deleteInstance !== false,
            origin: params.params.auditOrigin || 'agent_instance_delete_route',
            storageBreakdown: params.storageBreakdown,
            legacyCatalogRepair: params.legacyCatalogRepair,
            deletedCounts: params.counters,
            mediaReferenceCount: params.mediaReferenceCount,
            mediaJournalCount: params.mediaJournalCount,
            anomalies: params.anomalies,
        },
    };
}