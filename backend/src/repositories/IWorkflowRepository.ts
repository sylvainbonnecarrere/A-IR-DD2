/**
 * IWorkflowRepository - Interface pour l'accès aux données workflow
 * Applique: Dependency Inversion Principle (SOLID)
 */

import { IWorkflow } from '../models/Workflow.model';

export type WorkflowPatchResult =
  | { kind: 'updated'; workflow: IWorkflow }
  | { kind: 'not_found' }
  | { kind: 'version_conflict'; currentVersion: number | null };

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
   * Récupère un workflow par ID appartenant à un utilisateur donné
   */
  findOwnedById(workflowId: string, userId: string): Promise<IWorkflow | null>;

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

  /**
   * Désactive les autres workflows d'un utilisateur
   */
  deactivateOthers(userId: string, exceptWorkflowId: string): Promise<number>;

  /**
   * Retire le statut par défaut des autres workflows d'un utilisateur
   */
  unsetDefaultForOthers(userId: string, exceptWorkflowId: string): Promise<number>;

  /**
   * Met à jour partiellement un workflow avec contrôle de version optionnel
   */
  patchOwned(
    workflowId: string,
    userId: string,
    setFields: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<WorkflowPatchResult>;
}
