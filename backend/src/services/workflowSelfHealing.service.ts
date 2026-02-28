/**
 * @file workflowSelfHealing.service.ts
 * @description Service Self-Healing pour les workflows
 * @domain Design Domain - Data Integrity
 * 
 * OBJECTIF:
 * - Garantir qu'un utilisateur a TOUJOURS un workflow par défaut
 * - Auto-création transparente si inexistant (dette technique)
 * - Validation d'ownership sur toutes les opérations
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility (workflow integrity only)
 * - O: Open for extension (add new healing strategies)
 * - D: Dependency inversion (service layer, not controller)
 * 
 * USE CASES:
 * 1. Nouvel utilisateur sans workflow → création immédiate
 * 2. Utilisateur existant (dette) sans workflow → auto-réparation
 * 3. Validation ID workflow avant toute opération
 */

import mongoose from 'mongoose';
import { Workflow, IWorkflow } from '../models/Workflow.model';
import { User } from '../models/User.model';

// ============================================
// TYPES
// ============================================

export interface SelfHealingResult {
    workflow: IWorkflow;
    wasCreated: boolean;
    healingActions: string[];
}

export interface WorkflowValidationResult {
    isValid: boolean;
    error?: string;
    errorCode?: 'INVALID_ID' | 'NOT_FOUND' | 'NOT_OWNER' | 'UNKNOWN';
}

// ============================================
// SERVICE
// ============================================

export class WorkflowSelfHealingService {
    /**
     * Garantit qu'un utilisateur a un workflow par défaut
     * 
     * @param userId - ID de l'utilisateur (ObjectId string)
     * @returns Workflow existant ou nouvellement créé
     * 
     * ÉTAPES:
     * 1. Recherche workflow isDefault: true
     * 2. Sinon, recherche workflow isActive: true
     * 3. Sinon, recherche le plus récent
     * 4. Si aucun → création du workflow par défaut
     */
    static async ensureDefaultWorkflow(userId: string): Promise<SelfHealingResult> {
        const healingActions: string[] = [];
        
        // 1. Chercher workflow par défaut
        let workflow = await Workflow.findOne({ 
            userId, 
            isDefault: true 
        });
        
        if (workflow) {
            // ⭐ Vérifier si User.defaultWorkflowId est correct
            const userRecord = await User.findById(userId);
            if (!userRecord?.defaultWorkflowId || userRecord.defaultWorkflowId.toString() !== workflow._id.toString()) {
                // Mettre à jour le User record
                await User.findByIdAndUpdate(
                    userId,
                    {
                        defaultWorkflowId: workflow._id,
                        workflowCount: await Workflow.countDocuments({ userId }),
                        lastActiveWorkflowId: workflow._id,
                        updatedAt: new Date()
                    },
                    { new: true }
                );
            }
            return { workflow, wasCreated: false, healingActions };
        }
        
        healingActions.push('No default workflow found');
        
        // 2. Chercher workflow actif
        workflow = await Workflow.findOne({ 
            userId, 
            isActive: true 
        }).sort({ updatedAt: -1 });
        
        if (workflow) {
            // Promouvoir en default
            workflow.isDefault = true;
            await workflow.save();
            healingActions.push(`Promoted workflow ${workflow.id} to default`);
            
            // ⭐ Mettre à jour le User record
            await User.findByIdAndUpdate(
                userId,
                {
                    defaultWorkflowId: workflow._id,
                    workflowCount: await Workflow.countDocuments({ userId }),
                    lastActiveWorkflowId: workflow._id,
                    updatedAt: new Date()
                },
                { new: true }
            );
            
            return { workflow, wasCreated: false, healingActions };
        }
        
        healingActions.push('No active workflow found');
        
        // 3. Chercher n'importe quel workflow
        workflow = await Workflow.findOne({ userId }).sort({ updatedAt: -1 });
        
        if (workflow) {
            // Promouvoir en default et actif
            workflow.isDefault = true;
            workflow.isActive = true;
            await workflow.save();
            healingActions.push(`Promoted workflow ${workflow.id} to default and active`);
            
            // ⭐ Mettre à jour le User record
            await User.findByIdAndUpdate(
                userId,
                {
                    defaultWorkflowId: workflow._id,
                    workflowCount: await Workflow.countDocuments({ userId }),
                    lastActiveWorkflowId: workflow._id,
                    updatedAt: new Date()
                },
                { new: true }
            );
            
            return { workflow, wasCreated: false, healingActions };
        }
        
        healingActions.push('No workflow found - creating new default');
        
        // 4. Créer un nouveau workflow par défaut
        workflow = new Workflow({
            userId,
            name: 'Mon Workflow',
            description: 'Workflow par défaut',
            isActive: true,
            isDefault: true,
            isDirty: false,
            canvasState: {
                zoom: 1,
                panX: 0,
                panY: 0
            },
            nodes: [],
            edges: []
        });
        
        await workflow.save();
        healingActions.push(`Created new default workflow: ${workflow.id}`);
        
        // ⭐ SYNCHRONOUS UPDATE: Update User record IMMEDIATELY
        await User.findByIdAndUpdate(
            userId,
            {
                defaultWorkflowId: new mongoose.Types.ObjectId(workflow.id),
                workflowCount: 1,
                lastActiveWorkflowId: new mongoose.Types.ObjectId(workflow.id),
                updatedAt: new Date()
            },
            { new: true }
        );
        
        console.log(`[WorkflowSelfHealing] Created default workflow for user ${userId}:`, {
            workflowId: workflow.id,
            healingActions
        });
        
        return { workflow, wasCreated: true, healingActions };
    }
    
