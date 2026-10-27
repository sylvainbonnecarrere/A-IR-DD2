import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { IAgentInstanceRepository } from './IAgentInstanceRepository';

export class AgentInstanceRepository implements IAgentInstanceRepository {
  async countByWorkflowIds(workflowIds: string[]): Promise<Record<string, number>> {
    if (workflowIds.length === 0) {
      return {};
    }

    const objectIds = workflowIds
      .filter((workflowId) => mongoose.Types.ObjectId.isValid(workflowId))
      .map((workflowId) => new mongoose.Types.ObjectId(workflowId));

    if (objectIds.length === 0) {
      return {};
    }

    const counts = await AgentInstance.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $match: { workflowId: { $in: objectIds } } },
      { $group: { _id: '$workflowId', count: { $sum: 1 } } }
    ]);

    const countByWorkflowId = Object.fromEntries(workflowIds.map((workflowId) => [workflowId, 0]));

    for (const entry of counts) {
      countByWorkflowId[entry._id.toString()] = entry.count;
    }

    return countByWorkflowId;
  }
}