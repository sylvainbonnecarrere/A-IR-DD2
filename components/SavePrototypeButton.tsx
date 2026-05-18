/**
 * @file SavePrototypeButton.tsx
 * @description Bouton de sauvegarde manuelle du workflow ET des journaux
 * @domain Design Domain - Persistence UI
 * 
 * ⭐ ÉTAPE 2 PLAN_DE_PERSISTENCE: Save Mode MANUEL
 * ⭐ PHASE 3: Persistance des journaux (chat, erreurs, média)
 * 
 * DESIGN SPEC (BLUR GAME STYLE):
 * - Bouton ROND rouge
 * - Contour LASER BLEU (comme la MiniMap et la barre de zoom)
 * - PAS d'icône de disquette
 * - Position: à GAUCHE de la MiniMap, au-dessus des contrôles de zoom
 * - Hotkey: Ctrl+S
 * 
 * VISIBILITY RULES:
 * - Uniquement si isAuthenticated === true
 * - Uniquement si saveMode === 'manual'
 * 
 * STATES:
 * - idle: Bouton rouge avec contour bleu laser
 * - saving: Animation pulse pendant sauvegarde
 * - success: Flash vert pendant 1.5s
 * - error: Flash rouge vif pendant 2.5s
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility (trigger save only)
 * - O: Open for extension (callbacks, styling)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDesignStore } from '../stores/useDesignStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { PersistenceService } from '../services/persistenceService';
import { useSaveMode } from '../hooks/useSaveMode';
import { getBackendUrl } from '../config/api.config';
import { V2WorkflowNode, ChatMessage, PendingNodeAttachment } from '../types';

// ⭐ CONSTANTES DE CONFIGURATION - Anti-boucle infinie
const MAX_ERRORS_BEFORE_ABORT = 3;
const MAX_MESSAGES_PER_BATCH = 50;
const REQUEST_TIMEOUT_MS = 10000;

interface SavePrototypeButtonProps {
    /** Current workflow ID */
    workflowId?: string;
    /** Current canvas state */
    canvasState?: {
        zoom: number;
        panX: number;
        panY: number;
    };
    /** Workflow name (optional) */
    workflowName?: string;
    /** Callback on save complete */
    onSaveComplete?: (success: boolean) => void;
    /** Custom className */
    className?: string;
}

type ButtonState = 'idle' | 'saving' | 'success' | 'error';

// ⭐ MODULE-LEVEL: Set des messages déjà envoyés (persistant entre les re-renders)
const globalSentMessageIds = new Set<string>();

function resolveInlineMediaExtension(mimeType?: string): string {
    switch (mimeType?.toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/gif':
            return 'gif';
        case 'image/webp':
            return 'webp';
        case 'image/svg+xml':
            return 'svg';
        case 'application/pdf':
            return 'pdf';
        default:
            return 'bin';
    }
}

function resolveInlineMediaFileName(message: ChatMessage, messageId: string): string | undefined {
    const explicitFileName = typeof message.filename === 'string' ? message.filename.trim() : '';
    if (explicitFileName.length > 0) {
        return explicitFileName;
    }

    if (!message.image || !message.mimeType) {
        return undefined;
    }

    const messageSlug = messageId.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'inline-chat-media';
    return `chat-upload-${messageSlug}.${resolveInlineMediaExtension(message.mimeType)}`;
}

