import { useState, useEffect, useCallback } from 'react';
import webSocketService, { ConnectionState } from '../services/webSocketService';
import { ChatMessage } from '../types';

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  joinWorkspace: (workspaceId: string) => void;
  leaveWorkspace: () => void;
  updateAgentPosition: (nodeId: string, position: { x: number; y: number }) => void;
  addAgentMessage: (nodeId: string, message: ChatMessage) => void;
  toggleAgentMinimize: (nodeId: string) => void;
  updateCursor: (x: number, y: number) => void;
  reconnect: () => void;
  disconnect: () => void;
}

export const useWebSocket = (): UseWebSocketReturn => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(webSocketService.getConnectionState());

  useEffect(() => {
    // S'abonner aux changements d'état de connexion
    const handleConnectionStateChange = (newState: ConnectionState) => {
      setConnectionState(newState);
    };

    webSocketService.on('connectionStateChanged', handleConnectionStateChange);

    // Nettoyage
    return () => {
      webSocketService.off('connectionStateChanged', handleConnectionStateChange);
    };
  }, []);

  // Méthodes exposées
  const joinWorkspace = useCallback((workspaceId: string) => {
    webSocketService.joinWorkspace(workspaceId);
  }, []);

  const leaveWorkspace = useCallback(() => {
    webSocketService.leaveWorkspace();
  }, []);

  const updateAgentPosition = useCallback((nodeId: string, position: { x: number; y: number }) => {
    webSocketService.updateAgentPosition(nodeId, position);
  }, []);

  const addAgentMessage = useCallback((nodeId: string, message: ChatMessage) => {
    webSocketService.addAgentMessage(nodeId, message);
  }, []);

  const toggleAgentMinimize = useCallback((nodeId: string) => {
    webSocketService.toggleAgentMinimize(nodeId);
  }, []);

  const updateCursor = useCallback((x: number, y: number) => {
    webSocketService.updateCursor(x, y);
  }, []);

  const reconnect = useCallback(() => {
    webSocketService.reconnect();
  }, []);

  const disconnect = useCallback(() => {
    webSocketService.disconnect();
  }, []);

  return {
    connectionState,
    joinWorkspace,
    leaveWorkspace,
    updateAgentPosition,
    addAgentMessage,
    toggleAgentMinimize,
    updateCursor,
    reconnect,
    disconnect,
  };
};
