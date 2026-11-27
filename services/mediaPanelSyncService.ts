import { useAppShellStore } from '../stores/useAppShellStore';
import { useDesignStore } from '../stores/useDesignStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { remapAgentInstanceReference, remapEditingImageInfo, remapPanelNodeId } from '../utils/mediaPanelRuntimeSync';

/**
 * US-RC-11 (vague 3) — port `MediaPanelSync` : toute la synchronisation cross-store
 * lors d'un remap d'ID d'instance (ID local temporaire → ID backend persisté) est
 * encapsulée en un seul point, hors du composant.
 *
 * Leçon R1 (US-RC-00a) : les stores sont lus via `getState()` — jamais via une
 * closure périmée — donc le remap s'applique toujours à l'état courant, même si
 * l'agent image/vidéo a changé entre-temps.
 */
export function syncMediaPanelsOnInstanceIdRemap(fromInstanceId: string, toInstanceId: string, workflowId: string): void {
  if (fromInstanceId === toInstanceId) {
    return;
  }
  const fromNodeId = `node-${fromInstanceId}`;
  const toNodeId = `node-${toInstanceId}`;

  // Design store : renommer l'ID d'instance (tempId -> realId)
  useDesignStore.getState().updateInstanceId(fromInstanceId, toInstanceId);
  // Runtime store : renommer l'état runtime du nœud
  useRuntimeStore.getState().renameNodeRuntimeState(fromNodeId, toNodeId);

  // Shell store : remapper les 6 états média (3 panneaux nodeId, 2 références
  // d'instance, 1 editingImageInfo) à partir de l'état courant lu via getState()
  const shell = useAppShellStore.getState();
  shell.setCurrentImageNodeId(remapPanelNodeId(shell.currentImageNodeId, fromNodeId, toNodeId));
  shell.setCurrentImageAgentInstance(
    remapAgentInstanceReference(shell.currentImageAgentInstance, fromInstanceId, toInstanceId, workflowId),
  );
  shell.setCurrentVideoNodeId(remapPanelNodeId(shell.currentVideoNodeId, fromNodeId, toNodeId));
  shell.setCurrentVideoAgentInstance(
    remapAgentInstanceReference(shell.currentVideoAgentInstance, fromInstanceId, toInstanceId, workflowId),
  );
  shell.setCurrentMapsNodeId(remapPanelNodeId(shell.currentMapsNodeId, fromNodeId, toNodeId));
  shell.setEditingImageInfo(remapEditingImageInfo(shell.editingImageInfo, fromNodeId, toNodeId, fromInstanceId, toInstanceId, workflowId));
}