    /**
     * Valide un ID de workflow avant opération
     * 
     * @param workflowId - ID du workflow à valider
     * @param userId - ID de l'utilisateur demandeur
     * @returns Résultat de validation
     * 
     * VALIDATIONS:
     * 1. Format ObjectId valide
     * 2. Existence en BDD
     * 3. Ownership (workflow.userId === userId)
     */
    static async validateWorkflowAccess(
        workflowId: string, 
        userId: string
    ): Promise<WorkflowValidationResult> {
        // 1. Validation format ObjectId
        if (!mongoose.Types.ObjectId.isValid(workflowId)) {
            return {
                isValid: false,
                error: `Invalid workflow ID format: "${workflowId}"`,
                errorCode: 'INVALID_ID'
            };
        }
        
        // 2. Recherche workflow
        const workflow = await Workflow.findById(workflowId);
        
        if (!workflow) {
            return {
                isValid: false,
                error: `Workflow not found: ${workflowId}`,
                errorCode: 'NOT_FOUND'
            };
        }
        
        // 3. Validation ownership
        if (workflow.userId.toString() !== userId) {
            return {
                isValid: false,
                error: 'Access denied: workflow belongs to another user',
                errorCode: 'NOT_OWNER'
            };
        }
        
        return { isValid: true };
    }
    
    /**
     * Crée un workflow par défaut pour un nouvel utilisateur
     * Utilisé lors de l'inscription
     * 
     * @param userId - ID du nouvel utilisateur
     * @returns Workflow créé
     */
    static async createDefaultWorkflowForNewUser(userId: string): Promise<IWorkflow> {
        const workflow = new Workflow({
            userId,
            name: 'Mon Workflow',
            description: 'Workflow par défaut créé à l\'inscription',
            isActive: true,
            isDefault: true,
            isDirty: false,
            canvasState: {
                zoom: 1,
                panX: 0,
                panY: 0
            },
            nodes: [],
            edges: []
        });
        
        await workflow.save();
        
        console.log(`[WorkflowSelfHealing] Created default workflow for new user ${userId}:`, workflow.id);
        
        return workflow;
    }
    
    /**
     * Vérifie si un ID est le placeholder "default-workflow"
     * et le rejette proprement
     * 
     * @param workflowId - ID à vérifier
     * @returns true si c'est un placeholder invalide
     */
    static isPlaceholderId(workflowId: string): boolean {
        const placeholders = [
            'default-workflow',
            'new-workflow',
            'temp-workflow',
            'placeholder',
            ''
        ];
        return placeholders.includes(workflowId?.toLowerCase() || '');
    }
}

export default WorkflowSelfHealingService;
