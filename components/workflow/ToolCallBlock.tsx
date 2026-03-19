/**
 * components/workflow/ToolCallBlock.tsx — J9
 *
 * Expandable display block for a single function invocation record.
 * Rendered inside V2AgentNode for messages with sender === 'tool'.
 *
 * Visual spec (collapsed):
 *   🔧 [functionName in cyan-400 bold]           [▼ Détails]
 *
 * Visual spec (expanded):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Input:                                     [📋 Copier]  │
 *   │  { "arg": "value" }                                     │
 *   │ Output:                       [✅ 234ms | ❌ Erreur]    │
 *   │  { "result": "..." }          [📋 Copier]               │
 *   └─────────────────────────────────────────────────────────┘
 */

import React, { useState, useCallback } from 'react';
import type { ToolCallRecord } from '../../types';
import type { FunctionArtifactPreview } from '../../types/function.types';
import apiClient from '../../utils/apiClient';

export interface ToolCallBlockProps {
    toolCall: ToolCallRecord;
    /** Start expanded (default: false — avoid visual overload). */
    defaultExpanded?: boolean;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface JsonPanelProps {
    label: string;
    data: unknown;
}

const JsonPanel: React.FC<JsonPanelProps> = ({ label, data }) => {
    const [copied, setCopied] = useState(false);

    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [text]);

    return (
        <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</span>
                <button
                    onClick={handleCopy}
                    title="Copier le JSON"
                    className="text-gray-500 hover:text-gray-300 transition-colors p-0.5 rounded"
                >
                    {copied
                        ? <span className="text-green-400 text-xs">✓ Copié</span>
                        : <span className="text-xs">📋</span>
                    }
                </button>
            </div>
            <pre className="text-xs bg-gray-900/60 text-gray-300 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-all border border-gray-700/50">
                {text}
            </pre>
        </div>
    );
};

// ─── Main component ──────────────────────────────────────────────────────────

