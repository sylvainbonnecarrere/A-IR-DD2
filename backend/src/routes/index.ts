/**
 * @fileoverview Index des routes API - Export centralisé
 * 
 * Organisation des routes :
 * - Routes V1 (Legacy) : agent-instances, workflows (ancienne architecture)
 * - Routes V2 (Nouvelle) : instances, workflows/v2/* (architecture Instance/Journal)
 * - Routes Media : stockage des fichiers générés par les agents
 */

// ============================================
// ROUTES V1 (Legacy - Rétrocompatibilité)
// ============================================

export { default as authRoutes } from './auth.routes';
export { default as workflowsRoutes } from './workflows.routes';
export { default as agentPrototypesRoutes } from './agent-prototypes.routes';
export { default as agentInstancesRoutes } from './agent-instances.routes';
export { default as llmConfigsRoutes } from './llm-configs.routes';
export { default as llmProxyRoutes } from './llm-proxy.routes';
export { default as userSettingsRoutes } from './user-settings.routes';
export { default as userWorkspaceRoutes } from './user-workspace.routes';
export { default as lmstudioRoutes } from './lmstudio.routes';
export { default as localLLMRoutes } from './local-llm.routes';

// ============================================
// ROUTES MEDIA (Stockage fichiers)
// ============================================

export { default as mediaRoutes } from './media.routes';

// ============================================
// ROUTES V2 (Nouvelle architecture - Jalon 2)
// ============================================
// ✅ ÉTAPE 4: instances.routes supprimé - utiliser agentInstancesRoutes à la place
