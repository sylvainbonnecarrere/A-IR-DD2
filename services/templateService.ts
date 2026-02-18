/**
 * TemplateService - Gestion des templates d'agents
 * 
 * Responsabilités :
 * - Mode GUEST (localStorage): Templates persistés localement (session-based)
 * - Mode AUTH (MongoDB + React Query): Templates persistés au serveur (cross-session)
 * - Routing automatique: Guest mode par défaut, MongoDB si authentifié
 * - Ajout de prototypes existants aux templates
 * - Sauvegarde/chargement des templates personnalisés
 * - Suppression de templates personnalisés
 * - Fusion avec les templates prédéfinis
 */

import { Agent, RobotId } from '../types';
import { AgentTemplate } from '../data/agentTemplates';
import type { AgentTemplateDTO, CreateTemplatePayload, UpdateTemplatePayload } from './templateAPI';
import * as templateAPI from './templateAPI';

const CUSTOM_TEMPLATES_STORAGE_KEY = 'custom_agent_templates';

export interface CustomTemplate extends AgentTemplate {
    isCustom: true;
    sourcePrototypeId?: string; // ID du prototype d'origine si créé depuis un prototype
}

// ============================================
// GUEST MODE (localStorage)
// ============================================

/**
 * Charger les templates personnalisés depuis le localStorage
 */
export const loadCustomTemplates = (): CustomTemplate[] => {
    try {
        const stored = localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY);
        if (!stored) return [];

        const templates = JSON.parse(stored) as CustomTemplate[];
        return templates;
    } catch (error) {
        console.error('Erreur lors du chargement des templates personnalisés:', error);
        return [];
    }
};

/**
 * Sauvegarder les templates personnalisés dans le localStorage
 */
const saveCustomTemplates = (templates: CustomTemplate[]): boolean => {
    try {
        localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
        return true;
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des templates:', error);
        return false;
    }
};

/**
 * Ajouter un prototype existant aux templates (GUEST MODE - localStorage)
 * 
 * PRINCIPE: Clone complet du prototype (valeurs, pas référence)
 * Le template est une COPIE INDÉPENDANTE du prototype
 * 
 * @param prototype - Le prototype à convertir en template
 * @param customName - Nom personnalisé optionnel pour le template
 * @param customDescription - Description personnalisée optionnelle
 * @returns Le template créé ou null en cas d'erreur
 */
export const addPrototypeToTemplates = (
    prototype: Agent,
    customName?: string,
    customDescription?: string
): CustomTemplate | null => {
    try {
        // Validation
        if (!prototype || !prototype.id) {
            console.error('Prototype invalide');
            return null;
        }

        // Charger les templates existants
        const existingTemplates = loadCustomTemplates();

        // Vérifier si un template existe déjà pour ce prototype
        const existingIndex = existingTemplates.findIndex(t => t.sourcePrototypeId === prototype.id);

        if (existingIndex !== -1) {
            console.warn('Un template existe déjà pour ce prototype');
            return null;
        }

        // Déterminer la catégorie en fonction du rôle
        const category: CustomTemplate['category'] = determineCategory(prototype.role, prototype.systemPrompt);

        // Déterminer l'icône en fonction du nom/rôle
        const icon = determineIcon(prototype.name, prototype.role);

        // Créer le template (COPIE PROFONDE pour éviter les références)
        const newTemplate: CustomTemplate = {
            id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: customName || `Template: ${prototype.name}`,
            description: customDescription || `Template créé depuis le prototype "${prototype.name}"`,
            category: category,
            robotId: prototype.creator_id || RobotId.Archi,
            icon: icon,
            isCustom: true,
            sourcePrototypeId: prototype.id,
            template: {
                // Clone profond de toutes les propriétés (pas de référence)
                name: prototype.name,
                role: prototype.role,
                systemPrompt: prototype.systemPrompt,
                llmProvider: prototype.llmProvider,
                model: prototype.model,
                capabilities: [...prototype.capabilities], // Copie du tableau
                tools: prototype.tools.map(tool => ({
                    // Copie profonde de chaque tool
                    name: tool.name,
                    description: tool.description,
                    parameters: JSON.parse(JSON.stringify(tool.parameters)) // Clone profond de l'objet parameters
                })),
                outputConfig: { ...prototype.outputConfig }, // Copie de l'objet outputConfig
                historyConfig: prototype.historyConfig ? {
                    ...prototype.historyConfig,
                    // Clone des propriétés imbriquées si elles existent
                } : undefined as any
            }
        };

        // Ajouter à la liste
        const updatedTemplates = [...existingTemplates, newTemplate];

        // Sauvegarder
        const saved = saveCustomTemplates(updatedTemplates);

        if (!saved) {
            console.error('Échec de la sauvegarde du template');
            return null;
        }

        return newTemplate;
    } catch (error) {
        console.error('Erreur lors de l\'ajout du prototype aux templates:', error);
        return null;
    }
};