export const ToolCallBlock: React.FC<ToolCallBlockProps> = ({
    toolCall,
    defaultExpanded = false,
}) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [artifactPreview, setArtifactPreview] = useState<FunctionArtifactPreview | null>(null);
    const [artifactPreviewLoading, setArtifactPreviewLoading] = useState(false);
    const [artifactPreviewError, setArtifactPreviewError] = useState<string | null>(null);

    const isSuccess = toolCall.status === 'success';
    const durationLabel = toolCall.durationMs != null ? `${toolCall.durationMs}ms` : null;
    const exitCodeLabel = toolCall.exitCode != null ? `exit ${toolCall.exitCode}` : null;

    const handlePreviewArtifact = useCallback(async (artifactPath: string) => {
        if (!toolCall.functionId || !toolCall.executionId) {
            setArtifactPreviewError('Aucun contexte d\'exécution disponible pour cet artefact.');
            return;
        }

        setArtifactPreviewLoading(true);
        setArtifactPreviewError(null);
        try {
            const { data } = await apiClient.get<FunctionArtifactPreview>(
                `/api/runs/tool/${toolCall.functionId}/${toolCall.executionId}/artifacts/content`,
                { params: { path: artifactPath } }
            );
            setArtifactPreview(data);
        } catch (error: any) {
            setArtifactPreview(null);
            setArtifactPreviewError(error.response?.data?.error || 'Impossible de charger l\'aperçu de l\'artefact.');
        } finally {
            setArtifactPreviewLoading(false);
        }
    }, [toolCall.executionId, toolCall.functionId]);

    const handleDownloadArtifact = useCallback(async (artifactPath: string) => {
        if (!toolCall.functionId || !toolCall.executionId) {
            setArtifactPreviewError('Aucun contexte d\'exécution disponible pour cet artefact.');
            return;
        }

        try {
            const response = await apiClient.get<Blob>(
                `/api/runs/tool/${toolCall.functionId}/${toolCall.executionId}/artifacts/download`,
                {
                    params: { path: artifactPath },
                    responseType: 'blob'
                }
            );

            const url = window.URL.createObjectURL(response.data);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = artifactPath.split('/').pop() || 'artifact';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(url);
        } catch (error: any) {
            setArtifactPreviewError(error.response?.data?.error || 'Impossible de télécharger l\'artefact.');
        }
    }, [toolCall.executionId, toolCall.functionId]);

    return (
        <div className="my-1 rounded bg-gray-800/70 border border-cyan-800/40 text-sm">
            {/* Header row */}
            <div className="flex items-center justify-between px-3 py-1.5 select-none">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-400 shrink-0">🔧</span>
                    <span className="font-mono font-bold text-cyan-400 truncate">
                        {toolCall.functionName}
                    </span>
                    <span className={`text-xs shrink-0 ${isSuccess ? 'text-green-400' : 'text-red-400'}`}>
                        {isSuccess ? '✅' : '❌'}
                    </span>
                    {durationLabel && (
                        <span className="text-gray-500 text-xs shrink-0">⏱ {durationLabel}</span>
                    )}
                    {toolCall.runner && (
                        <span className="text-gray-500 text-xs shrink-0">{toolCall.runner}</span>
                    )}
                    {exitCodeLabel && (
                        <span className="text-gray-500 text-xs shrink-0">{exitCodeLabel}</span>
                    )}
                </div>
                <button
                    onClick={() => setExpanded(prev => !prev)}
                    className="text-gray-400 hover:text-gray-200 transition-colors text-xs ml-2 shrink-0"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Réduire' : 'Développer'}
                >
                    {expanded ? '▲ Réduire' : '▼ Détails'}
                </button>
            </div>

            {/* Expandable body */}
            {expanded && (
                <div className="px-3 pb-3 border-t border-gray-700/50">
                    {(toolCall.executionId || toolCall.failureKind || (toolCall.artifacts?.length ?? 0) > 0) && (
                        <div className="mt-2 grid gap-1 text-xs text-gray-400">
                            {toolCall.executionId && <div>Execution: <span className="font-mono text-gray-300">{toolCall.executionId}</span></div>}
                            {toolCall.failureKind && <div>Failure kind: <span className="font-mono text-gray-300">{toolCall.failureKind}</span></div>}
                            {(toolCall.artifacts?.length ?? 0) > 0 && (
                                <div>
                                    <div className="mb-1">Artifacts</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {toolCall.artifacts?.map((artifact) => (
                                            <div key={artifact.path} className="flex items-center gap-1 rounded border border-cyan-500/20 bg-cyan-950/20 px-2 py-1 text-[11px] text-cyan-300">
                                                <button
                                                    onClick={() => handlePreviewArtifact(artifact.path)}
                                                    className="max-w-[12rem] truncate text-left hover:text-cyan-200"
                                                    title={artifact.path}
                                                    aria-label={`Prévisualiser ${artifact.path}`}
                                                >
                                                    {artifact.path}
                                                </button>
                                                <button
                                                    onClick={() => handleDownloadArtifact(artifact.path)}
                                                    className="text-cyan-400 hover:text-cyan-200"
                                                    title="Télécharger l'artefact"
                                                    aria-label={`Télécharger ${artifact.path}`}
                                                >
                                                    ↓
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {artifactPreviewLoading && (
                        <div className="mt-2 text-xs text-gray-400">Chargement de l'aperçu d'artefact...</div>
                    )}
                    {artifactPreviewError && (
                        <div className="mt-2 text-xs text-red-300">{artifactPreviewError}</div>
                    )}
                    {artifactPreview && !artifactPreviewLoading && (
                        <div className="mt-2 rounded border border-gray-700/50 bg-gray-900/60 p-2 text-xs text-gray-300">
                            <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                                <span className="truncate">{artifactPreview.artifact.path}</span>
                                <span>{artifactPreview.artifact.sizeBytes} B</span>
                            </div>
                            {artifactPreview.artifact.previewable ? (
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
                                    {typeof artifactPreview.artifact.jsonContent === 'undefined'
                                        ? artifactPreview.artifact.textContent
                                        : JSON.stringify(artifactPreview.artifact.jsonContent, null, 2)}
                                </pre>
                            ) : (
                                <div>Cet artefact n'est pas prévisualisable.</div>
                            )}
                        </div>
                    )}
                    <JsonPanel label="Input" data={toolCall.arguments} />
                    <JsonPanel label={`Output ${isSuccess ? '(succès)' : '(erreur)'}`} data={toolCall.result} />
                </div>
            )}
        </div>
    );
};

export default ToolCallBlock;
