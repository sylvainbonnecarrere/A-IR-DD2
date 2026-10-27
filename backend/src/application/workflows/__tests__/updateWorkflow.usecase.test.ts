import { UpdateWorkflowUseCase } from '../updateWorkflow.usecase';
import { IWorkflowRepository } from '../../../repositories/IWorkflowRepository';
import { IUserRepository } from '../../../repositories/IUserRepository';

describe('UpdateWorkflowUseCase', () => {
  const workflowRepository = {
    findOwnedById: jest.fn(),
    deactivateOthers: jest.fn(),
    unsetDefaultForOthers: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<IWorkflowRepository>;
  const userRepository = {
    setDefaultWorkflow: jest.fn(),
    setLastActiveWorkflow: jest.fn(),
  } as unknown as jest.Mocked<IUserRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates a workflow and deactivates others when activating it', async () => {
    const useCase = new UpdateWorkflowUseCase(workflowRepository, userRepository);
    const workflow = { _id: { toString: () => 'wf-1' } };
    const updatedWorkflow = { _id: 'wf-1', isActive: true };

    workflowRepository.findOwnedById.mockResolvedValue(workflow as any);
    workflowRepository.deactivateOthers.mockResolvedValue(1);
    userRepository.setLastActiveWorkflow.mockResolvedValue({} as any);
    workflowRepository.update.mockResolvedValue(updatedWorkflow as any);

    const result = await useCase.execute({
      workflowId: 'wf-1',
      userId: 'user-1',
      updates: { isActive: true, name: 'Updated' },
    });

    expect(workflowRepository.deactivateOthers).toHaveBeenCalledWith('user-1', 'wf-1');
    expect(userRepository.setLastActiveWorkflow).toHaveBeenCalledWith('user-1', 'wf-1');
    expect(workflowRepository.update).toHaveBeenCalledWith(
      'wf-1',
      expect.objectContaining({ isActive: true, name: 'Updated', isDirty: false, lastSavedAt: expect.any(Date) })
    );
    expect(result).toBe(updatedWorkflow);
  });

  it('syncs default workflow pointers when setting a workflow as default', async () => {
    const useCase = new UpdateWorkflowUseCase(workflowRepository, userRepository);
    workflowRepository.findOwnedById.mockResolvedValue({ _id: 'wf-1' } as any);
    workflowRepository.unsetDefaultForOthers.mockResolvedValue(1);
    userRepository.setDefaultWorkflow.mockResolvedValue({} as any);
    workflowRepository.update.mockResolvedValue({ _id: 'wf-1', isDefault: true } as any);

    await useCase.execute({
      workflowId: 'wf-1',
      userId: 'user-1',
      updates: { isDefault: true },
    });

    expect(workflowRepository.unsetDefaultForOthers).toHaveBeenCalledWith('user-1', 'wf-1');
    expect(userRepository.setDefaultWorkflow).toHaveBeenCalledWith('user-1', 'wf-1');
  });

  it('returns null when the workflow is not owned by the user', async () => {
    const useCase = new UpdateWorkflowUseCase(workflowRepository, userRepository);
    workflowRepository.findOwnedById.mockResolvedValue(null);

    const result = await useCase.execute({
      workflowId: 'wf-1',
      userId: 'user-1',
      updates: { name: 'Ignored' },
    });

    expect(result).toBeNull();
    expect(workflowRepository.update).not.toHaveBeenCalled();
  });
});