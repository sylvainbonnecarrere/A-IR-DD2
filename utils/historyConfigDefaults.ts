/**
 * @file historyConfigDefaults.ts
 * @description Utilitaires pour HistoryConfig avec defaults robustes
 * @domain Runtime Domain - History Configuration
 * 
 * Fournit:
 * - Defaults HistoryConfig complète
 * - Initialisation avec fallbacks
 * - Garantit toujours une config valide (jamais undefined)
 */

import { HistoryConfig, HistoryLimitEnabledMap, HistoryLimitValues, LLMProvider } from '../types';
import { LLM_MODELS } from '../llmModels';

const HISTORY_LIMIT_KEYS: Array<keyof HistoryLimitValues> = ['char', 'word', 'token', 'sentence', 'message'];

const DEFAULT_HISTORY_LIMITS: HistoryLimitValues = {
  char: 5000,
  word: 1000,
  token: 800,
  sentence: 30,
  message: 6,
};

const DEFAULT_ENABLED_HISTORY_LIMITS: HistoryLimitEnabledMap = {
  char: false,
  word: false,
  token: false,
  sentence: true,
  message: true,
};

const hasCompleteLimitValues = (limits: unknown): limits is HistoryLimitValues => {
  if (!limits || typeof limits !== 'object') {
    return false;
  }

  return HISTORY_LIMIT_KEYS.every((key) => typeof (limits as Record<string, unknown>)[key] === 'number');
};

const hasCompleteEnabledLimits = (enabledLimits: unknown): enabledLimits is HistoryLimitEnabledMap => {
  if (!enabledLimits || typeof enabledLimits !== 'object') {
    return false;
  }

  return HISTORY_LIMIT_KEYS.every((key) => typeof (enabledLimits as Record<string, unknown>)[key] === 'boolean');
};

/**
 * DEFAULT_HISTORY_CONFIG: Configuration de base complète pour l'historique
 * Utilisé quand un agent n'a JAMAIS eu d'historique configuré
 */
export const createDefaultHistoryConfig = (): HistoryConfig => ({
  enabled: false, // Désactivé par défaut (user doit explicitement activer)
  llmProvider: LLMProvider.Gemini, // Fallback provider
  model: 'gemini-2.0-flash', // Default model
  role: 'Archiviste Concis', // Archiviste role (neutral, factual summarization)
  systemPrompt: 'Résume la conversation suivante de manière factuelle et concise, en conservant les points clés et les décisions prises. Le résumé servira de mémoire pour un autre agent IA. Sois bref mais complet (max 500 mots).',
  limits: { ...DEFAULT_HISTORY_LIMITS },
  enabledLimits: { ...DEFAULT_ENABLED_HISTORY_LIMITS }
});

/**
 * Initialise HistoryConfig avec smart defaults
 * 
 * Stratégie:
 * 1. Si historyConfig est complet et valide → utiliser directement
 * 2. Si historyConfig est partial → merger avec defaults (preserve user changes)
 * 3. Si historyConfig est undefined → utiliser full defaults avec first enabled provider
 * 4. Chat = jamais undefined (invariant)
 * 
 * @param existingConfig Config actuelle (peut être undefined, partial, ou complet)
 * @param enabledProviders Liste des providers disponibles (triés par priorité)
 * @returns HistoryConfig valide et complète
 */
