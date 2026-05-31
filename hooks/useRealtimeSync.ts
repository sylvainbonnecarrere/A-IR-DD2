import { useEffect, useCallback, useRef } from 'react';
import webSocketService from '../services/webSocketService';
import { ChatMessage, NodePositionUpdateOptions, WorkflowNode } from '../types';

interface UseRealtimeSyncProps {
  nodes: WorkflowNode[];
  onUpdateNodePosition: (nodeId: string, position: { x: number; y: number }, options?: NodePositionUpdateOptions) => void;
  onUpdateNodeMessages: (nodeId: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  onToggleNodeMinimize: (nodeId: string) => void;
  currentUserId?: string;
}

interface UseRealtimeSyncReturn {
  syncPosition: (nodeId: string, position: { x: number; y: number }) => void;
  syncMessage: (nodeId: string, message: ChatMessage) => void;
  syncMinimize: (nodeId: string) => void;
}

export const useRealtimeSync = ({
  nodes,
  onUpdateNodePosition,
  onUpdateNodeMessages,
  onToggleNodeMinimize,
  currentUserId
}: UseRealtimeSyncProps): UseRealtimeSyncReturn => {
  const lastSyncTime = useRef<Map<string, number>>(new Map());
  const syncCooldown = 100; // 100ms cooldown pour éviter les boucles

  // === RÉCEPTION DES ÉVÉNEMENTS ===
  useEffect(() => {
    const handleAgentPositionUpdated = (data: { nodeId: string; position: { x: number; y: number }; userId: string }) => {
      // Ignorer nos propres updates
      if (data.userId === currentUserId) return;
      
      // Vérifier cooldown pour éviter les boucles
      const lastSync = lastSyncTime.current.get(`position_${data.nodeId}`) || 0;
      if (Date.now() - lastSync < syncCooldown) return;
      
      console.log('[Realtime] Position reçue:', data);
      onUpdateNodePosition(data.nodeId, data.position);
      lastSyncTime.current.set(`position_${data.nodeId}`, Date.now());
    };

    const handleAgentMessageAdded = (data: { nodeId: string; message: ChatMessage; userId: string }) => {
      // Ignorer nos propres updates
      if (data.userId === currentUserId) return;
      
      console.log('[Realtime] Message reçu:', data);
      onUpdateNodeMessages(data.nodeId, (prev) => [...prev, data.message]);
    };

    const handleAgentToggleMinimized = (data: { nodeId: string; userId: string }) => {
      // Ignorer nos propres updates
      if (data.userId === currentUserId) return;
      
      console.log('[Realtime] Toggle minimize reçu:', data);
      onToggleNodeMinimize(data.nodeId);
    };

    // S'abonner aux événements
    webSocketService.on('agentPositionUpdated', handleAgentPositionUpdated);
    webSocketService.on('agentMessageAdded', handleAgentMessageAdded);
    webSocketService.on('agentToggleMinimized', handleAgentToggleMinimized);

    // Nettoyage
    return () => {
      webSocketService.off('agentPositionUpdated', handleAgentPositionUpdated);
      webSocketService.off('agentMessageAdded', handleAgentMessageAdded);
      webSocketService.off('agentToggleMinimized', handleAgentToggleMinimized);
    };
  }, [onUpdateNodePosition, onUpdateNodeMessages, onToggleNodeMinimize, currentUserId]);

  // === ÉMISSION DES ÉVÉNEMENTS ===
  const syncPosition = useCallback((nodeId: string, position: { x: number; y: number }) => {
    // Vérifier cooldown
    const lastSync = lastSyncTime.current.get(`position_${nodeId}`) || 0;
    if (Date.now() - lastSync < syncCooldown) return;
    
    webSocketService.updateAgentPosition(nodeId, position);
    lastSyncTime.current.set(`position_${nodeId}`, Date.now());
  }, []);

  const syncMessage = useCallback((nodeId: string, message: ChatMessage) => {
    webSocketService.addAgentMessage(nodeId, message);
  }, []);

  const syncMinimize = useCallback((nodeId: string) => {
    webSocketService.toggleAgentMinimize(nodeId);
  }, []);

  return {
    syncPosition,
    syncMessage,
    syncMinimize,
  };
};