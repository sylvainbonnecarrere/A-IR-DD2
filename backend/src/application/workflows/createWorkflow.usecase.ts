import mongoose from 'mongoose';
import { IWorkflow } from '../../models/Workflow.model';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';

export interface CreateWorkflowInput {
  userId: string;
  name: string;
  description?: string;
}

export class CreateWorkflowUseCase {
  constructor(
    private readonly workflowRepository: IWorkflowRepository,
    private readonly userRepository: IUserRepository
  ) {}

  async execute(input: CreateWorkflowInput) {
    const existingCount = await this.workflowRepository.countByUserId(input.userId);
    const isFirstWorkflow = existingCount === 0;

    const workflow = await this.workflowRepository.create({
      userId: new mongoose.Types.ObjectId(input.userId),
      name: input.name,
      description: input.description,
      isActive: isFirstWorkflow,
      isDefault: isFirstWorkflow,
      isDirty: false,
      canvasState: {
        zoom: 1,
        panX: 0,
        panY: 0
      }
    } as Omit<IWorkflow, '_id' | 'createdAt' | 'updatedAt'>);

    if (isFirstWorkflow) {
      await this.userRepository.setDefaultWorkflow(input.userId, workflow._id.toString());
    }

    await this.userRepository.syncWorkflowCount(input.userId, existingCount + 1);

    return workflow;
  }
}