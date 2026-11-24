import { DeleteWorkflowUseCase, DeleteWorkflowUseCaseError } from '../deleteWorkflow.usecase';
import { IWorkflowRepository } from '../../../repositories/IWorkflowRepository';
import type { IWorkflow } from '../../../models/Workflow.model';
import type { IUser } from '../../../models/User.model';
import { IUserRepository } from '../../../repositories/IUserRepository';

jest.mock('../../../models/AgentInstance.model', () => ({
  AgentInstance: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }) },
}));
jest.mock('../../../models/WorkflowEdge.model', () => ({
  WorkflowEdge: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) },
}));
jest.mock('../../../models/WorkflowNodeV2.model', () => ({
  WorkflowNodeV2: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }) },
}));
jest.mock('../../../models/AgentJournal.model', () => ({
  AgentJournal: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 4 }) },
}));

describe('DeleteWorkflowUseCase', () => {
  const workflowRepository = {
    findOwnedById: jest.fn(),
    countByUserId: jest.fn(),
    delete: jest.fn(),
    findFirstByUserId: jest.fn(),
    deactivateOthers: jest.fn(),
    unsetDefaultForOthers: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<IWorkflowRepository>;
  const userRepository = {
    setDefaultWorkflow: jest.fn(),
    setLastActiveWorkflow: jest.fn(),
    syncWorkflowCount: jest.fn(),
  } as unknown as jest.Mocked<IUserRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reassigns the default workflow when deleting the active default workflow', async () => {
    const useCase = new DeleteWorkflowUseCase(workflowRepository, userRepository);
    workflowRepository.findOwnedById.mockResolvedValue({ _id: 'wf-1', isDefault: true, isActive: true } as unknown as IWorkflow);
    workflowRepository.countByUserId.mockResolvedValue(2);
    workflowRepository.delete.mockResolvedValue(true);
    workflowRepository.findFirstByUserId.mockResolvedValue({ _id: 'wf-2' } as unknown as IWorkflow);
    workflowRepository.deactivateOthers.mockResolvedValue(1);
    workflowRepository.unsetDefaultForOthers.mockResolvedValue(1);
    workflowRepository.update.mockResolvedValue({ _id: 'wf-2', isDefault: true, isActive: true } as unknown as IWorkflow);
    userRepository.setDefaultWorkflow.mockResolvedValue({} as unknown as IUser);
    userRepository.syncWorkflowCount.mockResolvedValue({} as unknown as IUser);

    const result = await useCase.execute({ workflowId: 'wf-1', userId: 'user-1' });

    expect(workflowRepository.delete).toHaveBeenCalledWith('wf-1');
    expect(userRepository.setDefaultWorkflow).toHaveBeenCalledWith('user-1', 'wf-2');
    expect(userRepository.syncWorkflowCount).toHaveBeenCalledWith('user-1', 1);
    expect(result).toEqual(
      expect.objectContaining({
        deletedWorkflowId: 'wf-1',
        reassignedDefaultWorkflowId: 'wf-2',
        cascade: expect.objectContaining({
          agentsDeleted: 2,
          edgesDeleted: 1,
          nodesDeleted: 3,
          journalsDeleted: 4,
        }),
      }),
    );
  });

  it('rejects deletion of the last remaining workflow', async () => {
    const useCase = new DeleteWorkflowUseCase(workflowRepository, userRepository);
    workflowRepository.findOwnedById.mockResolvedValue({ _id: 'wf-1', isDefault: true, isActive: true } as unknown as IWorkflow);
    workflowRepository.countByUserId.mockResolvedValue(1);

    await expect(useCase.execute({ workflowId: 'wf-1', userId: 'user-1' })).rejects.toMatchObject({
      code: 'LAST_WORKFLOW',
    } as DeleteWorkflowUseCaseError);
  });
});
