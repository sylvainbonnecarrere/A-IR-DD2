/**
 * UserRepository - Implémentation de l'accès aux données utilisateur
 * Applique: Single Responsibility Principle (SOLID)
 * 
 * Responsabilité unique: Translater les opérations métier en requêtes MongoDB
 */

import { User, IUser } from '../models/User.model';
import { IUserRepository } from './IUserRepository';

export class UserRepository implements IUserRepository {
  async findById(userId: string): Promise<IUser | null> {
    try {
      return await User.findById(userId).exec();
    } catch (error) {
      console.error(`[UserRepository] findById error for ${userId}:`, error);
      throw error;
    }
  }

  async findByEmail(email: string): Promise<IUser | null> {
    try {
      return await User.findOne({ email }).exec();
    } catch (error) {
      console.error(`[UserRepository] findByEmail error for ${email}:`, error);
      throw error;
    }
  }

  async setDefaultWorkflow(userId: string, defaultWorkflowId: string): Promise<IUser> {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            defaultWorkflowId,
            lastActiveWorkflowId: defaultWorkflowId,
            updatedAt: new Date()
          }
        },
        { new: true }
      ).exec();

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      console.log(`[UserRepository] Default workflow set for user ${userId}: ${defaultWorkflowId}`);
      return user;
    } catch (error) {
      console.error(`[UserRepository] setDefaultWorkflow error:`, error);
      throw error;
    }
  }

  async syncWorkflowCount(userId: string, workflowCount: number): Promise<IUser> {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            workflowCount,
            updatedAt: new Date()
          }
        },
        { new: true }
      ).exec();

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      console.log(`[UserRepository] Workflow count synced for user ${userId}: ${workflowCount}`);
      return user;
    } catch (error) {
      console.error(`[UserRepository] syncWorkflowCount error:`, error);
      throw error;
    }
  }

  async getDefaultWorkflowId(userId: string): Promise<string | null> {
    try {
      const user = await User.findById(userId).select('defaultWorkflowId').exec();
      return user?.defaultWorkflowId?.toString() || null;
    } catch (error) {
      console.error(`[UserRepository] getDefaultWorkflowId error:`, error);
      throw error;
    }
  }
}