/**
 * Supprimer un template personnalisé
 * 
 * @param templateId - ID du template à supprimer
 * @returns true si supprimé avec succès, false sinon
 */
export const deleteCustomTemplate = (templateId: string): boolean => {
    try {
        const templates = loadCustomTemplates();
        const filteredTemplates = templates.filter(t => t.id !== templateId);

        if (templates.length === filteredTemplates.length) {
            console.warn('Template non trouvé');
            return false;
        }

        return saveCustomTemplates(filteredTemplates);
    } catch (error) {
        console.error('Erreur lors de la suppression du template:', error);
        return false;
    }
};

/**
 * Mettre à jour un template personnalisé
 * 
 * @param templateId - ID du template à mettre à jour
 * @param updates - Champs à mettre à jour
 * @returns true si mis à jour avec succès, false sinon
 */
export const updateCustomTemplate = (
    templateId: string,
    updates: Partial<Pick<CustomTemplate, 'name' | 'description' | 'category' | 'icon'>>
): boolean => {
    try {
        const templates = loadCustomTemplates();
        const index = templates.findIndex(t => t.id === templateId);

        if (index === -1) {
            console.warn('Template non trouvé');
            return false;
        }

        templates[index] = {
            ...templates[index],
            ...updates
        };

        return saveCustomTemplates(templates);
    } catch (error) {
        console.error('Erreur lors de la mise à jour du template:', error);
        return false;
    }
};

/**
 * Obtenir tous les templates (prédéfinis + personnalisés)
 * 
 * @param predefinedTemplates - Templates prédéfinis depuis agentTemplates.ts
 * @returns Liste fusionnée des templates
 */
export const getAllTemplates = (predefinedTemplates: AgentTemplate[]): AgentTemplate[] => {
    const customTemplates = loadCustomTemplates();
    return [...predefinedTemplates, ...customTemplates];
};

/**
 * Déterminer la catégorie d'un agent en fonction de son rôle et prompt
 */
const determineCategory = (role: string, systemPrompt: string): CustomTemplate['category'] => {
    const text = `${role} ${systemPrompt}`.toLowerCase();

    if (text.includes('automat') || text.includes('workflow') || text.includes('script')) {
        return 'automation';
    }
    if (text.includes('analys') || text.includes('data') || text.includes('stat')) {
        return 'analysis';
    }
    if (text.includes('specialist') || text.includes('expert') || text.includes('senior')) {
        return 'specialist';
    }

    return 'assistant'; // Défaut
};

/**
 * Déterminer l'icône d'un agent en fonction de son nom et rôle
 */
const determineIcon = (name: string, role: string): string => {
    const text = `${name} ${role}`.toLowerCase();

    // Catégories techniques
    if (text.includes('code') || text.includes('develop')) return '💻';
    if (text.includes('data') || text.includes('analys')) return '📊';
    if (text.includes('design') || text.includes('ui')) return '🎨';
    if (text.includes('test') || text.includes('qa')) return '🧪';
    if (text.includes('security') || text.includes('secur')) return '🔒';
    if (text.includes('api') || text.includes('integration')) return '🔌';
    if (text.includes('database') || text.includes('sql')) return '🗄️';
    if (text.includes('cloud') || text.includes('devops')) return '☁️';
    if (text.includes('automat')) return '🤖';
    if (text.includes('market')) return '📈';
    if (text.includes('content') || text.includes('writ')) return '✍️';
    if (text.includes('support') || text.includes('help')) return '🆘';
    if (text.includes('research') || text.includes('search')) return '🔍';

    return '⭐'; // Défaut
};

/**
 * Exporter les templates personnalisés vers un fichier JSON
 * 
 * @returns JSON string des templates personnalisés
 */
export const exportCustomTemplates = (): string => {
    const templates = loadCustomTemplates();
    return JSON.stringify(templates, null, 2);
};

/**
 * Importer des templates depuis un fichier JSON
 * 
 * @param jsonString - JSON string contenant les templates
 * @returns Nombre de templates importés
 */
export const importCustomTemplates = (jsonString: string): number => {
    try {
        const importedTemplates = JSON.parse(jsonString) as CustomTemplate[];

        if (!Array.isArray(importedTemplates)) {
            throw new Error('Format invalide');
        }

        const existingTemplates = loadCustomTemplates();

        // Filtrer les doublons (même sourcePrototypeId)
        const newTemplates = importedTemplates.filter(imported =>
            !existingTemplates.some(existing =>
                existing.sourcePrototypeId === imported.sourcePrototypeId
            )
        );

        const mergedTemplates = [...existingTemplates, ...newTemplates];
        saveCustomTemplates(mergedTemplates);

        return newTemplates.length;
    } catch (error) {
        console.error('Erreur lors de l\'importation des templates:', error);
        return 0;
    }
};

