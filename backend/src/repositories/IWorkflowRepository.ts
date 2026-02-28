/**
 * IWorkflowRepository - Interface pour l'accès aux données workflow
 * Applique: Dependency Inversion Principle (SOLID)
 */

import { IWorkflow } from '../models/Workflow.model';

export interface IWorkflowRepository {
  /**
   * Récupère tous les workflows d'un utilisateur
   */
  findByUserId(userId: string): Promise<IWorkflow[]>;

  /**
   * Récupère un workflow par ID
   */
  findById(workflowId: string): Promise<IWorkflow | null>;

  /**
   * Crée un nouveau workflow
   */
  create(workflow: Omit<IWorkflow, '_id' | 'createdAt' | 'updatedAt'>): Promise<IWorkflow>;

  /**
   * Met à jour un workflow
   */
  update(workflowId: string, updates: Partial<IWorkflow>): Promise<IWorkflow | null>;

  /**
   * Supprime un workflow
   */
  delete(workflowId: string): Promise<boolean>;

  /**
   * Compte les workflows d'un utilisateur
   */
  countByUserId(userId: string): Promise<number>;

  /**
   * Récupère le premier workflow d'un utilisateur (workflow par défaut fallback)
   */
  findFirstByUserId(userId: string): Promise<IWorkflow | null>;
}
