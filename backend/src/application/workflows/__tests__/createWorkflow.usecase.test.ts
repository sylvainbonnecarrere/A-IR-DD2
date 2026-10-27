import mongoose from 'mongoose';
import { CreateWorkflowUseCase } from '../createWorkflow.usecase';
import { IUserRepository } from '../../../repositories/IUserRepository';
import { IWorkflowRepository } from '../../../repositories/IWorkflowRepository';

describe('CreateWorkflowUseCase', () => {
  const workflowRepository: jest.Mocked<IWorkflowRepository> = {
    findByUserId: jest.fn(),
    findById: jest.fn(),
    findOwnedById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    countByUserId: jest.fn(),
    findFirstByUserId: jest.fn(),
    deactivateOthers: jest.fn(),
    unsetDefaultForOthers: jest.fn(),
    patchOwned: jest.fn(),
  };
  const userRepository: jest.Mocked<IUserRepository> = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    setDefaultWorkflow: jest.fn(),
    setLastActiveWorkflow: jest.fn(),
    syncWorkflowCount: jest.fn(),
    getDefaultWorkflowId: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates an active default workflow for a user with no workflow', async () => {
    const workflowId = new mongoose.Types.ObjectId();
    workflowRepository.countByUserId.mockResolvedValue(0);
    workflowRepository.create.mockResolvedValue({
      _id: workflowId,
      id: workflowId.toString()
    } as any);

    const useCase = new CreateWorkflowUseCase(workflowRepository, userRepository);
    const workflow = await useCase.execute({
      userId: new mongoose.Types.ObjectId().toString(),
      name: 'First workflow'
    });

    expect(workflowRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'First workflow',
      isActive: true,
      isDefault: true,
      isDirty: false,
      canvasState: { zoom: 1, panX: 0, panY: 0 }
    }));
    expect(userRepository.setDefaultWorkflow).toHaveBeenCalledWith(expect.any(String), workflowId.toString());
    expect(userRepository.syncWorkflowCount).toHaveBeenCalledWith(expect.any(String), 1);
    expect(workflow).toEqual(expect.objectContaining({ id: workflowId.toString() }));
  });

  it('creates a non-default workflow and only resynchronizes the count when workflows already exist', async () => {
    workflowRepository.countByUserId.mockResolvedValue(2);
    workflowRepository.create.mockResolvedValue({ _id: new mongoose.Types.ObjectId(), id: 'wf-2' } as any);

    const useCase = new CreateWorkflowUseCase(workflowRepository, userRepository);
    await useCase.execute({
      userId: new mongoose.Types.ObjectId().toString(),
      name: 'Additional workflow',
      description: 'desc'
    });

    expect(workflowRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Additional workflow',
      description: 'desc',
      isActive: false,
      isDefault: false
    }));
    expect(userRepository.setDefaultWorkflow).not.toHaveBeenCalled();
    expect(userRepository.syncWorkflowCount).toHaveBeenCalledWith(expect.any(String), 3);
  });
});