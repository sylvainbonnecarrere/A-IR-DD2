/**
 * WorkflowRepository - Implémentation de l'accès aux données workflow
 * Applique: Single Responsibility Principle (SOLID)
 */

import { Workflow, IWorkflow } from '../models/Workflow.model';
import { IWorkflowRepository, WorkflowPatchResult } from './IWorkflowRepository';

export class WorkflowRepository implements IWorkflowRepository {
  async findByUserId(userId: string): Promise<IWorkflow[]> {
    try {
      return await Workflow.find({ userId })
        .sort({ updatedAt: -1 })
        .exec();
    } catch (error) {
      console.error(`[WorkflowRepository] findByUserId error for ${userId}:`, error);
      throw error;
    }
  }

  async findById(workflowId: string): Promise<IWorkflow | null> {
    try {
      return await Workflow.findById(workflowId).exec();
    } catch (error) {
      console.error(`[WorkflowRepository] findById error for ${workflowId}:`, error);
      throw error;
    }
  }

  async findOwnedById(workflowId: string, userId: string): Promise<IWorkflow | null> {
    try {
      return await Workflow.findOne({ _id: workflowId, userId }).exec();
    } catch (error) {
      console.error(`[WorkflowRepository] findOwnedById error for workflow ${workflowId} and user ${userId}:`, error);
      throw error;
    }
  }

  async create(workflow: Omit<IWorkflow, '_id' | 'createdAt' | 'updatedAt'>): Promise<IWorkflow> {
    try {
      const newWorkflow = new Workflow(workflow);
      const saved = await newWorkflow.save();
      console.log(`[WorkflowRepository] Created workflow ${saved._id} for user ${workflow.userId}`);
      return saved;
    } catch (error) {
      console.error(`[WorkflowRepository] create error:`, error);
      throw error;
    }
  }

  async update(workflowId: string, updates: Partial<IWorkflow>): Promise<IWorkflow | null> {
    try {
      const updated = await Workflow.findByIdAndUpdate(
        workflowId,
        { $set: { ...updates, updatedAt: new Date() } },
        { new: true }
      ).exec();
      
      if (updated) {
        console.log(`[WorkflowRepository] Updated workflow ${workflowId}`);
      }
      return updated;
    } catch (error) {
      console.error(`[WorkflowRepository] update error for ${workflowId}:`, error);
      throw error;
    }
  }

  async delete(workflowId: string): Promise<boolean> {
    try {
      const result = await Workflow.findByIdAndDelete(workflowId).exec();
      const deleted = !!result;
      
      if (deleted) {
        console.log(`[WorkflowRepository] Deleted workflow ${workflowId}`);
      }
      return deleted;
    } catch (error) {
      console.error(`[WorkflowRepository] delete error for ${workflowId}:`, error);
      throw error;
    }
  }

  async countByUserId(userId: string): Promise<number> {
    try {
      return await Workflow.countDocuments({ userId }).exec();
    } catch (error) {
      console.error(`[WorkflowRepository] countByUserId error for ${userId}:`, error);
      throw error;
    }
  }

  async findFirstByUserId(userId: string): Promise<IWorkflow | null> {
    try {
      return await Workflow.findOne({ userId })
        .sort({ createdAt: 1 })
        .exec();
    } catch (error) {
      console.error(`[WorkflowRepository] findFirstByUserId error for ${userId}:`, error);
      throw error;
    }
  }

  async deactivateOthers(userId: string, exceptWorkflowId: string): Promise<number> {
    try {
      const result = await Workflow.updateMany(
        { userId, _id: { $ne: exceptWorkflowId } },
        { isActive: false }
      ).exec();

      return result.modifiedCount ?? 0;
    } catch (error) {
      console.error(`[WorkflowRepository] deactivateOthers error for user ${userId}:`, error);
      throw error;
    }
  }

  async unsetDefaultForOthers(userId: string, exceptWorkflowId: string): Promise<number> {
    try {
      const result = await Workflow.updateMany(
        { userId, _id: { $ne: exceptWorkflowId } },
        { isDefault: false }
      ).exec();

      return result.modifiedCount ?? 0;
    } catch (error) {
      console.error(`[WorkflowRepository] unsetDefaultForOthers error for user ${userId}:`, error);
      throw error;
    }
  }

  async patchOwned(
    workflowId: string,
    userId: string,
    setFields: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<WorkflowPatchResult> {
    try {
      const query: Record<string, unknown> = { _id: workflowId, userId };
      if (expectedVersion !== undefined) {
        query.__v = expectedVersion;
      }

      const updated = await Workflow.findOneAndUpdate(
        query,
        {
          $set: {
            ...setFields,
            updatedAt: new Date(),
            isDirty: false,
            lastSavedAt: new Date(),
          },
          $inc: { __v: 1 },
        },
        {
          new: true,
          runValidators: true,
        }
      ).exec();

      if (updated) {
        return { kind: 'updated', workflow: updated };
      }

      const existing = await Workflow.findOne({ _id: workflowId, userId }).select('__v').exec();
      if (!existing) {
        return { kind: 'not_found' };
      }

      return { kind: 'version_conflict', currentVersion: typeof existing.__v === 'number' ? existing.__v : null };
    } catch (error) {
      console.error(`[WorkflowRepository] patchOwned error for ${workflowId}:`, error);
      throw error;
    }
  }
}
