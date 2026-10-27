import mongoose from 'mongoose';
import { ListUserWorkflowsUseCase } from '../listUserWorkflows.usecase';
import { IAgentInstanceRepository } from '../../../repositories/IAgentInstanceRepository';
import { IUserRepository } from '../../../repositories/IUserRepository';
import { IWorkflowRepository } from '../../../repositories/IWorkflowRepository';

function buildWorkflow(name: string) {
  const _id = new mongoose.Types.ObjectId();

  return {
    _id,
    id: _id.toString(),
    name,
    toObject: jest.fn().mockReturnValue({
      _id,
      name
    })
  } as any;
}

describe('ListUserWorkflowsUseCase', () => {
  const workflowRepository: jest.Mocked<IWorkflowRepository> = {
    findByUserId: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    countByUserId: jest.fn(),
    findFirstByUserId: jest.fn()
  };
  const userRepository: jest.Mocked<IUserRepository> = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    setDefaultWorkflow: jest.fn(),
    syncWorkflowCount: jest.fn(),
    getDefaultWorkflowId: jest.fn()
  };
  const agentInstanceRepository: jest.Mocked<IAgentInstanceRepository> = {
    countByWorkflowIds: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates and assigns a default workflow when the user has none', async () => {
    const createdWorkflow = buildWorkflow('Mon Workflow');
    workflowRepository.findByUserId.mockResolvedValue([]);
    workflowRepository.create.mockResolvedValue(createdWorkflow);
    agentInstanceRepository.countByWorkflowIds.mockResolvedValue({ [createdWorkflow.id]: 0 });

    const useCase = new ListUserWorkflowsUseCase(workflowRepository, userRepository, agentInstanceRepository);
    const result = await useCase.execute({ userId: new mongoose.Types.ObjectId().toString() });

    expect(workflowRepository.create).toHaveBeenCalledTimes(1);
    expect(userRepository.setDefaultWorkflow).toHaveBeenCalledWith(expect.any(String), createdWorkflow.id);
    expect(userRepository.syncWorkflowCount).toHaveBeenCalledWith(expect.any(String), 1);
    expect(result.repairAction).toBe('created_default');
    expect(result.workflows).toEqual([
      expect.objectContaining({
        _id: createdWorkflow._id,
        name: 'Mon Workflow',
        agentCount: 0
      })
    ]);
  });

  it('re-synchronizes the user default workflow when it diverges from the first workflow', async () => {
    const firstWorkflow = buildWorkflow('First');
    const secondWorkflow = buildWorkflow('Second');
    workflowRepository.findByUserId.mockResolvedValue([firstWorkflow, secondWorkflow]);
    agentInstanceRepository.countByWorkflowIds.mockResolvedValue({
      [firstWorkflow.id]: 2,
      [secondWorkflow.id]: 1
    });

    const useCase = new ListUserWorkflowsUseCase(workflowRepository, userRepository, agentInstanceRepository);
    const result = await useCase.execute({
      userId: new mongoose.Types.ObjectId().toString(),
      currentDefaultWorkflowId: secondWorkflow.id
    });

    expect(userRepository.setDefaultWorkflow).toHaveBeenCalledWith(expect.any(String), firstWorkflow.id);
    expect(userRepository.syncWorkflowCount).toHaveBeenCalledWith(expect.any(String), 2);
    expect(result.repairAction).toBe('synced_default');
    expect(result.workflows[0]).toEqual(expect.objectContaining({ name: 'First', agentCount: 2 }));
    expect(result.workflows[1]).toEqual(expect.objectContaining({ name: 'Second', agentCount: 1 }));
  });
});