// ============================================
// HYBRID MODE (Auto-routing: Guest vs Auth)
// ============================================

/**
 * Convertir une CustomTemplate (guest mode) en AgentTemplateDTO (auth mode)
 * Pour synchroniser les templates du localStorage vers MongoDB après login
 */
const convertCustomTemplateToDTO = (
    custom: CustomTemplate,
    userId: string
): CreateTemplatePayload => {
    // Extraire le modèle LLM (custom.model → custom.template.llmModel)
    const llmModel = (custom as any).model || 'gpt-4o';
    const llmProvider = (custom as any).llmProvider || 'openai';

    return {
        name: custom.name,
        description: custom.description,
        category: custom.category,
        robotId: custom.robotId,
        icon: custom.icon,
        sourcePrototypeId: custom.sourcePrototypeId,
        tags: [],
        template: {
            name: custom.template.name,
            role: custom.template.role,
            systemPrompt: custom.template.systemPrompt,
            llmProvider: llmProvider,
            llmModel: llmModel,
            capabilities: custom.template.capabilities,
            tools: custom.template.tools,
            outputConfig: custom.template.outputConfig,
            historyConfig: custom.template.historyConfig,
        },
    };
};

/**
 * Convertir une AgentTemplateDTO (auth mode) en CustomTemplate (guest mode structure)
 * Pour charger les templates MongoDB dans le contexte guest
 */
const convertDTOToCustomTemplate = (dto: AgentTemplateDTO): CustomTemplate => {
    return {
        id: dto._id,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        robotId: dto.robotId,
        icon: dto.icon,
        isCustom: true,
        sourcePrototypeId: dto.sourcePrototypeId,
        template: {
            name: dto.template.name,
            role: dto.template.role,
            systemPrompt: dto.template.systemPrompt,
            llmProvider: dto.template.llmProvider,
            capabilities: dto.template.capabilities,
            tools: dto.template.tools,
            outputConfig: dto.template.outputConfig,
            historyConfig: dto.template.historyConfig,
        },
    } as CustomTemplate & { llmProvider?: string; model?: string };
};

/**
 * HYBRID GETTER: Récupérer les templates (guest localStorage ou auth MongoDB)
 * 
 * Routing automatique:
 * - Si accessToken fourni: utilise MongoDB via templateAPI
 * - Sinon: utilise localStorage
 * 
 * @param accessToken JWT token optionnel
 * @param predefinedTemplates Templates prédéfinis depuis agentTemplates.ts
 * @returns Promise<AgentTemplate[]> - Tous les templates (prédéfinis + personnalisés)
 */
export const loadAllTemplatesHybrid = async (
    accessToken: string | null | undefined,
    predefinedTemplates: AgentTemplate[]
): Promise<AgentTemplate[]> => {
    try {
        if (accessToken) {
            // MODE AUTH: Récupérer du serveur
            const serverTemplates = await templateAPI.fetchTemplates(accessToken);
            // Convertir en CustomTemplate pour compatibilité
            const customFromServer = serverTemplates.map(convertDTOToCustomTemplate);
            return [...predefinedTemplates, ...customFromServer];
        } else {
            // MODE GUEST: Récupérer du localStorage
            const customTemplates = loadCustomTemplates();
            return [...predefinedTemplates, ...customTemplates];
        }
    } catch (error) {
        console.error('[loadAllTemplatesHybrid] Error:', error);
        // Fallback à localStorage
        const customTemplates = loadCustomTemplates();
        return [...predefinedTemplates, ...customTemplates];
    }
};

/**
 * HYBRID ACTION: Sauvegarder un prototype comme template
 * 
 * @param prototype Agent à convertir en template
 * @param accessToken JWT token optionnel
 * @param customName Nom personnalisé optionnel
 * @param customDescription Description personnalisée optionnelle
 * @returns Promise<AgentTemplate | null> - Le template créé ou null
 */
