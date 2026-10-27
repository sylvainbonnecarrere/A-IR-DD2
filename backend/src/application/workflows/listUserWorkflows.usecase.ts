import mongoose from 'mongoose';
import { IWorkflow } from '../../models/Workflow.model';
import { IAgentInstanceRepository } from '../../repositories/IAgentInstanceRepository';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';

export interface ListUserWorkflowsInput {
  userId: string;
  currentDefaultWorkflowId?: string | null;
}

export interface WorkflowListItem extends Record<string, unknown> {
  agentCount: number;
}

export interface ListUserWorkflowsResult {
  workflows: WorkflowListItem[];
  repairAction: 'created_default' | 'synced_default' | 'none';
}

function buildDefaultWorkflow(userId: string) {
  return {
    userId: new mongoose.Types.ObjectId(userId),
    name: 'Mon Workflow',
    description: 'Workflow créé automatiquement pour débuter',
    isActive: true,
    isDefault: true,
    isDirty: false,
    canvasState: {
      zoom: 1,
      panX: 0,
      panY: 0
    }
  } as Omit<IWorkflow, '_id' | 'createdAt' | 'updatedAt'>;
}

export class ListUserWorkflowsUseCase {
  constructor(
    private readonly workflowRepository: IWorkflowRepository,
    private readonly userRepository: IUserRepository,
    private readonly agentInstanceRepository: IAgentInstanceRepository
  ) {}

  async execute(input: ListUserWorkflowsInput): Promise<ListUserWorkflowsResult> {
    let workflows = await this.workflowRepository.findByUserId(input.userId);
    let repairAction: ListUserWorkflowsResult['repairAction'] = 'none';

    if (workflows.length === 0) {
      const defaultWorkflow = await this.workflowRepository.create(buildDefaultWorkflow(input.userId));
      workflows = [defaultWorkflow];
      await this.userRepository.setDefaultWorkflow(input.userId, defaultWorkflow._id.toString());
      await this.userRepository.syncWorkflowCount(input.userId, 1);
      repairAction = 'created_default';
    } else {
      const firstWorkflowId = workflows[0]._id.toString();
      const currentDefaultWorkflowId = input.currentDefaultWorkflowId || null;

      if (currentDefaultWorkflowId !== firstWorkflowId) {
        await this.userRepository.setDefaultWorkflow(input.userId, firstWorkflowId);
        await this.userRepository.syncWorkflowCount(input.userId, workflows.length);
        repairAction = 'synced_default';
      }
    }

    const workflowIds = workflows.map((workflow) => workflow.id);
    const agentCountByWorkflowId = await this.agentInstanceRepository.countByWorkflowIds(workflowIds);

    return {
      repairAction,
      workflows: workflows.map((workflow) => ({
        ...workflow.toObject(),
        agentCount: agentCountByWorkflowId[workflow.id] || 0
      }))
    };
  }
}