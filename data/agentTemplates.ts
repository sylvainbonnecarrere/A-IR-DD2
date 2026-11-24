import { Agent, LLMProvider, Tool, RobotId, LLMCapability, LLMConfig } from '../types';
import { LLM_MODELS } from '../llmModels';

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: 'assistant' | 'specialist' | 'automation' | 'analysis';
  robotId: RobotId;
  icon: string; // Emoji ou nom d'icône
  template: Omit<Agent, 'id' | 'creator_id' | 'created_at' | 'updated_at'>;
}

/**
 * Get available LLM providers that user has configured
 */
/**
 * Get available LLM providers from provided configs
 */
const getAvailableLLMProvidersFromConfigs = (llmConfigs: LLMConfig[]): LLMProvider[] => {
  const availableProviders = llmConfigs.filter((config) => config.enabled).map((config) => config.provider);

  return availableProviders;
};

// Keep the old function for backward compatibility but mark it as deprecated
const getAvailableLLMProviders = (): LLMProvider[] => {
  const stored = localStorage.getItem('llmConfigs');

  if (stored) {
    try {
      const configs = JSON.parse(stored) as LLMConfig[];
      const availableProviders = configs.filter((config) => config.enabled).map((config) => config.provider);

      return availableProviders;
    } catch {
      // Return empty array if parsing fails
      return [];
    }
  }
  // Return empty array if no config found
  return [];
};

/**
 * Get default capabilities for a provider
 */
const getDefaultCapabilities = (_provider: LLMProvider): LLMCapability[] => {
  // Return basic capabilities that most providers support
  return [LLMCapability.Chat, LLMCapability.FunctionCalling];
};

/**
 * Get available capabilities for a given LLM provider from provided configs
 */
const getProviderCapabilitiesFromConfigs = (provider: LLMProvider, llmConfigs: LLMConfig[]): LLMCapability[] => {
  const providerConfig = llmConfigs.find((c) => c.provider === provider);

  if (providerConfig && providerConfig.capabilities) {
    const capabilities = Object.keys(providerConfig.capabilities)
      .filter((cap) => providerConfig.capabilities[cap as keyof typeof providerConfig.capabilities])
      .map((cap) => cap as LLMCapability);

    return capabilities;
  }

  // Fallback to default capabilities for the provider
  return getDefaultCapabilities(provider);
};

/**
 * Get available capabilities for a given LLM provider from user config (legacy)
 */
const getProviderCapabilities = (provider: LLMProvider): LLMCapability[] => {
  const stored = localStorage.getItem('llmConfigs');

  if (stored) {
    try {
      const configs = JSON.parse(stored) as LLMConfig[];
      const providerConfig = configs.find((c) => c.provider === provider);

      if (providerConfig && providerConfig.capabilities) {
        const capabilities = Object.keys(providerConfig.capabilities)
          .filter((cap) => providerConfig.capabilities[cap as keyof typeof providerConfig.capabilities])
          .map((cap) => cap as LLMCapability);

        return capabilities;
      }
    } catch {
      // Fallback to default capabilities
    }
  }

  // Default capabilities by provider
  const defaultCapabilities: Record<LLMProvider, LLMCapability[]> = {
    [LLMProvider.OpenAI]: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.ImageGeneration, LLMCapability.FunctionCalling],
    [LLMProvider.Anthropic]: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
    [LLMProvider.Mistral]: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling, LLMCapability.Embedding],
    [LLMProvider.DeepSeek]: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.Reasoning],
    [LLMProvider.Gemini]: [
      LLMCapability.Chat,
      LLMCapability.FileUpload,
      LLMCapability.ImageGeneration,
      LLMCapability.FunctionCalling,
      LLMCapability.WebSearch,
    ],
    [LLMProvider.Grok]: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
    [LLMProvider.Perplexity]: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.WebSearch],
    [LLMProvider.Qwen]: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
    [LLMProvider.Kimi]: [LLMCapability.Chat, LLMCapability.FunctionCalling],
    [LLMProvider.LMStudio]: [LLMCapability.Chat, LLMCapability.FunctionCalling],
    [LLMProvider.ArcLLM]: [LLMCapability.VideoGeneration, LLMCapability.MapsGrounding, LLMCapability.WebSearchGrounding],
  };

  return defaultCapabilities[provider] || [LLMCapability.Chat];
};