export const savePrototypeAsTemplateHybrid = async (
    prototype: Agent,
    accessToken: string | null | undefined,
    customName?: string,
    customDescription?: string
): Promise<AgentTemplate | null> => {
    try {
        if (accessToken) {
            // MODE AUTH: Créer sur le serveur
            const payload: CreateTemplatePayload = {
                name: customName || `Template: ${prototype.name}`,
                description: customDescription || `Template créé depuis le prototype "${prototype.name}"`,
                category: determineCategory(prototype.role, prototype.systemPrompt),
                robotId: prototype.creator_id || RobotId.Archi,
                icon: determineIcon(prototype.name, prototype.role),
                sourcePrototypeId: prototype.id,
                tags: [],
                template: {
                    name: prototype.name,
                    role: prototype.role,
                    systemPrompt: prototype.systemPrompt,
                    llmProvider: prototype.llmProvider,
                    llmModel: prototype.model,
                    capabilities: [...prototype.capabilities],
                    tools: prototype.tools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: JSON.parse(JSON.stringify(tool.parameters)),
                    })),
                    outputConfig: { ...prototype.outputConfig },
                    historyConfig: prototype.historyConfig
                        ? { ...prototype.historyConfig }
                        : undefined,
                },
            };

            const created = await templateAPI.createTemplate(payload, accessToken);
            return convertDTOToCustomTemplate(created);
        } else {
            // MODE GUEST: Créer localement
            return addPrototypeToTemplates(prototype, customName, customDescription);
        }
    } catch (error) {
        console.error('[savePrototypeAsTemplateHybrid] Error:', error);
        // Fallback à localStorage
        return addPrototypeToTemplates(prototype, customName, customDescription);
    }
};

/**
 * HYBRID ACTION: Supprimer un template
 * 
 * @param templateId ID du template à supprimer
 * @param accessToken JWT token optionnel
 * @returns Promise<boolean> - Success/failure
 */
export const deleteTemplateHybrid = async (
    templateId: string,
    accessToken: string | null | undefined
): Promise<boolean> => {
    try {
        if (accessToken) {
            // MODE AUTH: Supprimer du serveur
            await templateAPI.deleteTemplate(templateId, accessToken);
            return true;
        } else {
            // MODE GUEST: Supprimer localement
            return deleteCustomTemplate(templateId);
        }
    } catch (error) {
        console.error('[deleteTemplateHybrid] Error:', error);
        return false;
    }
};

/**
 * HYBRID ACTION: Mettre à jour un template
 * 
 * @param templateId ID du template à mettre à jour
 * @param updates Champs à mettre à jour
 * @param accessToken JWT token optionnel
 * @returns Promise<boolean> - Success/failure
 */
export const updateTemplateHybrid = async (
    templateId: string,
    updates: Partial<Pick<CustomTemplate, 'name' | 'description' | 'category' | 'icon'>>,
    accessToken: string | null | undefined
): Promise<boolean> => {
    try {
        if (accessToken) {
            // MODE AUTH: Mettre à jour sur le serveur
            const updatePayload: UpdateTemplatePayload = {
                name: updates.name,
                description: updates.description,
                category: updates.category,
                icon: updates.icon,
            };
            await templateAPI.updateTemplate(templateId, updatePayload, accessToken);
            return true;
        } else {
            // MODE GUEST: Mettre à jour localement
            return updateCustomTemplate(templateId, updates);
        }
    } catch (error) {
        console.error('[updateTemplateHybrid] Error:', error);
        return false;
    }
};

/**
 * HYBRID ACTION: Toggle favorite (star) d'un template
 * 
 * @param templateId ID du template
 * @param accessToken JWT token optionnel
 * @returns Promise<boolean> - Success/failure
 */
export const toggleTemplateStarHybrid = async (
    templateId: string,
    accessToken: string | null | undefined
): Promise<boolean> => {
    try {
        if (accessToken) {
            // MODE AUTH: Toggle sur le serveur
            await templateAPI.toggleTemplateStar(templateId, accessToken);
            return true;
        } else {
            // MODE GUEST: Toggle localement (simplement toggle isStarred)
            const templates = loadCustomTemplates();
            const index = templates.findIndex(t => t.id === templateId);
            if (index === -1) return false;

            // En mode guest, on n'a pas isStarred sur CustomTemplate
            // C'est une note sur les limitations du mode guest
            console.warn('[toggleTemplateStarHybrid] Star/favorite non supporté en mode guest');
            return false;
        }
    } catch (error) {
        console.error('[toggleTemplateStarHybrid] Error:', error);
        return false;
    }
};

/**
 * HYBRID ACTION: Enregistrer l'utilisation d'un template
 * 
 * @param templateId ID du template
 * @param accessToken JWT token optionnel
 * @returns Promise<boolean> - Success/failure
 */
export const recordTemplateUsageHybrid = async (
    templateId: string,
    accessToken: string | null | undefined
): Promise<boolean> => {
    try {
        if (accessToken) {
            // MODE AUTH: Enregistrer sur le serveur
            await templateAPI.recordTemplateUsage(templateId, accessToken);
            return true;
        } else {
            // MODE GUEST: Rien à faire (pas de tracking en localStorage)
            return true;
        }
    } catch (error) {
        console.error('[recordTemplateUsageHybrid] Error:', error);
        return false;
    }
};

