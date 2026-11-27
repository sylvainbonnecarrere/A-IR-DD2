import { useCallback } from 'react';
import { useDesignStore } from '../stores/useDesignStore';
import { deleteWorkflowInstance, deleteWorkflowInstances, persistNodePosition } from '../services/appWorkflowPersistenceService';
import type { AgentBatchDeleteResult, AgentDeletionMediaPolicy, NodePositionUpdateOptions } from '../types';

/**
 * US-RC-11 (vague 1) — port `NodePersistenceActions` : regroupe les actions de
 * persistance des nœuds extraites d'`App.tsx` (handleDeleteNode / handleDeleteNodes /
 * handleUpdateNodePosition). Les signatures des handlers sont inchangées (contrat
 * stable avec RobotPageRouter / FullscreenChatModal) ; le composant ne fait plus
 * qu'appeler ce hook.
 *
 * Leçon R1 (US-RC-00a) : dans les callbacks async, l'état cross-store est lu via
 * `useDesignStore.getState()` — jamais via une closure périmée.
 */
interface UseNodePersistenceActionsParams {
  isAuthenticated: boolean;
  accessToken: string | null;
  resolveCurrentWorkflowId: () => string | null;
}

export function useNodePersistenceActions({ isAuthenticated, accessToken, resolveCurrentWorkflowId }: UseNodePersistenceActionsParams) {
  const deleteNode = useDesignStore((state) => state.deleteNode);
  const deleteAgentInstance = useDesignStore((state) => state.deleteAgentInstance);
  const updateNode = useDesignStore((state) => state.updateNode);
  const updateAgentInstance = useDesignStore((state) => state.updateAgentInstance);

  /**
   * ⭐ FIX: Suppression robuste d'un node avec persistance backend
   * Gère les deux formats d'ID (legacy et V2)
   */
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      console.debug('[App] handleDeleteNode called with:', nodeId);

      const v2Node = useDesignStore.getState().nodes.find((node) => node.id === nodeId);
      const finalInstanceId = v2Node?.data?.agentInstance?.id || (nodeId.startsWith('node-') ? nodeId.replace(/^node-/, '') : undefined);

      console.debug('[App] Delete node resolution:', {
        nodeId,
        storeInstanceId: v2Node?.data?.agentInstance?.id,
        finalInstanceId,
      });

      deleteNode(nodeId);

      if (finalInstanceId) {
        deleteAgentInstance(finalInstanceId);
        const workflowId = resolveCurrentWorkflowId();
        const deleted = await deleteWorkflowInstance({
          workflowId,
          instanceId: finalInstanceId,
          isAuthenticated,
          accessToken,
        });

        if (deleted) {
          console.debug('[App] ✅ Agent instance deleted from backend:', finalInstanceId);
        }
      }
    },
    [deleteNode, deleteAgentInstance, isAuthenticated, accessToken, resolveCurrentWorkflowId],
  );

  const handleDeleteNodes = useCallback(
    async (instanceIds: string[], mediaPolicy: AgentDeletionMediaPolicy = 'delete_media'): Promise<AgentBatchDeleteResult> => {
      console.debug('[App] handleDeleteNodes called with:', instanceIds, 'policy:', mediaPolicy);

      const workflowId = resolveCurrentWorkflowId();
      return deleteWorkflowInstances({
        workflowId,
        instanceIds,
        mediaPolicy,
        isAuthenticated,
        accessToken,
        onDeleteLocalNode: (nodeId) => deleteNode(nodeId),
        onDeleteLocalInstance: (instanceId) => deleteAgentInstance(instanceId),
      });
    },
    [deleteNode, deleteAgentInstance, isAuthenticated, accessToken, resolveCurrentWorkflowId],
  );

  const handleUpdateNodePosition = useCallback(
    (nodeId: string, position: { x: number; y: number }, options?: NodePositionUpdateOptions) => {
      const designState = useDesignStore.getState();
      const movedNode = designState.nodes.find((node) => node.id === nodeId);
      const instanceId = movedNode?.data.agentInstance?.id;
      updateNode(nodeId, { position });

      if (instanceId) {
        updateAgentInstance(instanceId, { position });
      }

      if (!options?.persist || !instanceId) {
        return;
      }

      void persistNodePosition({
        nodeId,
        position,
        instanceId,
        isAuthenticated,
        accessToken,
        updateNode,
        updateAgentInstance,
      });
    },
    [accessToken, isAuthenticated, updateAgentInstance, updateNode],
  );

  return { handleDeleteNode, handleDeleteNodes, handleUpdateNodePosition };
}
