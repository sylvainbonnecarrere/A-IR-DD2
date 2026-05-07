/**
 * @file useJournalQueue.ts
 * @description Hook personnalisé pour gérer une queue de persistance journal robuste
 * 
 * Fonctionnalités :
 * - Queue locale pour les entrées journal en attente
 * - Retry automatique avec backoff exponentiel (max 3 tentatives)
 * - Détection de connectivité (online/offline)
 * - Auto-flush au changement d'état (connexion/déconnexion)
 * - Logging pour suivi des entrées
 * - ⭐ Authentification JWT automatique
 * 
 * @author ARC-1 Architecture Team
 * @version 1.1.0
 */

import { useRef, useEffect, useCallback } from 'react';
import { getBackendUrl } from '../config/api.config';
import { useAuth } from '../contexts/AuthContext';
import { useSaveModeStore } from '../stores/useSaveModeStore';

export interface JournalQueueItem {
  id: string;
  workflowId: string;
  instanceId: string;
  type: 'chat' | 'error' | 'media' | 'tool_invocation';
  payload: any;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  nextRetryAt?: number;
}

interface QueueStats {
  totalQueued: number;
  totalFailed: number;
  totalSucceeded: number;
  currentQueue: JournalQueueItem[];
}

const INITIAL_RETRY_DELAY = 1000; // 1s
const MAX_RETRY_DELAY = 10000; // 10s
const MAX_RETRIES = 3;