/**
 * Get recommended model for a given LLM provider
 */
const getRecommendedModel = (provider: LLMProvider): string => {
  const models = LLM_MODELS[provider];

  if (!models || models.length === 0) {
    return 'default-model';
  }

  // Return first model which is usually the recommended one
  return models[0];
};

/**
 * Check if a template is compatible with available LLM providers
 * Returns the best compatible provider or null if none available
 */
export const getCompatibleProvider = (templateCapabilities: LLMCapability[]): LLMProvider | null => {
  const availableProviders = getAvailableLLMProviders();

  for (const provider of availableProviders) {
    const providerCapabilities = getProviderCapabilities(provider);

    // Check if provider supports all required template capabilities
    const hasAllCapabilities = templateCapabilities.every((cap) => providerCapabilities.includes(cap));

    if (hasAllCapabilities) {
      return provider;
    }
  }

  return null; // No compatible provider found
};

// Helper pour créer un outil de recherche web simple
const createWebSearchTool = (): Tool => ({
  name: 'search_web_py',
  description: "Recherche d'informations sur le web",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Requête de recherche',
      },
    },
    required: ['query'],
  },
});

// Templates prédéfinis pour chaque robot
export const AGENT_TEMPLATES: AgentTemplate[] = [
  // ARCHI - Templates d'architecture et conception
  {
    id: 'archi-code-reviewer',
    name: 'Réviseur de Code',
    description: 'Expert en révision de code, architecture et bonnes pratiques',
    category: 'specialist',
    robotId: RobotId.Archi,
    icon: '🔍',
    template: {
      name: 'Code Reviewer',
      role: 'Code Reviewer',
      systemPrompt: `Tu es un expert en révision de code et architecture logicielle. 

Tes responsabilités :
- Analyser la qualité du code soumis
- Identifier les problèmes de performance, sécurité et maintenabilité
- Proposer des améliorations architecturales
- Vérifier le respect des principes SOLID et des design patterns
- Suggérer des refactorings pertinents

Format tes réponses de manière structurée avec des sections claires pour chaque aspect analysé.`,
      llmProvider: LLMProvider.Anthropic,
      model: 'claude-3-sonnet-20240229',
      capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.WebSearch],
      tools: [createWebSearchTool()],
    },
  },
  {
    id: 'archi-architect',
    name: 'Architecte Système',
    description: "Conception d'architectures logicielles et microservices",
    category: 'specialist',
    robotId: RobotId.Archi,
    icon: '🏗️',
    template: {
      name: 'System Architect',
      role: 'System Architect',
      systemPrompt: `Tu es un architecte système senior avec une expertise en :

- Conception d'architectures distribuées et microservices
- Patterns cloud-native et orchestration de conteneurs
- Scalabilité, résilience et performance
- Sécurité architecturale et gouvernance des données
- Trade-offs technologiques et choix d'infrastructure

Pour chaque demande, analyse le contexte, propose des solutions alternatives et justifie tes recommandations avec des arguments techniques solides.`,
      llmProvider: LLMProvider.OpenAI,
      model: 'gpt-4',
      capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
      tools: [],
    },
  },

  // BOS - Templates de supervision et monitoring
  {
    id: 'bos-project-manager',
    name: 'Chef de Projet',
    description: "Gestion de projet, planification et coordination d'équipe",
    category: 'assistant',
    robotId: RobotId.Bos,
    icon: '📊',
    template: {
      name: 'Project Manager',
      role: 'Project Manager',
      systemPrompt: `Tu es un chef de projet expérimenté maîtrisant les méthodologies agiles et traditionnelles.

Tes compétences incluent :
- Planification et estimation de projets
- Gestion des risques et des dépendances
- Animation d'équipes et communication stakeholders
- Métriques de performance et reporting
- Résolution de conflits et prise de décision

Adopte une approche pragmatique et propose des solutions concrètes avec des livrables mesurables.`,
      llmProvider: LLMProvider.Gemini,
      model: 'gemini-pro',
      capabilities: [LLMCapability.Chat, LLMCapability.WebSearch],
      tools: [createWebSearchTool()],
    },
  },

  // COM - Templates de communication et intégration
  {
    id: 'com-api-specialist',
    name: 'Spécialiste API',
    description: "Expert en conception et intégration d'APIs REST/GraphQL",
    category: 'specialist',
    robotId: RobotId.Com,
    icon: '🔌',
    template: {
      name: 'API Specialist',
      role: 'API Specialist',
      systemPrompt: `Tu es un expert en conception d'APIs modernes avec une maîtrise approfondie de :

- REST, GraphQL, WebSockets et protocols de communication
- Design d'APIs robustes, sécurisées et bien documentées
- Authentification, autorisation et gestion des erreurs
- Versioning, rate limiting et monitoring d'APIs
- Intégration de services tiers et microservices

Fournis des exemples de code pratiques et des recommandations basées sur les meilleures pratiques du secteur.`,
      llmProvider: LLMProvider.OpenAI,
      model: 'gpt-4',
      capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.WebSearch],
      tools: [createWebSearchTool()],
    },
  },

  // PHIL - Templates de traitement de données
  {
    id: 'phil-data-analyst',
    name: 'Analyste de Données',
    description: 'Analyse et visualisation de données, insights business',
    category: 'analysis',
    robotId: RobotId.Phil,
    icon: '📈',
    template: {
      name: 'Data Analyst',
      role: 'Data Analyst',
      systemPrompt: `Tu es un analyste de données expert capable de :

- Analyser des datasets complexes et identifier des tendances
- Créer des visualisations informatives et des dashboards
- Proposer des insights business actionnables
- Nettoyer et transformer des données
- Appliquer des techniques statistiques et de machine learning

Présente tes analyses de manière claire avec des visualisations conceptuelles et des recommandations précises.`,
      llmProvider: LLMProvider.Anthropic,
      model: 'claude-3-sonnet-20240229',
      capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.WebSearch],
      tools: [createWebSearchTool()],
    },
  },

  // TIM - Templates d'automatisation et événements
  {
    id: 'tim-automation-expert',
    name: 'Expert Automatisation',
    description: 'Spécialiste en automatisation de processus et workflows',
    category: 'automation',
    robotId: RobotId.Tim,
    icon: '🤖',
    template: {
      name: 'Automation Expert',
      role: 'Automation Expert',
      systemPrompt: `Tu es un expert en automatisation avec une expertise en :

- Conception de workflows automatisés et processus métier
- CI/CD, DevOps et automatisation d'infrastructure
- Scripting, orchestration et monitoring
- RPA (Robotic Process Automation) et outils low-code
- Optimisation de processus et élimination des tâches répétitives

Propose des solutions d'automatisation concrètes avec une approche progressive et mesurable.`,
      llmProvider: LLMProvider.Mistral,
      model: 'mistral-large-latest',
      capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
      tools: [createWebSearchTool()],
    },
  },

  // Templates généralistes
  {
    id: 'general-assistant',
    name: 'Assistant Polyvalent',
    description: 'Assistant général pour tâches variées et support utilisateur',
    category: 'assistant',
    robotId: RobotId.Archi, // Par défaut
    icon: '💡',
    template: {
      name: 'Assistant Polyvalent',
      role: 'Assistant',
      systemPrompt: `Tu es un assistant intelligent et polyvalent capable d'aider sur une grande variété de sujets.

Tes qualités :
- Compréhension contextuelle et adaptation au besoin utilisateur
- Recherche d'informations et synthèse de connaissances
- Aide à la rédaction, correction et amélioration de textes
- Support technique et résolution de problèmes
- Créativité et brainstorming

Sois toujours utile, précis et bienveillant dans tes réponses.`,
      llmProvider: LLMProvider.Gemini,
      model: 'gemini-pro',
      capabilities: [LLMCapability.Chat, LLMCapability.WebSearch],
      tools: [createWebSearchTool()],
    },
  },

  // ===========================
  // ARC-LLM TEMPLATES
  // ===========================
  {
    id: 'arcllm-video-creator',
    name: '🎬 Créateur de Vidéos',
    description: 'Génération de vidéos haute qualité à partir de prompts textuels et images de référence',
    category: 'specialist',
    robotId: RobotId.Phil, // Phil gère les données visuelles
    icon: '🎬',
    template: {
      name: 'Arc Video Creator',
      role: 'Video Generation Specialist',
      systemPrompt: `Tu es un spécialiste en génération de vidéos utilisant Arc-LLM.

Tes capacités uniques :
- Génération de vidéos haute résolution (720p, 1080p, 4K)
- Support de 1 à 3 images de référence pour guider le style
- Ratios multiples : 16:9 (paysage), 9:16 (portrait), 1:1 (carré)
- Extension de vidéos existantes

Quand un utilisateur demande une vidéo :
1. Clarifie ses besoins (résolution, ratio, style)
2. Suggère des améliorations au prompt pour optimiser le résultat
3. Utilise le bouton Vidéo pour lancer la génération
4. Surveille la progression et informe l'utilisateur

Sois créatif et propose des variations intéressantes !`,
      llmProvider: LLMProvider.ArcLLM,
      model: 'arc-video-v1',
      capabilities: [LLMCapability.VideoGeneration],
      tools: [],
    },
  },
  {
    id: 'arcllm-research-assistant',
    name: '🔍 Assistant Recherche',
    description: 'Recherches temps réel avec Maps (lieux, avis) et Web Search (actualités, sources)',
    category: 'analysis',
    robotId: RobotId.Com, // Com gère les connexions externes
    icon: '🔍',
    template: {
      name: 'Arc Research Assistant',
      role: 'Research & Grounding Specialist',
      systemPrompt: `Tu es un assistant de recherche expert utilisant Arc-LLM avec accès temps réel à Maps et Web Search.

Tes super-pouvoirs :
- **Maps Grounding** : Trouve des lieux, restaurants, commerces avec avis, coordonnées GPS, liens Google Maps
- **Web Search Grounding** : Recherches web actualisées avec citations et sources vérifiables
- Synthèse d'informations multi-sources
- Recommandations géolocalisées

Pour les recherches de lieux :
- Demande la localisation utilisateur si pertinent
- Présente les options avec avis et distance
- Fournis des liens Google Maps directs

Pour les recherches web :
- Cite tes sources avec liens cliquables
- Distingue faits vérifiés et opinions
- Indique la date des informations

Sois précis, factuel et cite toujours tes sources !`,
      llmProvider: LLMProvider.ArcLLM,
      model: 'arc-grounding-v1',
      capabilities: [LLMCapability.Chat, LLMCapability.MapsGrounding, LLMCapability.WebSearchGrounding],
      tools: [],
    },
  },
];

