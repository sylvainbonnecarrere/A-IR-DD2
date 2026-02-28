/**
 * IWorkflowMigrationService - Service de migration des utilisateurs
 * Applique: Dependency Inversion + Single Responsibility
 * 
 * Responsabilité: Gérer la migration des anciens utilisateurs vers la feature multi-workflows
 */

import { IWorkflow } from '../models/Workflow.model';
import { IUser } from '../models/User.model';

export interface IMigrationResult {
  success: boolean;
  workflow: IWorkflow | null;
  user: IUser | null;
  action: 'created' | 'assigned' | 'already_set';
  message: string;
  error?: string;
}

export interface IWorkflowMigrationService {
  /**
   * Assure qu'un utilisateur a un workflow par défaut
   * Idempotent: peut être appelé plusieurs fois sans problème
   * 
   * Cas d'usage:
   * 1. Nouvel utilisateur → crée workflow par défaut
   * 2. Ancien utilisateur sans defaultWorkflowId → assigne le premier workflow
   * 3. Utilisateur avec defaultWorkflowId → retourne current
   * 
   * @param userId ID de l'utilisateur
   * @returns Mise à jour utilisateur et workflow
   */
  ensureUserHasDefaultWorkflow(userId: string): Promise<IMigrationResult>;

  /**
   * Crée un workflow par défaut pour un nouvel utilisateur
   */
  createDefaultWorkflow(userId: string): Promise<IWorkflow>;

  /**
   * Migre les anciens utilisateurs sans defaultWorkflowId
   * À appeler une seule fois au déploiement
   */
  migrateExistingUsers(batchSize?: number): Promise<{ migratedCount: number; errors: string[] }>;
}
