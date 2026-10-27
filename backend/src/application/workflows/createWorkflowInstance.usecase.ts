import mongoose from 'mongoose';
import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';
import type { PersistenceConfig, CreateInstanceRequestBody } from '../../types/persistence';
import { DEFAULT_PERSISTENCE_CONFIG, normalizePersistenceConfigForPersistence } from '../../types/persistence';

export interface CreateWorkflowInstanceInput {
  workflowId: string;
  userId: string;
  body: CreateInstanceRequestBody;
}

export type CreateWorkflowInstanceResult =
  | {
      kind: 'created';
      instance: any;
      node: any;
      journal: any;
    }
  | {
      kind: 'not_found';
    };

export class CreateWorkflowInstanceUseCase {
  constructor(
    private readonly workflowRepository: IWorkflowRepository,
    private readonly agentInstanceModel: {
      create: (documents: unknown[], options?: { session?: mongoose.ClientSession }) => Promise<any[]>;
    },
    private readonly workflowNodeModel: {
      create: (documents: unknown[], options?: { session?: mongoose.ClientSession }) => Promise<any[]>;
    },
    private readonly agentJournalModel: {
      create: (documents: unknown[], options?: { session?: mongoose.ClientSession }) => Promise<any[]>;
    },
  ) {}

  async execute(
    input: CreateWorkflowInstanceInput,
    session?: mongoose.ClientSession,
  ): Promise<CreateWorkflowInstanceResult> {
    const workflow = await this.workflowRepository.findOwnedById(input.workflowId, input.userId);
    if (!workflow) {
      return { kind: 'not_found' };
    }

    const { agentConfig, persistenceOptions, position } = input.body;
    const config = agentConfig.configuration;
    const persistenceConfig: PersistenceConfig = {
      ...normalizePersistenceConfigForPersistence({
        ...DEFAULT_PERSISTENCE_CONFIG,
        ...persistenceOptions,
      }),
    };

    const instanceData = {
      workflowId: new mongoose.Types.ObjectId(input.workflowId),
      userId: new mongoose.Types.ObjectId(input.userId),
      prototypeId: agentConfig.prototypeId ? new mongoose.Types.ObjectId(agentConfig.prototypeId) : undefined,
      executionId: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      name: agentConfig.name,
      role: agentConfig.role,
      robotId: agentConfig.robotId,
      llmProvider: config.llmProvider || 'openai',
      llmModel: config.llmModel || 'gpt-4',
      systemPrompt: config.systemPrompt || '',
      tools: config.tools || [],
      capabilities: [],
      outputConfig: config.outputConfig,
      historyConfig: config.historyConfig,
      position,
      isMinimized: false,
      isMaximized: false,
      zIndex: 0,
      content: [],
      metrics: {
        executionCount: 0,
        totalTokensUsed: 0,
        averageResponseTime: 0,
        lastExecutionTime: new Date(),
        errorCount: 0,
      },
      status: 'running',
      persistenceConfig,
    };

    const [instance] = await this.agentInstanceModel.create([instanceData], session ? { session } : undefined);

    const nodeData = {
      workflowId: new mongoose.Types.ObjectId(input.workflowId),
      ownerId: new mongoose.Types.ObjectId(input.userId),
      instanceId: instance._id,
      nodeType: 'agent' as const,
      position,
      uiConfig: {
        label: agentConfig.name,
        expanded: true,
      },
    };

    const [node] = await this.workflowNodeModel.create([nodeData], session ? { session } : undefined);

    const [journal] = await this.agentJournalModel.create([{
      agentInstanceId: instance._id,
      workflowId: new mongoose.Types.ObjectId(input.workflowId),
      type: 'system',
      severity: 'info',
      payload: {
        event: 'instance_created',
        details: {
          name: instance.name,
          role: instance.role,
          nodeId: node._id.toString(),
        },
        triggeredBy: input.userId,
      },
      timestamp: new Date(),
    }], session ? { session } : undefined);

    return {
      kind: 'created',
      instance,
      node,
      journal,
    };
  }
}
