import { SelectWorkflowUseCase } from '../selectWorkflow.usecase';
import { IWorkflowRepository } from '../../../repositories/IWorkflowRepository';
import type { IWorkflow } from '../../../models/Workflow.model';
import type { IUser } from '../../../models/User.model';
import { IUserRepository } from '../../../repositories/IUserRepository';

describe('SelectWorkflowUseCase', () => {
  const workflowRepository = {
    findOwnedById: jest.fn(),
    deactivateOthers: jest.fn(),
    unsetDefaultForOthers: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<IWorkflowRepository>;
  const userRepository = {
    setDefaultWorkflow: jest.fn(),
  } as unknown as jest.Mocked<IUserRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('activates the selected workflow and syncs user pointers', async () => {
    const useCase = new SelectWorkflowUseCase(workflowRepository, userRepository);
    const updatedWorkflow = { _id: 'wf-1', isActive: true, isDefault: true };

    workflowRepository.findOwnedById.mockResolvedValue({ _id: 'wf-1' } as unknown as IWorkflow);
    workflowRepository.deactivateOthers.mockResolvedValue(1);
    workflowRepository.unsetDefaultForOthers.mockResolvedValue(1);
    workflowRepository.update.mockResolvedValue(updatedWorkflow as unknown as IWorkflow);
    userRepository.setDefaultWorkflow.mockResolvedValue({} as unknown as IUser);

    const result = await useCase.execute({ workflowId: 'wf-1', userId: 'user-1' });

    expect(workflowRepository.deactivateOthers).toHaveBeenCalledWith('user-1', 'wf-1');
    expect(workflowRepository.unsetDefaultForOthers).toHaveBeenCalledWith('user-1', 'wf-1');
    expect(workflowRepository.update).toHaveBeenCalledWith(
      'wf-1',
      expect.objectContaining({ isActive: true, isDefault: true, lastSavedAt: expect.any(Date) }),
    );
    expect(userRepository.setDefaultWorkflow).toHaveBeenCalledWith('user-1', 'wf-1');
    expect(result).toBe(updatedWorkflow);
  });

  it('returns null when the workflow is not owned by the user', async () => {
    const useCase = new SelectWorkflowUseCase(workflowRepository, userRepository);
    workflowRepository.findOwnedById.mockResolvedValue(null);

    const result = await useCase.execute({ workflowId: 'wf-1', userId: 'user-1' });

    expect(result).toBeNull();
    expect(workflowRepository.update).not.toHaveBeenCalled();
  });
});
