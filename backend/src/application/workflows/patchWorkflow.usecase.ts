import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';

export interface PatchWorkflowInput {
  workflowId: string;
  userId: string;
  setFields: Record<string, unknown>;
  expectedVersion?: number;
}

export class PatchWorkflowUseCase {
  constructor(private readonly workflowRepository: IWorkflowRepository) {}

  async execute(input: PatchWorkflowInput) {
    return this.workflowRepository.patchOwned(
      input.workflowId,
      input.userId,
      input.setFields,
      input.expectedVersion,
    );
  }
}