export const useJournalQueue = () => {
  // ⭐ FIX: Récupérer le token d'authentification
  const { accessToken, isAuthenticated } = useAuth();
  const accessTokenRef = useRef(accessToken);
  
  // Mettre à jour la ref quand le token change
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);
  
  const queueRef = useRef<JournalQueueItem[]>([]);
  const statsRef = useRef<QueueStats>({
    totalQueued: 0,
    totalFailed: 0,
    totalSucceeded: 0,
    currentQueue: []
  });
  const processingRef = useRef(false);
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Ajouter une entrée à la queue
   * ⭐ FIX: Vérifier l'authentification ET le saveMode avant d'ajouter à la queue
   * En mode manuel, les journaux sont persistés via le bouton Save, pas automatiquement
   */
  const enqueueEntry = useCallback((
    workflowId: string,
    instanceId: string,
    type: 'chat' | 'error' | 'media' | 'tool_invocation',
    payload: any,
    forceImmediate: boolean = false // ⭐ NEW: Force l'envoi même en mode manuel (pour le bouton Save)
  ) => {
    // ⭐ FIX: Ne pas enregistrer si l'utilisateur n'est pas authentifié
    if (!accessTokenRef.current) {
      console.log(`[JournalQueue] Skipping ${type} entry - user not authenticated (guest mode)`);
      return;
    }
    
    // ⭐ FIX: En mode MANUEL, ne pas envoyer automatiquement (sauf si forcé par le bouton Save)
    const saveMode = useSaveModeStore.getState().saveMode;
    if (saveMode === 'manual' && !forceImmediate) {
      console.log(`[JournalQueue] Skipping ${type} entry - save mode is 'manual' (use Save button)`);
      return;
    }
    
    // Validation des paramètres requis
    if (!workflowId || !instanceId) {
      console.warn(`[JournalQueue] Skipping ${type} entry - missing workflowId or instanceId`);
      return;
    }
    
    const entry: JournalQueueItem = {
      id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      workflowId,
      instanceId,
      type,
      payload,
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      createdAt: Date.now()
    };

    queueRef.current.push(entry);
    statsRef.current.totalQueued++;
    statsRef.current.currentQueue = [...queueRef.current];

    console.log(`[JournalQueue] ✅ Enqueued ${type} entry (queue size: ${queueRef.current.length})`);

    // Déclencher le traitement
    flushQueue();
  }, []);

  /**
   * Persister une entrée unique
   * ⭐ FIX: Inclut le token d'authentification JWT
   */
  const persistEntry = async (entry: JournalQueueItem): Promise<boolean> => {
    try {
      const backendUrl = getBackendUrl();
      const url = `${backendUrl}/api/workflows/${entry.workflowId}/instances/${entry.instanceId}/journal`;
      
      // ⭐ FIX: Construire les headers avec authentification
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // Ajouter le token si disponible
      if (accessTokenRef.current) {
        headers['Authorization'] = `Bearer ${accessTokenRef.current}`;
      } else {
        console.warn('[JournalQueue] No access token available - request may fail with 401');
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: entry.type,
          payload: entry.payload
        })
      });

      if (!response.ok) {
        // ⭐ FIX: Gérer le cas où la réponse n'est pas du JSON valide
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
        }
        console.warn(`[JournalQueue] Persistence failed (${response.status}):`, errorData);
        return false;
      }

      const result = await response.json();
      if (result.skipped) {
        console.log(`[JournalQueue] Entry skipped: ${result.reason}`);
        return true; // Considérer comme succès (config désactivée)
      }

      console.log(`[JournalQueue] ✅ ${entry.type} entry persisted:`, result.journalId);
      return true;
    } catch (error) {
      console.error(`[JournalQueue] Persistence error:`, error);
      return false;
    }
  };

  /**
   * Calculer le délai de retry avec backoff exponentiel
   */
  const calculateRetryDelay = (retryCount: number): number => {
    const delay = Math.min(
      INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
      MAX_RETRY_DELAY
    );
    // Ajouter un jitter aléatoire (±20%) pour éviter les "thundering herds"
    const jitter = delay * (0.8 + Math.random() * 0.4);
    return Math.round(jitter);
  };

  /**
   * Traiter la queue
   */
  const flushQueue = useCallback(async () => {
    // Éviter les appels concurrents
    if (processingRef.current) {
      console.log('[JournalQueue] Already processing, skipping flush');
      return;
    }

    // Vérifier la connectivité
    if (!navigator.onLine) {
      console.log('[JournalQueue] Offline mode - queue paused');
      return;
    }

    processingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const entry = queueRef.current[0];

        // Vérifier si c'est temps de retrier
        if (entry.nextRetryAt && entry.nextRetryAt > Date.now()) {
          console.log(`[JournalQueue] Entry ${entry.id} not ready for retry yet`);
          break; // Sortir et attendre le prochain cycle
        }

        const success = await persistEntry(entry);

        if (success) {
          // Succès : enlever de la queue
          queueRef.current.shift();
          statsRef.current.totalSucceeded++;
          statsRef.current.currentQueue = [...queueRef.current];
        } else {
          // Échec : retry
          if (entry.retryCount < entry.maxRetries) {
            entry.retryCount++;
            entry.nextRetryAt = Date.now() + calculateRetryDelay(entry.retryCount);
            console.log(
              `[JournalQueue] Retry scheduled for entry ${entry.id} ` +
              `(attempt ${entry.retryCount}/${entry.maxRetries})`
            );
            break; // Attendre le prochain cycle
          } else {
            // Max retries atteint
            queueRef.current.shift();
            statsRef.current.totalFailed++;
            statsRef.current.currentQueue = [...queueRef.current];
            console.error(
              `[JournalQueue] ❌ Entry ${entry.id} discarded after ${entry.maxRetries} retries`
            );
          }
        }
      }
    } catch (error) {
      console.error('[JournalQueue] Fatal error during flush:', error);
    } finally {
      processingRef.current = false;

      // Programmer le prochain flush si la queue n'est pas vide
      if (queueRef.current.length > 0) {
        const nextEntry = queueRef.current[0];
        const delay = nextEntry.nextRetryAt 
          ? Math.max(0, nextEntry.nextRetryAt - Date.now())
          : 1000; // Default 1s

        if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = setTimeout(() => flushQueue(), delay);
      }
    }
  }, []);

  /**
   * Récupérer les stats de la queue
   */
  const getStats = useCallback((): QueueStats => {
    return { ...statsRef.current };
  }, []);

  /**
   * Vider complètement la queue (pour tests ou edge cases)
   */
  const clearQueue = useCallback(() => {
    queueRef.current = [];
    statsRef.current.currentQueue = [];
    console.log('[JournalQueue] Queue cleared');
  }, []);

  /**
   * Effet : détection de connectivité
   */
  useEffect(() => {
    const handleOnline = () => {
      console.log('[JournalQueue] Online - resuming flush');
      flushQueue();
    };

    const handleOffline = () => {
      console.log('[JournalQueue] Offline - pausing flush');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushQueue]);

  /**
   * Cleanup au démontage
   */
  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
    };
  }, []);

  return {
    enqueueEntry,
    flushQueue,
    getStats,
    clearQueue
  };
};

export default useJournalQueue;