async function persistPendingDraftAttachment(params: {
    backendUrl: string;
    accessToken: string;
    workflowId: string;
    agentInstanceId: string;
    attachment: PendingNodeAttachment;
    signal: AbortSignal;
}) {
    return fetch(
        `${params.backendUrl}/api/workflows/${params.workflowId}/instances/${params.agentInstanceId}/imported-media`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${params.accessToken}`,
            },
            body: JSON.stringify({
                attachmentId: params.attachment.id,
                fileName: params.attachment.fileName,
                mimeType: params.attachment.mimeType,
                contentBase64: params.attachment.base64Content,
                origin: params.attachment.origin,
            }),
            signal: params.signal,
        }
    );
}

export const SavePrototypeButton: React.FC<SavePrototypeButtonProps> = ({
    workflowId,
    canvasState,
    workflowName,
    onSaveComplete,
    className = ''
}) => {
    const [buttonState, setButtonState] = useState<ButtonState>('idle');
    const { isAuthenticated, accessToken } = useAuth();
    const { nodes, edges } = useDesignStore();
    const {
        nodeMessages,
        nodePendingAttachments = {},
        getNewMessages,
        setLastSavedAt,
        updateNodePendingAttachment = () => undefined,
    } = useRuntimeStore();
    const { isManualSave } = useSaveMode();
    
    // ⭐ LOCK: Éviter les appels concurrents (ref stable au niveau composant)
    const isSavingRef = useRef(false);
    // ⭐ ABORT: Permettre l'annulation des requêtes en cours
    const abortControllerRef = useRef<AbortController | null>(null);

    // ⚠️ VISIBILITY GATE: Only render for authenticated users with manual save mode
    const shouldRender = isAuthenticated && isManualSave;
    const hasValidWorkflowId = !!workflowId && workflowId !== 'default-workflow';

    /**
     * ⭐ REFACTORED: Persister les journaux avec protections anti-boucle infinie
     * - Circuit breaker après MAX_ERRORS_BEFORE_ABORT erreurs
     * - Limite de MAX_MESSAGES_PER_BATCH messages par node
     * - Timeout de REQUEST_TIMEOUT_MS ms par requête
     * - Déduplication via globalSentMessageIds (persistant)
     */
    const persistJournals = useCallback(async (): Promise<{ saved: number; errors: number; aborted: boolean }> => {
        // ⭐ GUARD STRICT: Si déjà en cours, ne rien faire
        if (isSavingRef.current) {
            console.warn('[SavePrototypeButton] ⚠️ Already saving, skipping duplicate call');
            return { saved: 0, errors: 0, aborted: true };
        }
        
        isSavingRef.current = true;
        
        // ⭐ Créer un nouvel AbortController pour cette session
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;
        
        let saved = 0;
        let consecutiveErrors = 0;
        let totalErrors = 0;
        const backendUrl = getBackendUrl();

        try {
            // ⭐ SNAPSHOT IMMÉDIAT: Capturer l'état une seule fois
            const nodeMessagesSnapshot = JSON.parse(JSON.stringify(nodeMessages));
            const nodePendingAttachmentsSnapshot = { ...nodePendingAttachments } as Record<string, PendingNodeAttachment | null>;
            const nodesSnapshot = [...nodes];
            const nodeIds = new Set([
                ...Object.keys(nodeMessagesSnapshot),
                ...Object.keys(nodePendingAttachmentsSnapshot),
            ]);

            for (const nodeId of nodeIds) {
                // ⭐ CIRCUIT BREAKER: Arrêter si trop d'erreurs consécutives
                if (consecutiveErrors >= MAX_ERRORS_BEFORE_ABORT) {
                    console.error(`[SavePrototypeButton] 🛑 Aborting: ${MAX_ERRORS_BEFORE_ABORT} consecutive errors`);
                    break;
                }

                const messages = nodeMessagesSnapshot[nodeId] as ChatMessage[] | undefined;
                const pendingAttachment = nodePendingAttachmentsSnapshot[nodeId];

                if ((!messages || messages.length === 0) && !pendingAttachment) {
                    continue;
                }

                // Trouver le node pour les métadonnées
                const node = nodesSnapshot.find(n => n.id === nodeId) as V2WorkflowNode | undefined;
                const agentInstance = node?.data?.agentInstance;
                const effectiveWorkflowId = node?.data?.workflowId || workflowId;

                if (!agentInstance?.id || !effectiveWorkflowId) {
                    console.warn(`[SavePrototypeButton] Skipping node ${nodeId} - missing instance/workflow`);
                    continue;
                }

                // ⭐ DÉDUPLICATION STRICTE: Filtrer via globalSentMessageIds
                const allMessages = (messages || []) as ChatMessage[];
                const newMessages = allMessages.filter((msg: ChatMessage) => {
                    const msgId = msg.id || `${nodeId}-${msg.timestamp?.toString() || Date.now()}`;
                    return !globalSentMessageIds.has(msgId);
                });

                // ⭐ LIMITE PAR BATCH: Ne pas envoyer trop de messages d'un coup
                const messagesToSend = newMessages.slice(0, MAX_MESSAGES_PER_BATCH);

                if (messagesToSend.length > 0) {
                    console.log(`[SavePrototypeButton] 📤 Sending ${messagesToSend.length}/${newMessages.length} messages for instance ${agentInstance.id}`);
                }

                for (const message of messagesToSend) {
                    // ⭐ Vérifier si l'opération a été annulée
                    if (signal.aborted) {
                        console.warn('[SavePrototypeButton] Operation aborted');
                        return { saved, errors: totalErrors, aborted: true };
                    }

                    // ⭐ CIRCUIT BREAKER CHECK
                    if (consecutiveErrors >= MAX_ERRORS_BEFORE_ABORT) {
                        console.error(`[SavePrototypeButton] 🛑 Stopping batch: too many errors`);
                        break;
                    }

                    const msgId = message.id || `${nodeId}-${message.timestamp?.toString() || Date.now()}`;
                    
                    // ⭐ DOUBLE CHECK: Éviter les doublons en vérifiant juste avant l'envoi
                    if (globalSentMessageIds.has(msgId)) {
                        continue;
                    }

                    // ⭐ MARQUER IMMÉDIATEMENT comme en cours (avant l'envoi)
                    globalSentMessageIds.add(msgId);

                    try {
                        const resolvedFileName = resolveInlineMediaFileName(message, msgId);

                        // ⭐ TIMEOUT: Requête avec délai maximum
                        const timeoutId = setTimeout(() => {
                            abortControllerRef.current?.abort();
                        }, REQUEST_TIMEOUT_MS);

                        const response = await fetch(
                            `${backendUrl}/api/workflows/${effectiveWorkflowId}/instances/${agentInstance.id}/journal`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${accessToken}`
                                },
                                body: JSON.stringify({
                                    type: 'chat',
                                    payload: {
                                        role: message.sender === 'user' ? 'user' : 'agent',
                                        content: message.text || '',
                                        imageBase64: message.image,
                                        fileContent: message.fileContent,
                                        mimeType: message.mimeType,
                                        fileName: resolvedFileName,
                                        messageId: msgId
                                    }
                                }),
                                signal
                            }
                        );

                        clearTimeout(timeoutId);

                        if (response.ok) {
                            saved++;
                            consecutiveErrors = 0; // ⭐ Reset du circuit breaker
                        } else {
                            // ⭐ En cas d'erreur serveur, ne pas retirer du Set (éviter retry infini)
                            console.warn(`[SavePrototypeButton] Server error ${response.status} for message ${msgId}`);
                            consecutiveErrors++;
                            totalErrors++;
                        }
                    } catch (err) {
                        // ⭐ En cas d'erreur réseau, NE PAS retirer du Set pour éviter les retry infinis
                        console.error(`[SavePrototypeButton] Network error for message ${msgId}:`, err);
                        consecutiveErrors++;
                        totalErrors++;
                        
                        // ⭐ Si c'est une erreur d'abort, arrêter proprement
                        if (err instanceof Error && err.name === 'AbortError') {
                            console.warn('[SavePrototypeButton] Request aborted');
                            return { saved, errors: totalErrors, aborted: true };
                        }
                    }
                }

                if (pendingAttachment && !pendingAttachment.draftPersisted) {
                    try {
                        const timeoutId = setTimeout(() => {
                            abortControllerRef.current?.abort();
                        }, REQUEST_TIMEOUT_MS);

                        const response = await persistPendingDraftAttachment({
                            backendUrl,
                            accessToken: accessToken || '',
                            workflowId: effectiveWorkflowId,
                            agentInstanceId: agentInstance.id,
                            attachment: pendingAttachment,
                            signal,
                        });

                        clearTimeout(timeoutId);

                        if (response.ok) {
                            const responseBody = await response.json().catch(() => ({}));
                            if (responseBody?.success || responseBody?.skipped) {
                                updateNodePendingAttachment(nodeId, {
                                    draftPersisted: true,
                                    persistedAt: new Date(),
                                });
                                saved++;
                                consecutiveErrors = 0;
                            }
                        } else {
                            console.warn(`[SavePrototypeButton] Draft media server error ${response.status} for node ${nodeId}`);
                            consecutiveErrors++;
                            totalErrors++;
                        }
                    } catch (err) {
                        console.error(`[SavePrototypeButton] Draft media network error for node ${nodeId}:`, err);
                        consecutiveErrors++;
                        totalErrors++;

                        if (err instanceof Error && err.name === 'AbortError') {
                            console.warn('[SavePrototypeButton] Draft media request aborted');
                            return { saved, errors: totalErrors, aborted: true };
                        }
                    }
                }

                // ⭐ Marquer le timestamp seulement si on a réussi à sauvegarder quelque chose
                if (saved > 0) {
                    setLastSavedAt(nodeId, new Date());
                }
            }

            console.log(`[SavePrototypeButton] ✅ Complete: ${saved} saved, ${totalErrors} errors`);
        } finally {
            isSavingRef.current = false;
            abortControllerRef.current = null;
        }
        
        return { saved, errors: totalErrors, aborted: false };
    }, [nodeMessages, nodePendingAttachments, nodes, workflowId, accessToken, setLastSavedAt, updateNodePendingAttachment]);

    /**
     * Handle save action with strict single-execution guarantee
     */
    const handleSave = useCallback(async () => {
        // ⭐ TRIPLE GUARD: État UI + Ref + Render condition
        if (buttonState === 'saving' || isSavingRef.current || !shouldRender) {
            console.log('[SavePrototypeButton] Save blocked:', { buttonState, isSaving: isSavingRef.current, shouldRender });
            return;
        }

        if (!hasValidWorkflowId) {
            console.warn('[SavePrototypeButton] Manual save skipped: no valid workflow ID available yet');
            setButtonState('error');
            setTimeout(() => setButtonState('idle'), 2500);
            onSaveComplete?.(false);
            return;
        }

        setButtonState('saving');

        try {
            // 1. Sauvegarder le workflow (structure)
            const result = await PersistenceService.saveWorkflow(
                {
                    id: workflowId,
                    name: workflowName,
                    canvasState,
                    nodes: nodes.map(n => ({
                        id: n.id,
                        type: n.type,
                        position: n.position,
                        data: n.data as Record<string, any>
                    })),
                    edges: edges.map(e => ({
                        id: e.id,
                        source: e.source,
                        target: e.target,
                        type: e.type
                    }))
                },
                {
                    isAuthenticated,
                    accessToken: accessToken || undefined
                }
            );

            // 2. Sauvegarder les journaux
            const journalResult = await persistJournals();
            console.log(`[SavePrototypeButton] Workflow: ${result.success}, Journals: ${journalResult.saved} saved, ${journalResult.errors} errors`);

            if (result.success && !journalResult.aborted) {
                setButtonState('success');
                setTimeout(() => setButtonState('idle'), 1500);
                onSaveComplete?.(true);
            } else {
                console.error('[SavePrototypeButton] Save incomplete:', result.error || 'Journal errors');
                setButtonState('error');
                setTimeout(() => setButtonState('idle'), 2500);
                onSaveComplete?.(false);
            }
        } catch (err) {
            console.error('[SavePrototypeButton] Save error:', err);
            setButtonState('error');
            setTimeout(() => setButtonState('idle'), 2500);
            onSaveComplete?.(false);
        }
    }, [
        workflowId,
        workflowName,
        canvasState,
        nodes,
        edges,
        isAuthenticated,
        accessToken,
        persistJournals,
        buttonState,
        shouldRender,
        hasValidWorkflowId,
        onSaveComplete
    ]);

    /**
     * Keyboard shortcut: Ctrl+S (only when shouldRender)
     */
    useEffect(() => {
        if (!shouldRender) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSave, shouldRender]);

    // Don't render if conditions not met
    if (!shouldRender) return null;

    /**
     * Get button content based on state
     */
    const getContent = (): string => {
        switch (buttonState) {
            case 'saving':
                return '...';
            case 'success':
                return '✓';
            case 'error':
                return '✗';
            default:
                return 'S'; // S for Save - no floppy icon
        }
    };

    return (
        <>
            {/* CSS Animation keyframes - Blur Game Style avec couleur CYAN (#00ffff) */}
            <style>{`
                @keyframes save-button-pulse {
                    0%, 100% {
                        box-shadow: 
                            0 0 8px rgba(0, 255, 255, 0.6),
                            0 0 20px rgba(0, 255, 255, 0.3),
                            inset 0 0 0 2px rgba(0, 255, 255, 0.8);
                    }
                    50% {
                        box-shadow: 
                            0 0 15px rgba(0, 255, 255, 0.9),
                            0 0 35px rgba(0, 255, 255, 0.5),
                            inset 0 0 0 2px rgba(0, 255, 255, 1);
                    }
                }
                
                @keyframes save-button-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                
                .save-round-button {
                    /* Base: Round shape */
                    width: 42px;
                    height: 42px;
                    border-radius: 50%;
                    border: 2px solid #00ffff; /* Contour CYAN comme la minimap */
                    cursor: pointer;
                    font-family: 'Orbitron', 'Rajdhani', monospace;
                    font-weight: 700;
                    font-size: 16px;
                    text-transform: uppercase;
                    transition: all 0.2s ease;
                    position: relative;
                    overflow: hidden;
                    
                    /* BLUR GAME STYLE: Red center + CYAN laser contour */
                    background: linear-gradient(145deg, #dc2626, #991b1b);
                    color: white;
                    box-shadow: 
                        0 0 8px rgba(0, 255, 255, 0.6),
                        0 0 20px rgba(0, 255, 255, 0.3),
                        inset 0 2px 0 rgba(255, 255, 255, 0.15),
                        0 4px 12px rgba(0, 0, 0, 0.4);
                }
                
                .save-round-button:hover:not(:disabled) {
                    transform: scale(1.08);
                    background: linear-gradient(145deg, #ef4444, #b91c1c);
                    border-color: #00ffff;
                    box-shadow: 
                        0 0 15px rgba(0, 255, 255, 0.9),
                        0 0 35px rgba(0, 255, 255, 0.5),
                        inset 0 2px 0 rgba(255, 255, 255, 0.2),
                        0 6px 16px rgba(0, 0, 0, 0.5);
                }
                
                .save-round-button:active:not(:disabled) {
                    transform: scale(0.95);
                }
                
                .save-round-button:disabled {
                    cursor: wait;
                }
                
                /* STATE: Saving */
                .save-round-button.saving {
                    animation: save-button-pulse 0.8s infinite ease-in-out;
                    background: linear-gradient(145deg, #facc15, #ca8a04);
                    color: #1a1a1a;
                }
                
                /* STATE: Success */
                .save-round-button.success {
                    background: linear-gradient(145deg, #22c55e, #16a34a);
                    border-color: #22c55e;
                    box-shadow: 
                        0 0 15px rgba(34, 197, 94, 0.8),
                        0 0 35px rgba(34, 197, 94, 0.4),
                        0 4px 12px rgba(0, 0, 0, 0.4);
                }
                
                /* STATE: Error */
                .save-round-button.error {
                    background: linear-gradient(145deg, #ef4444, #dc2626);
                    border-color: #ef4444;
                    box-shadow: 
                        0 0 15px rgba(239, 68, 68, 0.8),
                        0 0 35px rgba(239, 68, 68, 0.4),
                        0 4px 12px rgba(0, 0, 0, 0.4);
                    animation: shake 0.3s ease;
                }
                
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-3px); }
                    75% { transform: translateX(3px); }
                }
            `}</style>
            
            <button
                className={`save-round-button ${buttonState} ${className}`}
                onClick={handleSave}
                disabled={buttonState === 'saving'}
                title="Sauvegarder le workflow (Ctrl+S)"
                aria-label="Save prototype workflow"
            >
                {getContent()}
            </button>
        </>
    );
};

export default SavePrototypeButton;
