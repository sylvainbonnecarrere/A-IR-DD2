import { AgentInstance } from '../../models/AgentInstance.model';
import { AgentJournal } from '../../models/AgentJournal.model';
import { WorkflowEdge } from '../../models/WorkflowEdge.model';
import { WorkflowNodeV2 } from '../../models/WorkflowNodeV2.model';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';

export class DeleteWorkflowUseCaseError extends Error {
  constructor(
    message: string,
    public readonly code: 'LAST_WORKFLOW',
  ) {
    super(message);
    this.name = 'DeleteWorkflowUseCaseError';
  }
}

export interface DeleteWorkflowInput {
  workflowId: string;
  userId: string;
}

export interface DeleteWorkflowResult {
  deletedWorkflowId: string;
  cascade: {
    agentsDeleted: number;
    edgesDeleted: number;
    nodesDeleted: number;
    journalsDeleted: number;
  };
  reassignedDefaultWorkflowId: string | null;
}

export class DeleteWorkflowUseCase {
  constructor(
    private readonly workflowRepository: IWorkflowRepository,
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(input: DeleteWorkflowInput): Promise<DeleteWorkflowResult | null> {
    const workflow = await this.workflowRepository.findOwnedById(input.workflowId, input.userId);
    if (!workflow) {
      return null;
    }

    const workflowCount = await this.workflowRepository.countByUserId(input.userId);
    if (workflowCount <= 1) {
      throw new DeleteWorkflowUseCaseError(
        'Chaque utilisateur doit avoir au moins un workflow',
        'LAST_WORKFLOW',
      );
    }

    const [agentDeleteResult, edgeDeleteResult, nodeDeleteResult, journalDeleteResult] = await Promise.all([
      AgentInstance.deleteMany({ workflowId: workflow._id }),
      WorkflowEdge.deleteMany({ workflowId: workflow._id }),
      WorkflowNodeV2.deleteMany({ workflowId: workflow._id }),
      AgentJournal.deleteMany({ workflowId: workflow._id }),
    ]);

    await this.workflowRepository.delete(input.workflowId);

    let reassignedDefaultWorkflowId: string | null = null;
    const replacementWorkflow = await this.workflowRepository.findFirstByUserId(input.userId);

    if (replacementWorkflow && (workflow.isDefault || workflow.isActive)) {
      const replacementId = replacementWorkflow._id.toString();

      if (workflow.isActive) {
        await this.workflowRepository.deactivateOthers(input.userId, replacementId);
      }

      if (workflow.isDefault) {
        await this.workflowRepository.unsetDefaultForOthers(input.userId, replacementId);
      }

      await this.workflowRepository.update(replacementId, {
        ...(workflow.isActive ? { isActive: true } : {}),
        ...(workflow.isDefault ? { isDefault: true } : {}),
      });

      if (workflow.isDefault) {
        await this.userRepository.setDefaultWorkflow(input.userId, replacementId);
      } else if (workflow.isActive) {
        await this.userRepository.setLastActiveWorkflow(input.userId, replacementId);
      }

      reassignedDefaultWorkflowId = workflow.isDefault ? replacementId : null;
    }

    await this.userRepository.syncWorkflowCount(input.userId, workflowCount - 1);

    return {
      deletedWorkflowId: input.workflowId,
      cascade: {
        agentsDeleted: agentDeleteResult.deletedCount ?? 0,
        edgesDeleted: edgeDeleteResult.deletedCount ?? 0,
        nodesDeleted: nodeDeleteResult.deletedCount ?? 0,
        journalsDeleted: journalDeleteResult.deletedCount ?? 0,
      },
      reassignedDefaultWorkflowId,
    };
  }
}