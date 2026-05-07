/**
 * Service — Gestion des Fonctions Personnalisées (Tools V2)
 *
 * Implémente le pattern Repository-Service :
 * - accès BDD via le modèle Mongoose UserFunction
 * - aucune logique d'exécution ici (voir sandbox.service.ts)
 *
 * Design Patterns :
 *   - Repository : encapsule les requêtes Mongoose
 *   - Strategy   : listFunctions accepte des filtres dynamiques
 */

import mongoose from 'mongoose';
import path from 'path';
import { UserFunction, IUserFunction } from '../models/UserFunction.model';
import { deleteUserToolMirror, syncUserToolMirrorFromLegacyFunction } from './userToolMirror.service';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { createWorkspaceManager } from './workspace/WorkspaceManager';
import type { WorkspaceProvisioningResult } from './workspace/types';
import { buildGlobalLegacyFunctionClauses, buildOwnedLegacyFunctionClause } from '../utils/sharedExampleAccess';

interface ListFunctionsFilter {
    workflowId?: string;
    origin?: 'native' | 'custom';
    language?: 'python' | 'typescript';
    isEnabled?: boolean;
}

interface CreateFunctionData {
    name: string;
    description: string;
    language: 'python' | 'typescript';
    workflowId?: string | null;
    inputSchema?: object;
    outputSchema?: object;
    codeInline?: string | null;
    dependencies?: string[];
    tags?: string[];
}

export interface FunctionWorkspaceContext {
    workspaceId: string;
    logicalRoot: string;
    runtimeRoots: WorkspaceProvisioningResult['runtimeRoots'];
    manifests: WorkspaceProvisioningResult['manifests'];
    status: WorkspaceProvisioningResult['status'];
    lastScanAt?: Date | null;
}

export interface FunctionReadModel extends IUserFunction {
    workspaceContext?: FunctionWorkspaceContext;
    resolvedCodePath?: string | null;
    codePathRoot?: 'workspace_source' | 'absolute' | 'native_repo' | 'legacy_relative' | null;
}

export class FunctionService {
    private readonly workspaceManager = createWorkspaceManager();

    /**
     * Retourne toutes les fonctions disponibles pour un utilisateur :
     * - Les fonctions natives (userId: null, isReadonly: true)
     * - Les fonctions custom de l'utilisateur
     *
     * Filtre optionnel : workflowId, origin, language, isEnabled
     */
    async listFunctions(userId: string, filters: ListFunctionsFilter = {}): Promise<FunctionReadModel[]> {
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const query: Record<string, unknown> = {
            $or: [
                ...buildGlobalLegacyFunctionClauses(),
                buildOwnedLegacyFunctionClause(userObjectId)
            ]
        };

        if (filters.origin) {
            query.origin = filters.origin;
        }

        if (filters.language) {
            query.language = filters.language;
        }

        if (filters.isEnabled !== undefined) {
            query.isEnabled = filters.isEnabled;
        }

        if (filters.workflowId) {
            const workflowObjectId = new mongoose.Types.ObjectId(filters.workflowId);
            query.$or = [
                ...buildGlobalLegacyFunctionClauses(),
                {
                    ...buildOwnedLegacyFunctionClause(userObjectId),
                    workflowId: workflowObjectId
                },
                {
                    ...buildOwnedLegacyFunctionClause(userObjectId),
                    workflowId: null
                }
            ];
        }

        const functions = await UserFunction.find(query)
            .sort({ origin: -1, name: 1 })  // natives d'abord, puis alphabétique
            .lean<IUserFunction[]>();

        return this.attachWorkspacePathContext(userId, functions);
    }

    /**
     * Crée une nouvelle fonction custom pour l'utilisateur
     */
    async createFunction(userId: string, data: CreateFunctionData): Promise<FunctionReadModel> {
        if (data.workflowId) {
            await this.workspaceManager.syncLegacyFunctionPaths(userId, data.workflowId);
        }

        const dependencies = data.language === 'python'
            ? { python: data.dependencies ?? [], npm: [] }
            : { python: [], npm: data.dependencies ?? [] };

        const fn = new UserFunction({
            name: data.name,
            description: data.description,
            language: data.language,
            origin: 'custom',
            userId: new mongoose.Types.ObjectId(userId),
            workflowId: data.workflowId
                ? new mongoose.Types.ObjectId(data.workflowId)
                : null,
            inputSchema: data.inputSchema ?? {},
            outputSchema: data.outputSchema ?? {},
            codeInline: data.codeInline ?? null,
            dependencies,
            isEnabled: true,
            isReadonly: false,
            version: 1,
            tags: data.tags ?? []
        });

        await fn.save();
        const created = fn.toObject();
        try {
            await syncUserToolMirrorFromLegacyFunction(created);
        } catch (error) {
            await UserFunction.deleteOne({ _id: fn._id });
            throw error;
        }
        const [resolved] = await this.attachWorkspacePathContext(userId, [created]);
        return resolved;
    }

