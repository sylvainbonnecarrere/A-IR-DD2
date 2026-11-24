// utils/lmStudioCapabilityValidator.ts
import { Agent, LLMProvider, LLMCapability } from '../types';
import { detectAvailableModels, type LMStudioModelInfo } from '../services/lmStudioService';

export interface CapabilityValidationResult {
  isValid: boolean;
  warnings: string[];
  suggestions: string[];
  missingCapabilities: LLMCapability[];
}

/**
 * Validates an agent's configuration against LMStudio model capabilities
 */
export const validateAgentCapabilities = async (agent: Agent, endpoint?: string): Promise<CapabilityValidationResult> => {
  // Only validate LMStudio agents
  if (agent.llmProvider !== LLMProvider.LMStudio) {
    return {
      isValid: true,
      warnings: [],
      suggestions: [],
      missingCapabilities: [],
    };
  }

  const result: CapabilityValidationResult = {
    isValid: true,
    warnings: [],
    suggestions: [],
    missingCapabilities: [],
  };

  try {
    // Get available models and find current one
    const availableModels = await detectAvailableModels({ endpoint });
    const currentModel = availableModels.find((m) => m.id === agent.model);

    if (!currentModel) {
      result.isValid = false;
      result.warnings.push(`Modèle "${agent.model}" non trouvé sur le serveur local`);
      result.suggestions.push('Vérifiez que le modèle est chargé dans votre serveur local (Jan/LM Studio/Ollama)');
      return result;
    }

    // Check if agent uses function calling but model doesn't support it
    if (agent.tools && agent.tools.length > 0 && !currentModel.capabilities.functionCalling) {
      result.warnings.push(`Le modèle "${agent.model}" ne supporte pas l'appel de fonctions`);
      result.suggestions.push("Utilisez Qwen2.5-Coder, Llama-3.1+ ou Mistral-Instruct pour l'appel de fonctions");
      result.missingCapabilities.push(LLMCapability.FunctionCalling);
    }

    // Check JSON output formatting capability
    if (agent.outputConfig?.enabled && agent.outputConfig.format === 'json' && !currentModel.capabilities.jsonMode) {
      result.warnings.push(`Le modèle "${agent.model}" peut avoir des difficultés avec le format JSON strict`);
      result.suggestions.push('Les modèles "instruct" ou "chat" sont plus fiables pour le format JSON');
    }

    // Suggest better models for specific use cases
    if (agent.tools?.some((tool) => tool.name.toLowerCase().includes('code')) && !currentModel.capabilities.codeSpecialization) {
      result.suggestions.push('Pour les tâches de programmation, Qwen2.5-Coder est recommandé');
    }

    // Check reasoning capabilities for complex tasks
    const hasComplexReasoning =
      agent.systemPrompt?.toLowerCase().includes('reasoning') ||
      agent.systemPrompt?.toLowerCase().includes('step by step') ||
      agent.systemPrompt?.toLowerCase().includes('analyse');

    if (hasComplexReasoning && !currentModel.capabilities.reasoning) {
      result.suggestions.push('Pour les tâches de raisonnement complexe, utilisez Qwen2.5-Coder ou des modèles spécialisés');
    }

    // Performance suggestions based on model type
    if (currentModel.type === 'efficient' && agent.tools && agent.tools.length > 3) {
      result.suggestions.push('Les modèles "efficient" (2B) peuvent être lents avec de nombreux outils');
    }

    return result;
  } catch {
    result.isValid = false;
    result.warnings.push('Impossible de valider les capacités : serveur local non accessible');
    result.suggestions.push('Vérifiez que Jan, LM Studio ou Ollama est démarré');
    return result;
  }
};

/**
 * Gets recommended models for specific agent requirements
 */
export const getRecommendedModels = async (
  requirements: {
    functionCalling?: boolean;
    codeSpecialization?: boolean;
    reasoning?: boolean;
    efficiency?: boolean; // For resource-constrained environments
  },
  endpoint?: string,
): Promise<LMStudioModelInfo[]> => {
  try {
    const availableModels = await detectAvailableModels({ endpoint });

    return availableModels
      .filter((model) => {
        if (requirements.functionCalling && !model.capabilities.functionCalling) return false;
        if (requirements.codeSpecialization && !model.capabilities.codeSpecialization) return false;
        if (requirements.reasoning && !model.capabilities.reasoning) return false;
        if (requirements.efficiency && model.type !== 'efficient') return false;

        return true;
      })
      .sort((a, b) => {
        // Sort by capability match and efficiency
        const aScore =
          (a.capabilities.functionCalling ? 1 : 0) + (a.capabilities.codeSpecialization ? 1 : 0) + (a.capabilities.reasoning ? 1 : 0);
        const bScore =
          (b.capabilities.functionCalling ? 1 : 0) + (b.capabilities.codeSpecialization ? 1 : 0) + (b.capabilities.reasoning ? 1 : 0);

        return bScore - aScore;
      });
  } catch (error) {
    console.warn('Could not get recommended models:', error);
    return [];
  }
};

/**
 * Generates capability-aware system prompt suggestions
 */
export const generateSystemPromptSuggestions = (model: LMStudioModelInfo): string[] => {
  const suggestions: string[] = [];

  if (model.capabilities.codeSpecialization) {
    suggestions.push(
      'Ce modèle excelle en programmation. Vous pouvez demander du code complexe, des explications détaillées et des optimisations.',
    );
  }

  if (model.capabilities.reasoning) {
    suggestions.push('Ce modèle supporte le raisonnement étape par étape. Utilisez "Réfléchis étape par étape" dans vos prompts.');
  }

  if (!model.capabilities.functionCalling) {
    suggestions.push("Ce modèle ne supporte pas l'appel de fonctions. Intégrez les outils directement dans le prompt système.");
  }

  if (model.type === 'efficient') {
    suggestions.push("Modèle optimisé pour l'efficacité. Gardez les prompts concis pour de meilleures performances.");
  }

  return suggestions;
};