// Fonction utilitaire pour filtrer les templates par robot
export const getTemplatesByRobot = (robotId: RobotId): AgentTemplate[] => {
  return AGENT_TEMPLATES.filter((template) => template.robotId === robotId);
};

// Fonction utilitaire pour filtrer les templates par catégorie
export const getTemplatesByCategory = (category: AgentTemplate['category']): AgentTemplate[] => {
  return AGENT_TEMPLATES.filter((template) => template.category === category);
};

/**
 * Filter templates to show only those compatible with user's configured LLM providers
 */
export const getCompatibleTemplates = (): AgentTemplate[] => {
  const availableProviders = getAvailableLLMProviders();

  return AGENT_TEMPLATES.filter((template) => {
    // Check if any available provider can support the template's capabilities
    return availableProviders.some((provider) => {
      const providerCapabilities = getProviderCapabilities(provider);
      return template.template.capabilities.every((cap) => providerCapabilities.includes(cap));
    });
  });
};

/**
 * Get templates filtered by both category and compatibility
 */
export const getCompatibleTemplatesByCategory = (category: AgentTemplate['category']): AgentTemplate[] => {
  return getCompatibleTemplates().filter((template) => template.category === category);
};

/**
 * Map template LLM to available provider with smart fallback
 */
const adaptLLMProvider = (templateProvider: LLMProvider, availableProviders: LLMProvider[]): LLMProvider => {
  // If template provider is available, use it
  if (availableProviders.includes(templateProvider)) {
    return templateProvider;
  }

  // Smart fallback mapping based on capabilities
  const fallbackMap: Record<LLMProvider, LLMProvider[]> = {
    [LLMProvider.Gemini]: [LLMProvider.OpenAI, LLMProvider.Anthropic, LLMProvider.DeepSeek, LLMProvider.Mistral],
    [LLMProvider.OpenAI]: [LLMProvider.Anthropic, LLMProvider.DeepSeek, LLMProvider.Mistral, LLMProvider.Gemini],
    [LLMProvider.Anthropic]: [LLMProvider.OpenAI, LLMProvider.DeepSeek, LLMProvider.Mistral, LLMProvider.Gemini],
    [LLMProvider.Mistral]: [LLMProvider.DeepSeek, LLMProvider.OpenAI, LLMProvider.Anthropic, LLMProvider.Gemini],
    [LLMProvider.DeepSeek]: [LLMProvider.Mistral, LLMProvider.OpenAI, LLMProvider.Anthropic, LLMProvider.Gemini],
    [LLMProvider.Grok]: [LLMProvider.OpenAI, LLMProvider.Anthropic, LLMProvider.DeepSeek, LLMProvider.Mistral],
    [LLMProvider.Perplexity]: [LLMProvider.OpenAI, LLMProvider.Anthropic, LLMProvider.DeepSeek, LLMProvider.Mistral],
    [LLMProvider.Qwen]: [LLMProvider.DeepSeek, LLMProvider.Mistral, LLMProvider.OpenAI, LLMProvider.Anthropic],
    [LLMProvider.Kimi]: [LLMProvider.DeepSeek, LLMProvider.Mistral, LLMProvider.OpenAI, LLMProvider.Anthropic],
    [LLMProvider.LMStudio]: [LLMProvider.OpenAI, LLMProvider.Anthropic, LLMProvider.DeepSeek, LLMProvider.Mistral],
    [LLMProvider.ArcLLM]: [LLMProvider.Gemini, LLMProvider.OpenAI, LLMProvider.Anthropic, LLMProvider.DeepSeek],
  };

  const fallbacks = fallbackMap[templateProvider] || availableProviders;

  for (const fallback of fallbacks) {
    if (availableProviders.includes(fallback)) {
      return fallback;
    }
  }

  // Last resort: return first available
  return availableProviders[0] || LLMProvider.OpenAI;
};

