import { IWorkflow } from '../../models/Workflow.model';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';
import { WorkflowValidator } from '../../validators/workflow-validator';

export interface SelectWorkflowInput {
  workflowId: string;
  userId: string;
}

export class SelectWorkflowUseCase {
  constructor(
    private readonly workflowRepository: IWorkflowRepository,
    private readonly userRepository: IUserRepository,
    private readonly workflowValidator?: WorkflowValidator,
  ) {}

  async execute(input: SelectWorkflowInput): Promise<IWorkflow | null> {
    const workflow = await this.workflowRepository.findOwnedById(input.workflowId, input.userId);
    if (!workflow) {
      return null;
    }

    if (this.workflowValidator) {
      await this.workflowValidator.selfHealStaleAgentReferences(input.workflowId, input.userId);
      this.workflowValidator.assertCanActivate(
        await this.workflowValidator.validateActivation(input.workflowId, input.userId),
      );
    }

    await this.workflowRepository.deactivateOthers(input.userId, input.workflowId);
    await this.workflowRepository.unsetDefaultForOthers(input.userId, input.workflowId);

    const updatedWorkflow = await this.workflowRepository.update(input.workflowId, {
      isActive: true,
      isDefault: true,
      lastSavedAt: new Date(),
    } as Partial<IWorkflow>);

    if (!updatedWorkflow) {
      return null;
    }

    await this.userRepository.setDefaultWorkflow(input.userId, input.workflowId);
    return updatedWorkflow;
  }
}