import { useCallback } from 'react';
import { LLMCapability, RobotId, normalizePersistenceConfig } from '../types';
import type { Agent, AgentInstance } from '../types';
import { useDesignStore } from '../stores/useDesignStore';
import { PersistenceService } from '../services/persistenceService';
import { syncMediaPanelsOnInstanceIdRemap } from '../services/mediaPanelSyncService';
import { findAvailableWorkflowNodePosition } from '../utils/workflowNodePlacement';

/**
 * US-RC-11 (vague 3) — port `AgentInstanceCreation` : `addAgentToWorkflow` extrait
 * d'`App.tsx` (création d'instance + placement + auto-save backend + remap d'ID
 * cross-store + création du node V2). Le remap cross-store est délégué à
 * `services/mediaPanelSyncService.ts` (leçon R1 : `getState()`, pas de closure).
 *
 * Per Dev_rules.md: Agent instances are ALWAYS auto-saved (independent of workflow save mode)
 * This ensures the agent_instances collection is populated immediately on creation.
 */
interface UseAgentInstanceCreationParams {
  isAuthenticated: boolean;
  accessToken: string | null;
  resolveCurrentWorkflowId: () => string | null;
}

export function useAgentInstanceCreation({ isAuthenticated, accessToken, resolveCurrentWorkflowId }: UseAgentInstanceCreationParams) {
  const addAgentInstance = useDesignStore((state) => state.addAgentInstance);
  const addNode = useDesignStore((state) => state.addNode);

  const addAgentToWorkflow = useCallback(
    async (agent: Agent) => {
      // Use instanceName if provided, otherwise use agent name
      const instanceName = agent.instanceName || agent.name;

      // ⭐ Get workflowId BEFORE creating instance
      const workflowId = resolveCurrentWorkflowId();
      const designState = useDesignStore.getState();
      const position = findAvailableWorkflowNodePosition({
        workflowId,
        nodes: designState.nodes,
        agentInstances: designState.agentInstances,
      });

      // Add agent instance to DesignStore with custom instance name and workflowId
      const instanceId = addAgentInstance(agent.id, position, instanceName, workflowId || undefined);

      // ⭐ AUTO-SAVE: Immediately persist to backend (if authenticated)
      if (isAuthenticated && accessToken && workflowId) {
        console.debug('[App] 📤 Auto-saving new agent instance to backend:', {
          instanceId,
          prototypeId: agent.id,
          workflowId,
        });

        const result = await PersistenceService.createAgentInstance(
          {
            id: instanceId,
            prototypeId: agent.id,
            name: instanceName,
            position,
            configuration_json: {
              role: agent.role,
              model: agent.model,
              llmProvider: agent.llmProvider,
              systemPrompt: agent.systemPrompt,
              tools: agent.tools || [],
              outputConfig: agent.outputConfig,
              // ⭐ PHASE 2: Include capabilities + historyConfig for complete persistence
              // Ensures reconnection loads same capabilities as template
              // Chat is ALWAYS included as the minimum capability
              capabilities: agent.capabilities && agent.capabilities.length > 0 ? agent.capabilities : [LLMCapability.Chat], // Fallback: minimum Chat capability
              // Include history config if template defined it
              historyConfig: agent.historyConfig || undefined,
            },
            // ⭐ Pass persistenceConfig override if provided from WorkflowValidationModal
            persistenceConfig: agent.persistenceConfig,
          },
          workflowId,
          { isAuthenticated, accessToken },
        );

        // ⭐ FIX: Utiliser le backendId comme ID final, sinon le tempId
        let finalInstanceId = instanceId;

        if (result.success) {
          console.debug('[App] ✅ Agent instance persisted to DB with backendId:', result.backendId);

          // ✅ ÉTAPE 2: Synchroniser l'instance complète du backend avec Zustand
          // Le backend retourne l'instance avec configuration_json enrichie
          const backendId = result.backendId;
          if (backendId && result.instance) {
            const persistedBackendId: string = backendId;

            // ✅ Remplacer l'instance temporaire par l'instance backend complète
            // Incluant la configuration_json qui sera utilisée dans AgentConfigurationModal
            const backendInstance: AgentInstance = {
              id: persistedBackendId,
              prototypeId: agent.id,
              name: instanceName,
              position,
              workflowId,
              isMinimized: false,
              isMaximized: false,
              // ⭐ FIX QA: Récupérer persistenceConfig du backend ou du prototype
              persistenceConfig: normalizePersistenceConfig(result.instance.persistenceConfig || agent.persistenceConfig),
              // ✅ configuration_json contient TOUS les détails de config (role, model, llmProvider, etc.)
              configuration_json: result.instance.configuration_json || {
                role: agent.role,
                model: agent.model,
                llmProvider: agent.llmProvider,
                systemPrompt: agent.systemPrompt,
                tools: agent.tools || [],
                outputConfig: agent.outputConfig,
                capabilities: agent.capabilities || [],
                historyConfig: agent.historyConfig,
                position,
              },
            };

            // ✅ CRITICAL: remap cross-store de l'ID d'instance (tempId -> backendId),
            // encapsulé dans mediaPanelSyncService (getState(), leçon R1/US-RC-00a)
            if (persistedBackendId !== instanceId) {
              syncMediaPanelsOnInstanceIdRemap(instanceId, persistedBackendId, workflowId);
            }
            // ✅ Ensuite mettre à jour la configuration complète
            // Use getState() for stable reference (avoid dependency on updateAgentInstance)
            useDesignStore.getState().updateAgentInstance(persistedBackendId, backendInstance);
            finalInstanceId = persistedBackendId;
          } else if (!backendId) {
            console.error('[App] ❌ Persisted agent instance is missing backendId:', result.instance);
          }
        } else {
          console.error('[App] ❌ Failed to persist agent instance:', result.error);
          // Don't block UI - instance exists locally, will sync later
        }

        // ⭐ CRITICAL: Create V2WorkflowNode in Zustand store AFTER ID resolution
        // ⭐ FIX: Utiliser getState() pour obtenir la valeur actuelle du store (pas la closure stale)
        const currentAgentInstances = useDesignStore.getState().agentInstances;

        const updatedInstance = currentAgentInstances.find((inst) => inst.id === finalInstanceId || inst.id === instanceId);

        if (updatedInstance) {
          // ⭐ FIX: Ensure workflowId is set on the instance
          const instanceWithWorkflowId: AgentInstance = {
            ...updatedInstance,
            id: finalInstanceId, // ⭐ Forcer l'utilisation de l'ID final
            workflowId: updatedInstance.workflowId || workflowId,
          };

          addNode({
            type: 'agent',
            position,
            data: {
              robotId: RobotId.Archi,
              label: instanceName,
              agent,
              agentInstance: instanceWithWorkflowId,
              workflowId,
              isMinimized: false,
              isMaximized: false,
            },
          });
        } else {
          console.warn('[App] ⚠️ Instance not found after creation, creating node anyway');
          // Créer le node avec les données disponibles
          addNode({
            type: 'agent',
            position,
            data: {
              robotId: RobotId.Archi,
              label: instanceName,
              agent,
              agentInstance: {
                id: finalInstanceId,
                prototypeId: agent.id,
                name: instanceName,
                position,
                isMinimized: false,
                isMaximized: false,
                workflowId,
                configuration_json: null,
              },
              workflowId,
              isMinimized: false,
              isMaximized: false,
            },
          });
        }
      } else {
        console.debug('[App] Guest mode - agent instance saved to localStorage via store');

        // Guest mode: créer le node avec l'ID local
        // ⭐ FIX: Utiliser getState() pour obtenir la valeur actuelle du store
        const guestAgentInstances = useDesignStore.getState().agentInstances;
        const localInstance = guestAgentInstances.find((inst) => inst.id === instanceId);
        if (localInstance) {
          addNode({
            type: 'agent',
            position,
            data: {
              robotId: RobotId.Archi,
              label: instanceName,
              agent,
              agentInstance: { ...localInstance, workflowId: localInstance.workflowId || 'guest-workflow' },
              workflowId: 'guest-workflow',
              isMinimized: false,
              isMaximized: false,
            },
          });
        }
      }
    },
    [addAgentInstance, addNode, isAuthenticated, accessToken, resolveCurrentWorkflowId],
  );

  return { addAgentToWorkflow };
}
