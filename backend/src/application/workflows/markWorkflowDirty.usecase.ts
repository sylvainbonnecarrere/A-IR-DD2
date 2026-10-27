import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';

export interface MarkWorkflowDirtyInput {
  workflowId: string;
  userId: string;
}

export class MarkWorkflowDirtyUseCase {
  constructor(private readonly workflowRepository: IWorkflowRepository) {}

  async execute(input: MarkWorkflowDirtyInput) {
    const workflow = await this.workflowRepository.findOwnedById(input.workflowId, input.userId);
    if (!workflow) {
      return null;
    }

    return this.workflowRepository.update(input.workflowId, {
      isDirty: true,
    });
  }
}