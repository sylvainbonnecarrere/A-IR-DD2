import { Request } from 'express';
import { IUser } from '../models/User.model';
import { IWorkflowRepository } from '../repositories/IWorkflowRepository';

export const buildWorkflowOwnershipResolver = (workflowRepository: IWorkflowRepository) => {
  return async (workflowId: string, userId?: string): Promise<string | null> => {
    if (!userId) {
      return null;
    }

    const workflow = await workflowRepository.findById(workflowId);
    if (!workflow) {
      return null;
    }

    return workflow.userId.toString();
  };
};

export const resolveWorkflowOwnership = (
  workflowRepository: IWorkflowRepository,
  req: Request,
): Promise<string | null> => {
  const user = req.user as IUser | undefined;
  const userId = user?._id?.toString() ?? user?.id;
  return buildWorkflowOwnershipResolver(workflowRepository)(req.params.id, userId);
};
