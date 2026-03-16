/**
 * @file utils/transforms.ts
 * @description Shared data transformation utilities for backend responses
 * @domain Design Domain - Data Mapping
 *
 * ARCHITECTURE:
 * - Single Responsibility: Data shape transformations only
 * - Used by agent-instances.routes.ts AND workflows.routes.ts (POST /select)
 *
 * NON-RÉGRESSION:
 * - Extraite sans modification fonctionnelle depuis agent-instances.routes.ts
 * - configuration_json est reconstruit à partir des champs plats Mongoose
 */

/**
 * Transform a MongoDB AgentInstance document into the shape expected by the frontend.
 *
 * Responsibilities:
 *  - _id → id (string)
 *  - Reconstruct `configuration_json` from individual fields
 *    (the frontend relies on `configuration_json.role`, `.model`, etc.)
 *  - Provide safe defaults for arrays/objects
 *
 * @param instance - Mongoose document or plain object
 */
export function transformAgentInstanceForFrontend(instance: any) {
    const instanceObj = instance.toObject?.() || instance;
    const {
        _id,
        role,
        llmProvider,
        llmModel,
        systemPrompt,
        capabilities,
        tools,
        historyConfig,
        outputConfig,
        functionInheritance,
        localLLMProfileId,
        robotId,
        position,
        ...rest
    } = instanceObj;

    // ⭐ FIX QA: Extract persistenceConfig from rest to include explicitly
    const { persistenceConfig, ...remaining } = rest;
    
    return {
        id: _id?.toString(),
        role,
        llmProvider,
        llmModel,
        systemPrompt,
        capabilities: capabilities || [],
        tools: tools || [],
        historyConfig: historyConfig || {},
        outputConfig: outputConfig || {},
        robotId,
        position,
        // ⭐ FIX QA: Include persistenceConfig for media storage options
        persistenceConfig: persistenceConfig || {
            saveChat: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            saveMedia: false,
            mediaStorage: 'db'
            // cloudStorageConfig: intentionally omitted (null would fail Zod validation)
        },
        // ⭐ CRITICAL: Reconstruct configuration_json for frontend
        configuration_json: {
            role: role || 'assistant',
            model: llmModel || 'gpt-4o-mini',
            llmProvider: llmProvider || 'openai',
            systemPrompt: systemPrompt || '',
            capabilities: Array.isArray(capabilities) ? capabilities : [],
            tools: Array.isArray(tools) ? tools : [],
            historyConfig: historyConfig || {},
            outputConfig: outputConfig || {},
            position: position || { x: 0, y: 0 },
            functionInheritance: functionInheritance || { inheritFromPrototype: true, overrideFunctionIds: [] },
            // ⭐ LOCAL LLM: Include localLLMProfileId for correct endpoint resolution after reload
            ...(localLLMProfileId != null && { localLLMProfileId })
        },
        ...remaining
    };
}