export const initializeHistoryConfig = (
  existingConfig: Partial<HistoryConfig> | undefined,
  enabledProviders: LLMProvider[]
): HistoryConfig => {
  // Start with full defaults
  const defaults = createDefaultHistoryConfig();
  
  // If no existing config, use defaults with first enabled provider
  if (!existingConfig) {
    const firstEnabledProvider = enabledProviders[0] || LLMProvider.Gemini;
    const firstModelOfProvider = LLM_MODELS[firstEnabledProvider]?.[0] || 'gemini-2.0-flash';
    
    return {
      ...defaults,
      llmProvider: firstEnabledProvider,
      model: firstModelOfProvider
    };
  }

  // If existing config exists, merge intelligently
  // Preserve user's explicit choices, fill in missing pieces with defaults
  return {
    // MANDATORY: Always have enabled flag
    enabled: existingConfig.enabled ?? defaults.enabled,
    
    // LLM Config: Use existing if valid, else use first enabled provider
    llmProvider: (existingConfig.llmProvider && enabledProviders.includes(existingConfig.llmProvider))
      ? existingConfig.llmProvider
      : enabledProviders[0] || LLMProvider.Gemini,
    
    model: existingConfig.model || 
      LLM_MODELS[existingConfig.llmProvider || enabledProviders[0] || LLMProvider.Gemini]?.[0] ||
      'gemini-2.0-flash',
    
    // Synthesis Config: Use existing or defaults
    role: existingConfig.role || defaults.role,
    systemPrompt: existingConfig.systemPrompt || defaults.systemPrompt,
    
    // Limits: Merge existing with defaults (preserve user overrides)
    limits: {
      char: existingConfig.limits?.char ?? defaults.limits.char,
      word: existingConfig.limits?.word ?? defaults.limits.word,
      token: existingConfig.limits?.token ?? defaults.limits.token,
      sentence: existingConfig.limits?.sentence ?? defaults.limits.sentence,
      message: existingConfig.limits?.message ?? defaults.limits.message
    },

    enabledLimits: {
      char: existingConfig.enabledLimits?.char ?? defaults.enabledLimits.char,
      word: existingConfig.enabledLimits?.word ?? defaults.enabledLimits.word,
      token: existingConfig.enabledLimits?.token ?? defaults.enabledLimits.token,
      sentence: existingConfig.enabledLimits?.sentence ?? defaults.enabledLimits.sentence,
      message: existingConfig.enabledLimits?.message ?? defaults.enabledLimits.message,
    },
  };
};

/**
 * Valide une HistoryConfig et la répare si incomplète
 * Utilisé lors du load depuis backend (peut avoir partial data)
 */
export const validateAndRepairHistoryConfig = (
  config: any,
  enabledProviders: LLMProvider[]
): HistoryConfig => {
  if (!config || typeof config !== 'object') {
    return initializeHistoryConfig(undefined, enabledProviders);
  }

  // Check for missing critical fields
  const isPartial = 
    !config.llmProvider ||
    !config.model ||
    !hasCompleteLimitValues(config.limits) ||
    !hasCompleteEnabledLimits(config.enabledLimits);

  if (isPartial) {
    // Merge with defaults to restore completeness
    return initializeHistoryConfig(config, enabledProviders);
  }

  return config as HistoryConfig;
};

/**
 * Retourne une config prête pour le save au backend
 * Assure que tous les champs requis sont présents
 * Valide que le provider est toujours dans la liste des providers disponibles
 */
export const prepareHistoryConfigForSave = (
  config: Partial<HistoryConfig>,
  enabledProviders?: LLMProvider[]
): HistoryConfig => {
  const defaults = createDefaultHistoryConfig();
  
  // Déterminer le provider: utiliser celui du user s'il est toujours valide, sinon fallback
  let llmProvider = (config.llmProvider as LLMProvider) || defaults.llmProvider;
  if (enabledProviders && !enabledProviders.includes(llmProvider)) {
    // Provider que l'user a choisi n'est plus enabled → fallback au premier disponible
    llmProvider = enabledProviders[0] || defaults.llmProvider;
  }
  
  // Déterminer le modèle : si provider a changé, prendre le premier modèle du nouveau provider
  let model = config.model;
  if (!model || (enabledProviders && !enabledProviders.includes(config.llmProvider as LLMProvider))) {
    // Model pas set ou provider a changé → prendre premier modèle du provider
    model = LLM_MODELS[llmProvider]?.[0] || defaults.model;
  }
  
  return {
    enabled: config.enabled ?? defaults.enabled,
    llmProvider,
    model,
    role: config.role || defaults.role,
    systemPrompt: config.systemPrompt || defaults.systemPrompt,
    limits: {
      char: config.limits?.char ?? defaults.limits.char,
      word: config.limits?.word ?? defaults.limits.word,
      token: config.limits?.token ?? defaults.limits.token,
      sentence: config.limits?.sentence ?? defaults.limits.sentence,
      message: config.limits?.message ?? defaults.limits.message
    },
    enabledLimits: {
      char: config.enabledLimits?.char ?? defaults.enabledLimits.char,
      word: config.enabledLimits?.word ?? defaults.enabledLimits.word,
      token: config.enabledLimits?.token ?? defaults.enabledLimits.token,
      sentence: config.enabledLimits?.sentence ?? defaults.enabledLimits.sentence,
      message: config.enabledLimits?.message ?? defaults.enabledLimits.message,
    },
  };
};
