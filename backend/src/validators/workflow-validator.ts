import { AgentInstance } from '../models/AgentInstance.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { IWorkflowNodeV2, WorkflowNodeV2 } from '../models/WorkflowNodeV2.model';

export type WorkflowValidationIssueCode =
  | 'MISSING_AGENT_INSTANCE'
  | 'BROKEN_EDGE_REFERENCE'
  | 'CYCLE_DETECTED';

export interface WorkflowValidationIssue {
  code: WorkflowValidationIssueCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

export class WorkflowValidationError extends Error {
  constructor(public readonly issues: WorkflowValidationIssue[]) {
    super('Workflow IR validation failed');
    this.name = 'WorkflowValidationError';
  }
}

export class WorkflowValidator {
  async validateActivation(workflowId: string, userId: string): Promise<WorkflowValidationResult> {
    const [nodes, edges, instances] = await Promise.all([
      WorkflowNodeV2.find({ workflowId, ownerId: userId }).lean(),
      WorkflowEdge.find({ workflowId, userId }).lean(),
      AgentInstance.find({ workflowId, userId }).select('_id').lean(),
    ]);

    return this.validateGraph(
      nodes,
      edges,
      instances.map((instance) => instance._id.toString()),
      true,
    );
  }

  assertCanActivate(result: WorkflowValidationResult): void {
    if (!result.valid) {
      throw new WorkflowValidationError(result.issues);
    }
  }

  validateGraph(
    nodes: Array<Pick<IWorkflowNodeV2, '_id' | 'nodeType' | 'instanceId'>>,
    edges: Array<{
      _id?: unknown;
      sourceInstanceId: { toString(): string } | string;
      targetInstanceId: { toString(): string } | string;
      sourceHandle?: string;
      targetHandle?: string;
    }>,
    existingInstanceIds: string[] = [],
    requireExistingInstanceIds: boolean = false,
  ): WorkflowValidationResult {
    const issues: WorkflowValidationIssue[] = [];

    const agentInstanceIds = new Set<string>(existingInstanceIds);
    nodes.forEach((node) => {
      if (node.nodeType !== 'agent') {
        return;
      }

      const instanceId = node.instanceId?.toString();

      if (!instanceId) {
        issues.push({
          code: 'MISSING_AGENT_INSTANCE',
          message: 'Un nœud agent ne référence aucune instance exécutable.',
          details: { nodeId: node._id?.toString?.() ?? String(node._id) },
        });
        return;
      }

      if (requireExistingInstanceIds && !agentInstanceIds.has(instanceId)) {
        issues.push({
          code: 'MISSING_AGENT_INSTANCE',
          message: 'Un nœud agent référence une instance absente du workflow.',
          details: {
            nodeId: node._id?.toString?.() ?? String(node._id),
            instanceId,
          },
        });
        return;
      }

      agentInstanceIds.add(instanceId);
    });

    const adjacency = new Map<string, Set<string>>();
    const validEdges: Array<{ source: string; target: string }> = [];

    edges.forEach((edge) => {
      const source = edge.sourceInstanceId.toString();
      const target = edge.targetInstanceId.toString();

      if (!agentInstanceIds.has(source) || !agentInstanceIds.has(target)) {
        issues.push({
          code: 'BROKEN_EDGE_REFERENCE',
          message: 'Une connexion référence une instance source ou cible absente du workflow.',
          details: { sourceInstanceId: source, targetInstanceId: target },
        });
        return;
      }

      validEdges.push({ source, target });
      const targets = adjacency.get(source) ?? new Set<string>();
      targets.add(target);
      adjacency.set(source, targets);
    });

    const visited = new Set<string>();
    const visiting = new Set<string>();

    const detectCycle = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) {
        return true;
      }
      if (visited.has(nodeId)) {
        return false;
      }

      visiting.add(nodeId);
      const targets = adjacency.get(nodeId);
      if (targets) {
        for (const target of targets) {
          if (detectCycle(target)) {
            return true;
          }
        }
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };

    for (const instanceId of agentInstanceIds) {
      if (detectCycle(instanceId)) {
        issues.push({
          code: 'CYCLE_DETECTED',
          message: 'Le graphe contient un cycle interdit pour l’activation du workflow.',
          details: { edgeCount: validEdges.length },
        });
        break;
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}