import { IWorkflow } from '../../models/Workflow.model';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';
import { WorkflowValidator } from '../../validators/workflow-validator';

export interface UpdateWorkflowInput {
  workflowId: string;
  userId: string;
  updates: {
    name?: string;
    description?: string;
    isActive?: boolean;
    isDefault?: boolean;
  };
}

export class UpdateWorkflowUseCase {
  constructor(
    private readonly workflowRepository: IWorkflowRepository,
    private readonly userRepository: IUserRepository,
    private readonly workflowValidator?: WorkflowValidator,
  ) {}

  async execute(input: UpdateWorkflowInput): Promise<IWorkflow | null> {
    const workflow = await this.workflowRepository.findOwnedById(input.workflowId, input.userId);
    if (!workflow) {
      return null;
    }

    if (input.updates.isActive === true) {
      if (this.workflowValidator) {
        this.workflowValidator.assertCanActivate(
          await this.workflowValidator.validateActivation(input.workflowId, input.userId),
        );
      }

      await this.workflowRepository.deactivateOthers(input.userId, input.workflowId);
      await this.userRepository.setLastActiveWorkflow(input.userId, input.workflowId);
    }

    if (input.updates.isDefault === true) {
      await this.workflowRepository.unsetDefaultForOthers(input.userId, input.workflowId);
      await this.userRepository.setDefaultWorkflow(input.userId, input.workflowId);
    }

    return this.workflowRepository.update(input.workflowId, {
      ...input.updates,
      lastSavedAt: new Date(),
      isDirty: false,
    } as Partial<IWorkflow>);
  }
}