import mongoose from 'mongoose';
import { CreateWorkflowInstanceUseCase } from '../createWorkflowInstance.usecase';
import type { IWorkflow } from '../../../models/Workflow.model';
import type { IAgentInstance } from '../../../models/AgentInstance.model';
import type { IWorkflowNodeV2 } from '../../../models/WorkflowNodeV2.model';
import type { IAgentJournal } from '../../../models/AgentJournal.model';

describe('CreateWorkflowInstanceUseCase', () => {
  const workflowRepository = {
    findOwnedById: jest.fn(),
  } as unknown as jest.Mocked<ConstructorParameters<typeof CreateWorkflowInstanceUseCase>[0]>;

  const agentInstanceModel = {
    create: jest.fn(),
  } as unknown as jest.Mocked<ConstructorParameters<typeof CreateWorkflowInstanceUseCase>[1]>;

  const workflowNodeModel = {
    create: jest.fn(),
  } as unknown as jest.Mocked<ConstructorParameters<typeof CreateWorkflowInstanceUseCase>[2]>;

  const agentJournalModel = {
    create: jest.fn(),
  } as unknown as jest.Mocked<ConstructorParameters<typeof CreateWorkflowInstanceUseCase>[3]>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates the instance and graph node when the workflow belongs to the user', async () => {
    const workflowId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const instanceId = new mongoose.Types.ObjectId();
    const nodeId = new mongoose.Types.ObjectId();

    workflowRepository.findOwnedById.mockResolvedValue({
      _id: workflowId,
      userId,
      name: 'Workflow A',
      isActive: true,
    } as unknown as IWorkflow);

    agentInstanceModel.create.mockResolvedValue([
      { _id: instanceId, name: 'Agent A', role: 'assistant', status: 'running' },
    ] as unknown as IAgentInstance[]);
    workflowNodeModel.create.mockResolvedValue([
      { _id: nodeId, instanceId, position: { x: 10, y: 20 }, nodeType: 'agent' },
    ] as unknown as IWorkflowNodeV2[]);
    agentJournalModel.create.mockResolvedValue([{ _id: new mongoose.Types.ObjectId() }] as unknown as IAgentJournal[]);

    const useCase = new CreateWorkflowInstanceUseCase(workflowRepository, agentInstanceModel, workflowNodeModel, agentJournalModel);

    const result = await useCase.execute({
      workflowId: workflowId.toString(),
      userId: userId.toString(),
      body: {
        agentConfig: {
          name: 'Agent A',
          role: 'assistant',
          robotId: 'AR_001',
          configuration: {
            llmProvider: 'mock',
            llmModel: 'mock-model',
          },
        },
        position: { x: 10, y: 20 },
      },
    });

    expect(workflowRepository.findOwnedById).toHaveBeenCalledWith(workflowId.toString(), userId.toString());
    expect(agentInstanceModel.create).toHaveBeenCalledTimes(1);
    expect(workflowNodeModel.create).toHaveBeenCalledTimes(1);
    expect(agentJournalModel.create).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') {
      throw new Error('Expected created workflow instance result');
    }
    expect(result.instance).toEqual(expect.objectContaining({ _id: instanceId, name: 'Agent A' }));
    expect(result.node).toEqual(expect.objectContaining({ _id: nodeId, instanceId }));
  });

  it('returns not_found when the workflow is missing or not owned', async () => {
    workflowRepository.findOwnedById.mockResolvedValue(null);

    const useCase = new CreateWorkflowInstanceUseCase(workflowRepository, agentInstanceModel, workflowNodeModel, agentJournalModel);

    const result = await useCase.execute({
      workflowId: '507f1f77bcf86cd799439011',
      userId: '507f1f77bcf86cd799439012',
      body: {
        agentConfig: {
          name: 'Agent A',
          role: 'assistant',
          robotId: 'AR_001',
          configuration: {
            llmProvider: 'mock',
            llmModel: 'mock-model',
          },
        },
        position: { x: 0, y: 0 },
      },
    });

    expect(result.kind).toBe('not_found');
    expect(agentInstanceModel.create).not.toHaveBeenCalled();
  });
});
