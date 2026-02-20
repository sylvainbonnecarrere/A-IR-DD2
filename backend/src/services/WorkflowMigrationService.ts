/**
 * WorkflowMigrationService - Implémentation du service de migration
 * Applique: SOLID principles - Single Responsibility, Open/Closed, Dependency Inversion
 */

import mongoose from 'mongoose';
import { IWorkflowMigrationService, IMigrationResult } from './IWorkflowMigrationService';
import { IUserRepository } from '../repositories/IUserRepository';
import { IWorkflowRepository } from '../repositories/IWorkflowRepository';
import { IWorkflow } from '../models/Workflow.model';
import { IUser } from '../models/User.model';
import { User } from '../models/User.model';

/**
 * Migration orchestrator - Utilise l'injection de dépendances
 * Facile à tester, découplé de MongoDB
 */
export class WorkflowMigrationService implements IWorkflowMigrationService {
  constructor(
    private userRepository: IUserRepository,
    private workflowRepository: IWorkflowRepository
  ) {}

  /**
   * Assure qu'un utilisateur a un workflow par défaut (IDEMPOTENT)
   * 
   * Flow:
   * 1. Récupère l'utilisateur
   * 2. Si defaultWorkflowId existe → retour OK
   * 3. Si workflows existent → assigne le plus ancien
   * 4. Sinon → crée workflow par défaut
   * 5. Met à jour User record
   */
  async ensureUserHasDefaultWorkflow(userId: string): Promise<IMigrationResult> {
    try {
      // 1. Fetch user
      const user = await this.userRepository.findById(userId);
      if (!user) {
        return {
          success: false,
          workflow: null,
          user: null,
          action: 'already_set',
          error: `User ${userId} not found`,
          message: 'Utilisateur non trouvé'
        };
      }

      // 2. User already has default workflow → idempotent return
      if (user.defaultWorkflowId) {
        const existingWorkflow = await this.workflowRepository.findById(
          user.defaultWorkflowId.toString()
        );
        
        if (existingWorkflow) {
          return {
            success: true,
            workflow: existingWorkflow,
            user,
            action: 'already_set',
            message: `Workflow par défaut déjà assigné: ${existingWorkflow.name}`
          };
        }
      }

      // 3. No default workflow → find or create one
      const workflows = await this.workflowRepository.findByUserId(userId);

      let targetWorkflow: IWorkflow | null = null;
      let action: 'created' | 'assigned' | 'already_set' = 'created';

      if (workflows.length > 0) {
        // Use first workflow as default
        targetWorkflow = workflows[0];
        action = 'assigned';
        console.log(`[WorkflowMigrationService] Migration: User ${userId} had ${workflows.length} workflows, assigning first as default`);
      } else {
        // Create default workflow
        targetWorkflow = await this.createDefaultWorkflow(userId);
        action = 'created';
        console.log(`[WorkflowMigrationService] Migration: Created default workflow for user ${userId}`);
      }

      // 4. Update User record
      const updatedUser = await this.userRepository.setDefaultWorkflow(
        userId,
        targetWorkflow._id.toString()
      );

      // 5. Sync workflow count
      const count = await this.workflowRepository.countByUserId(userId);
      await this.userRepository.syncWorkflowCount(userId, count);

      console.log(`[WorkflowMigrationService] Success: User ${userId} now has default workflow ${targetWorkflow._id}`);

      return {
        success: true,
        workflow: targetWorkflow,
        user: updatedUser,
        action,
        message: action === 'created' 
          ? `Workflow par défaut créé: ${targetWorkflow.name}`
          : `Workflow assigné: ${targetWorkflow.name}`
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[WorkflowMigrationService] ensureUserHasDefaultWorkflow failed for ${userId}:`, error);
      return {
        success: false,
        workflow: null,
        user: null,
        action: 'already_set',
        error: errorMsg,
        message: `Erreur lors de la migration: ${errorMsg}`
      };
    }
  }

/**
 * Crée un workflow par défaut avec settings standards
 */
async createDefaultWorkflow(userId: string): Promise<IWorkflow> {
    const workflowData = {
      userId: new mongoose.Types.ObjectId(userId),
      name: 'Mon Workflow',
      description: 'Workflow créé automatiquement pour débuter',
      isActive: true,
      isDefault: true
    } as Omit<IWorkflow, '_id' | 'createdAt' | 'updatedAt'>;
    
    const defaultWorkflow = await this.workflowRepository.create(workflowData);

    return defaultWorkflow;
  }

  /**
   * Migre tous les utilisateurs existants sans defaultWorkflowId (batch operation)
   * À utiliser une seule fois au déploiement
   */
  async migrateExistingUsers(batchSize: number = 100): Promise<{ migratedCount: number; errors: string[] }> {
    let migratedCount = 0;
    const errors: string[] = [];

    try {
      // Trouver tous les utilisateurs sans defaultWorkflowId
      const usersWithoutDefault = await User.find({
        $or: [
          { defaultWorkflowId: null },
          { defaultWorkflowId: undefined }
        ]
      }).select('_id email').limit(batchSize).exec();

      console.log(`[WorkflowMigrationService] Found ${usersWithoutDefault.length} users to migrate`);

      for (const user of usersWithoutDefault) {
        try {
          const result = await this.ensureUserHasDefaultWorkflow(user._id.toString());
          if (result.success) {
            migratedCount++;
          } else {
            const error = `User ${user.email}: ${result.error || 'Unknown error'}`;
            errors.push(error);
            console.warn(`[WorkflowMigrationService] Failed to migrate user:`, error);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const error = `User ${user.email}: ${errorMsg}`;
          errors.push(error);
          console.error(`[WorkflowMigrationService] Migration error for user ${user.email}:`, err);
        }
      }

      console.log(`[WorkflowMigrationService] Migration complete: ${migratedCount} users migrated, ${errors.length} errors`);
      return { migratedCount, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[WorkflowMigrationService] Batch migration failed:`, error);
      errors.push(`Batch migration failed: ${errorMsg}`);
      return { migratedCount, errors };
    }
  }
}
