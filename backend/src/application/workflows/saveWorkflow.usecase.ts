import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';

export interface SaveWorkflowInput {
  workflowId: string;
  userId: string;
}

export class SaveWorkflowUseCase {
  constructor(private readonly workflowRepository: IWorkflowRepository) {}

  async execute(input: SaveWorkflowInput) {
    const workflow = await this.workflowRepository.findOwnedById(input.workflowId, input.userId);
    if (!workflow) {
      return null;
    }

    return this.workflowRepository.update(input.workflowId, {
      lastSavedAt: new Date(),
      isDirty: false,
    });
  }
}