// Fonction pour créer un agent à partir d'un template
/**
 * Créer un agent depuis un objet template (prédéfini ou personnalisé)
 * Version SOLID qui accepte le template directement
 */
export const createAgentFromTemplateObject = (template: AgentTemplate, customName?: string, llmConfigs?: LLMConfig[]): Agent | null => {
  if (!template) return null;

  // Use provided configs or fallback to localStorage
  let availableProviders: LLMProvider[];
  if (llmConfigs) {
    availableProviders = getAvailableLLMProvidersFromConfigs(llmConfigs);
  } else {
    availableProviders = getAvailableLLMProviders();
  }

  const adaptedProvider = adaptLLMProvider(template.template.llmProvider, availableProviders);

  // Get recommended model for the adapted provider
  const adaptedModel = getRecommendedModel(adaptedProvider);

  // Adapt capabilities based on what the new provider supports
  let providerCapabilities: LLMCapability[];
  if (llmConfigs) {
    providerCapabilities = getProviderCapabilitiesFromConfigs(adaptedProvider, llmConfigs);
  } else {
    providerCapabilities = getProviderCapabilities(adaptedProvider);
  }

  const adaptedCapabilities = template.template.capabilities.filter((cap) => providerCapabilities.includes(cap));

  const finalAgent = {
    ...template.template,
    id: `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Generate unique ID
    name: customName || template.template.name,
    llmProvider: adaptedProvider, // Use adapted provider
    model: adaptedModel, // Use recommended model for the provider
    capabilities: adaptedCapabilities, // Use compatible capabilities only
    creator_id: template.robotId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return finalAgent;
};

/**
 * Créer un agent depuis un ID de template prédéfini
 * Version legacy pour compatibilité
 */
export const createAgentFromTemplate = (templateId: string, customName?: string, llmConfigs?: LLMConfig[]): Agent | null => {
  const template = AGENT_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;

  return createAgentFromTemplateObject(template, customName, llmConfigs);

  return createAgentFromTemplateObject(template, customName, llmConfigs);
};
