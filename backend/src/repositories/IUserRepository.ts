/**
 * IUserRepository - Interface pour l'accès aux données utilisateur
 * Applique: Dependency Inversion Principle (SOLID)
 * 
 * Les routes/services dépendent d'abstractions, pas de MongoDB directement
 */

import { IUser } from '../models/User.model';

export interface IUserRepository {
  /**
   * Récupère un utilisateur par ID
   */
  findById(userId: string): Promise<IUser | null>;

  /**
   * Récupère un utilisateur par email
   */
  findByEmail(email: string): Promise<IUser | null>;

  /**
   * Assigne un workflow par défaut à un utilisateur
   * @param userId ID de l'utilisateur
   * @param defaultWorkflowId ID du workflow par défaut
   * @returns L'utilisateur mis à jour
   */
  setDefaultWorkflow(userId: string, defaultWorkflowId: string): Promise<IUser>;

  /**
   * Synchronise les compteurs de workflow de l'utilisateur
   * @param userId ID de l'utilisateur
   * @param workflowCount Nombre total de workflows
   * @returns L'utilisateur mis à jour
   */
  syncWorkflowCount(userId: string, workflowCount: number): Promise<IUser>;

  /**
   * Récupère le workflow par défaut d'un utilisateur
   * @param userId ID de l'utilisateur
   * @returns L'ID du workflow par défaut, ou null
   */
  getDefaultWorkflowId(userId: string): Promise<string | null>;
}
