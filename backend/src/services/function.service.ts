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
import { UserFunction, IUserFunction } from '../models/UserFunction.model';
import { AgentPrototype } from '../models/AgentPrototype.model';

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

export class FunctionService {
    /**
     * Retourne toutes les fonctions disponibles pour un utilisateur :
     * - Les fonctions natives (userId: null, isReadonly: true)
     * - Les fonctions custom de l'utilisateur
     *
     * Filtre optionnel : workflowId, origin, language, isEnabled
     */
    async listFunctions(userId: string, filters: ListFunctionsFilter = {}): Promise<IUserFunction[]> {
        const query: Record<string, unknown> = {
            $or: [
                { userId: null },                                            // natives
                { userId: new mongoose.Types.ObjectId(userId) }              // custom user
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
            // Fonctions natives (workflowId: null) + fonctions du workflow spécifique
            query.$or = [
                { userId: null },
                {
                    userId: new mongoose.Types.ObjectId(userId),
                    workflowId: new mongoose.Types.ObjectId(filters.workflowId)
                },
                {
                    userId: new mongoose.Types.ObjectId(userId),
                    workflowId: null
                }
            ];
        }

        return UserFunction.find(query)
            .sort({ origin: -1, name: 1 })  // natives d'abord, puis alphabétique
            .lean<IUserFunction[]>();
    }

    /**
     * Crée une nouvelle fonction custom pour l'utilisateur
     */
    async createFunction(userId: string, data: CreateFunctionData): Promise<IUserFunction> {
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
            dependencies: {
                python: data.dependencies ?? [],
                npm: []
            },
            isEnabled: true,
            isReadonly: false,
            version: 1,
            tags: data.tags ?? []
        });

        await fn.save();
        return fn.toObject();
    }

    /**
     * Récupère une fonction par son ID.
     * Autorise la lecture si :
     *   - c'est une fonction native (userId: null)
     *   - c'est une fonction de l'utilisateur courant
     */
    async getFunctionById(functionId: string, userId: string): Promise<IUserFunction | null> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) return null;

        return UserFunction.findOne({
            _id: functionId,
            $or: [
                { userId: null },
                { userId: new mongoose.Types.ObjectId(userId) }
            ]
        }).lean<IUserFunction>();
    }

    /**
     * Met à jour une fonction custom (les fonctions natives sont en lecture seule).
     * Retourne null si la fonction est introuvable ou native (isReadonly).
     */
    async updateFunction(
        functionId: string,
        userId: string,
        data: Partial<CreateFunctionData>
    ): Promise<IUserFunction | null> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) return null;

        const updated = await UserFunction.findOneAndUpdate(
            {
                _id: functionId,
                userId: new mongoose.Types.ObjectId(userId),
                isReadonly: false
            },
            {
                $set: {
                    ...data,
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        ).lean<IUserFunction>();

        return updated;
    }

    /**
     * Supprime une fonction custom.
     * Les fonctions natives (isReadonly: true) ne peuvent pas être supprimées.
     * Retourne false si la fonction est introuvable ou native.
     */
    async deleteFunction(functionId: string, userId: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) return false;

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
    ): Promise<IUserFunction | null> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) return null;

        // Chercher la fonction (native ou custom)
        const fn = await UserFunction.findOne({
            _id: functionId,
            $or: [
                { userId: null },
                { userId: new mongoose.Types.ObjectId(userId) }
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

        return updated ? updated.toObject() : null;
    }

    /**
     * Retourne les fonctions liées à un prototype d'agent.
     * Effectue la jointure AgentPrototype → UserFunction via les ObjectId tools[].
     */
    async getFunctionsForAgent(
        agentId: string,
        userId: string
    ): Promise<IUserFunction[]> {
        if (!mongoose.Types.ObjectId.isValid(agentId)) return [];

        const prototype = await AgentPrototype.findOne({
            _id: agentId,
            userId: new mongoose.Types.ObjectId(userId)
        })
            .populate<{ tools: IUserFunction[] }>('tools')
            .lean();

        if (!prototype || !prototype.tools) return [];

        // tools est maintenant un tableau d'IUserFunction après populate
        return prototype.tools as unknown as IUserFunction[];
    }
}