    /**
     * Récupère une fonction par son ID.
     * Autorise la lecture si :
     *   - c'est une fonction native (userId: null)
     *   - c'est une fonction de l'utilisateur courant
     */
    async getFunctionById(functionId: string, userId: string): Promise<FunctionReadModel | null> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) return null;

        const userObjectId = new mongoose.Types.ObjectId(userId);

        const fn = await UserFunction.findOne({
            _id: functionId,
            $or: [
                ...buildGlobalLegacyFunctionClauses(),
                buildOwnedLegacyFunctionClause(userObjectId)
            ]
        }).lean<IUserFunction>();

        if (!fn) {
            return null;
        }

        const [resolved] = await this.attachWorkspacePathContext(userId, [fn]);
        return resolved;
    }

    /**
     * Met à jour une fonction custom (les fonctions natives sont en lecture seule).
     * Retourne null si la fonction est introuvable ou native (isReadonly).
     */
    async updateFunction(
        functionId: string,
        userId: string,
        data: Partial<CreateFunctionData>
    ): Promise<FunctionReadModel | null> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) return null;

        const existing = await UserFunction.findOne({
            _id: functionId,
            userId: new mongoose.Types.ObjectId(userId),
            isReadonly: false
        }).lean<IUserFunction>();

        if (!existing) {
            return null;
        }

        const updatePayload: Record<string, unknown> = {
            ...data,
            updatedAt: new Date()
        };

        if (data.workflowId !== undefined) {
            updatePayload.workflowId = data.workflowId
                ? new mongoose.Types.ObjectId(data.workflowId)
                : null;
        }

        if (data.dependencies !== undefined) {
            const language = data.language ?? existing.language;
            updatePayload.dependencies = language === 'python'
                ? { python: data.dependencies, npm: [] }
                : { python: [], npm: data.dependencies };
        }

        const updated = await UserFunction.findOneAndUpdate(
            {
                _id: existing._id
            },
            { $set: updatePayload },
            { new: true, runValidators: true }
        ).lean<IUserFunction>();

        if (updated) {
            const effectiveWorkflowId = data.workflowId !== undefined
                ? data.workflowId
                : (existing.workflowId ? existing.workflowId.toString() : null);

            if (effectiveWorkflowId) {
                await this.workspaceManager.syncLegacyFunctionPaths(userId, effectiveWorkflowId);
            }

            await syncUserToolMirrorFromLegacyFunction(updated);
        }

        if (!updated) {
            return null;
        }

        const [resolved] = await this.attachWorkspacePathContext(userId, [updated]);
        return resolved;
    }

    /**
     * Supprime une fonction custom.
     * Les fonctions natives (isReadonly: true) ne peuvent pas être supprimées.
     * Retourne false si la fonction est introuvable ou native.
     */
    async deleteFunction(functionId: string, userId: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) return false;

        const existing = await UserFunction.findOne({
            _id: functionId,
            userId: new mongoose.Types.ObjectId(userId),
            isReadonly: false
        }).lean<IUserFunction>();

        if (!existing) {
            return false;
        }

        await deleteUserToolMirror(functionId);

        const result = await UserFunction.deleteOne({
            _id: functionId,
            userId: new mongoose.Types.ObjectId(userId),
            isReadonly: false
        });

        return result.deletedCount > 0;
    }

    /**
     * Bascule isEnabled pour une fonction.
     * Les fonctions natives peuvent être désactivées mais leur état est global.
     * bash_py : ne peut être activée que si `allowBashPy` est explicitement true.
     */
    async toggleFunction(
        functionId: string,
        userId: string,
        options?: { allowBashPy?: boolean }
    ): Promise<FunctionReadModel | null> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) return null;

        const userObjectId = new mongoose.Types.ObjectId(userId);

        // Chercher la fonction (native ou custom)
        const fn = await UserFunction.findOne({
            _id: functionId,
            $or: [
                ...buildGlobalLegacyFunctionClauses(),
                buildOwnedLegacyFunctionClause(userObjectId)
            ]
        });

        if (!fn) return null;

        // Sécurité : bash_py ne peut être activée qu'avec consentement explicite
        const wouldEnable = !fn.isEnabled;
        if (fn.name === 'bash_py' && wouldEnable && !options?.allowBashPy) {
            throw new Error('bash_py requiert un consentement explicite (allowBashPy: true)');
        }

        // Utilise $set atomique pour éviter la validation complète du document
        // (protège contre les dérives de schéma dans les données seedées, ex: version string vs number)
        const updated = await UserFunction.findOneAndUpdate(
            { _id: fn._id },
            { $set: { isEnabled: !fn.isEnabled } },
            { new: true }
        );

        const normalized = updated ? updated.toObject() : null;
        if (normalized) {
            await syncUserToolMirrorFromLegacyFunction(normalized);
        }

        if (!normalized) {
            return null;
        }

        const [resolved] = await this.attachWorkspacePathContext(userId, [normalized]);
        return resolved;
    }

    /**
     * Retourne les fonctions liées à un prototype d'agent.
     * Effectue la jointure AgentPrototype → UserFunction via les ObjectId tools[].
     */
    async getFunctionsForAgent(
        agentId: string,
        userId: string
    ): Promise<FunctionReadModel[]> {
        if (!mongoose.Types.ObjectId.isValid(agentId)) return [];

        const prototype = await AgentPrototype.findOne({
            _id: agentId,
            userId: new mongoose.Types.ObjectId(userId)
        })
            .populate<{ tools: IUserFunction[] }>('tools')
            .lean();

        if (!prototype || !prototype.tools) return [];

        // tools est maintenant un tableau d'IUserFunction après populate
        return this.attachWorkspacePathContext(
            userId,
            prototype.tools as unknown as IUserFunction[]
        );
    }

    private async attachWorkspacePathContext(
        ownerUserId: string,
        functions: IUserFunction[]
    ): Promise<FunctionReadModel[]> {
        if (functions.length === 0) {
            return [];
        }

        const workflowIds = Array.from(new Set(
            functions
                .filter((fn) => fn.origin === 'custom' && fn.workflowId)
                .map((fn) => fn.workflowId!.toString())
        ));

        const workspaceByWorkflowId = new Map<string, WorkspaceProvisioningResult>();

        for (const workflowId of workflowIds) {
            const existingWorkspace = await this.workspaceManager.getWorkspace({
                ownerUserId,
                scopeType: 'workflow',
                scopeId: workflowId
            });

            const workspace = existingWorkspace
                ?? await this.workspaceManager.ensureWorkflowWorkspace(ownerUserId, workflowId);

            workspaceByWorkflowId.set(workflowId, workspace);
        }

        return functions.map((fn) => {
            const workflowId = fn.workflowId?.toString() ?? null;
            const workspace = workflowId ? workspaceByWorkflowId.get(workflowId) : undefined;
            const pathMetadata = this.resolveCodePathMetadata(fn, workspace);

            return {
                ...fn,
                workspaceContext: workspace
                    ? {
                        workspaceId: workspace.workspaceId,
                        logicalRoot: workspace.logicalRoot,
                        runtimeRoots: workspace.runtimeRoots,
                        manifests: workspace.manifests,
                        status: workspace.status,
                        lastScanAt: workspace.lastScanAt ?? null
                    }
                    : undefined,
                resolvedCodePath: pathMetadata.resolvedCodePath,
                codePathRoot: pathMetadata.codePathRoot
            } as FunctionReadModel;
        });
    }

    private resolveCodePathMetadata(
        fn: IUserFunction,
        workspace?: WorkspaceProvisioningResult
    ): Pick<FunctionReadModel, 'resolvedCodePath' | 'codePathRoot'> {
        if (!fn.codePath) {
            return {
                resolvedCodePath: null,
                codePathRoot: null
            };
        }

        if (path.isAbsolute(fn.codePath)) {
            return {
                resolvedCodePath: fn.codePath,
                codePathRoot: 'absolute'
            };
        }

        if (fn.origin === 'native') {
            return {
                resolvedCodePath: fn.codePath,
                codePathRoot: 'native_repo'
            };
        }

        if (workspace) {
            return {
                resolvedCodePath: path.resolve(workspace.runtimeRoots.sourceRoot, fn.codePath),
                codePathRoot: 'workspace_source'
            };
        }

        return {
            resolvedCodePath: fn.codePath,
            codePathRoot: 'legacy_relative'
        };
    }
}
