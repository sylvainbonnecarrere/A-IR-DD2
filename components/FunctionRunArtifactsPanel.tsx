import React from 'react';
import type { FunctionArtifactPreview, FunctionRunRecord, FunctionRunSortField, FunctionRunSortOrder } from '../types/function.types';
import { getQaDiagnosticPresentation, getRunStatusFilterLabel, getRunStatusLabel } from '../utils/toolDiagnostics';

interface FunctionRunArtifactsPanelProps {
    runs: FunctionRunRecord[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        status?: FunctionRunRecord['status'];
        sortBy: FunctionRunSortField;
        sortOrder: FunctionRunSortOrder;
    };
    statusFilter: 'all' | FunctionRunRecord['status'];
    sortBy: FunctionRunSortField;
    sortOrder: FunctionRunSortOrder;
    isLoading: boolean;
    error: string | null;
    artifactPreview: FunctionArtifactPreview | null;
    isArtifactPreviewLoading: boolean;
    artifactPreviewError: string | null;
    onRefresh: () => void;
    onOpenArtifact: (executionId: string, artifactPath: string) => void;
    onDownloadArtifact: (executionId: string, artifactPath: string) => void;
    onStatusFilterChange: (status: 'all' | FunctionRunRecord['status']) => void;
    onSortByChange: (sortBy: FunctionRunSortField) => void;
    onSortOrderChange: (sortOrder: FunctionRunSortOrder) => void;
    onPageChange: (page: number) => void;
    onCleanupRuns: () => void;
}

function formatTimestamp(value?: string | null): string {
    if (!value) {
        return 'n/a';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

function renderArtifactPreview(preview: FunctionArtifactPreview | null) {
    if (!preview) {
        return (
            <div className="text-xs text-gray-600 italic">
                Sélectionnez un artefact pour afficher son aperçu.
            </div>
        );
    }

    const artifact = preview.artifact;
    const previewContent = artifact.jsonContent ?? artifact.textContent;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
                <span className="truncate">{artifact.path}</span>
                <span>{artifact.sizeBytes} B</span>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
                <span>{artifact.kind}</span>
                <span>{artifact.contentType}</span>
                {artifact.truncated && <span className="text-amber-300">preview tronqué</span>}
                {!artifact.previewable && <span className="text-amber-300">binaire/non prévisualisable</span>}
            </div>
            {artifact.previewable ? (
                <pre className="max-h-44 overflow-auto rounded border border-gray-700/50 bg-gray-950/70 p-2 text-[11px] text-gray-200 whitespace-pre-wrap break-words">
                    {typeof previewContent === 'string'
                        ? previewContent
                        : JSON.stringify(previewContent, null, 2)}
                </pre>
            ) : (
                <div className="rounded border border-gray-700/50 bg-gray-950/70 p-2 text-[11px] text-gray-400">
                    Cet artefact n'est pas prévisualisable dans l'éditeur. Utilisez le chemin enregistré pour le consulter côté workspace.
                </div>
            )}
        </div>
    );
}

export const FunctionRunArtifactsPanel: React.FC<FunctionRunArtifactsPanelProps> = ({
    runs,
    pagination,
    statusFilter,
    sortBy,
    sortOrder,
    isLoading,
    error,
    artifactPreview,
    isArtifactPreviewLoading,
    artifactPreviewError,
    onRefresh,
    onOpenArtifact,
    onDownloadArtifact,
    onStatusFilterChange,
    onSortByChange,
    onSortOrderChange,
    onPageChange,
    onCleanupRuns
}) => {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/40">
                <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-gray-400">Runs & Artifacts</div>
                    <div className="text-[11px] text-gray-500">Historique récent et aperçu des sorties de sandbox</div>
                </div>
                <button
                    onClick={onRefresh}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                    Rafraîchir
                </button>
            </div>

            <div className="grid grid-cols-2 gap-2 px-3 py-2 border-b border-gray-700/40 bg-gray-900/40">
                <select
                    aria-label="Filtrer les runs par statut"
                    value={statusFilter}
                    onChange={(event) => onStatusFilterChange(event.target.value as 'all' | FunctionRunRecord['status'])}
                    className="rounded border border-gray-700/60 bg-gray-950/70 px-2 py-1 text-[11px] text-gray-300 outline-none"
                >
                    <option value="all">{getRunStatusFilterLabel('all')}</option>
                    <option value="completed">{getRunStatusFilterLabel('completed')}</option>
                    <option value="failed">{getRunStatusFilterLabel('failed')}</option>
                    <option value="timed_out">{getRunStatusFilterLabel('timed_out')}</option>
                    <option value="running">{getRunStatusFilterLabel('running')}</option>
                    <option value="queued">{getRunStatusFilterLabel('queued')}</option>
                    <option value="stopped">{getRunStatusFilterLabel('stopped')}</option>
                </select>
                <select
                    aria-label="Trier les runs par"
                    value={sortBy}
                    onChange={(event) => onSortByChange(event.target.value as FunctionRunSortField)}
                    className="rounded border border-gray-700/60 bg-gray-950/70 px-2 py-1 text-[11px] text-gray-300 outline-none"
                >
                    <option value="createdAt">Trier par date</option>
                    <option value="durationMs">Trier par durée</option>
                    <option value="status">Trier par statut</option>
                </select>
                <select
                    aria-label="Ordre de tri des runs"
                    value={sortOrder}
                    onChange={(event) => onSortOrderChange(event.target.value as FunctionRunSortOrder)}
                    className="rounded border border-gray-700/60 bg-gray-950/70 px-2 py-1 text-[11px] text-gray-300 outline-none"
                >
                    <option value="desc">Ordre décroissant</option>
                    <option value="asc">Ordre croissant</option>
                </select>
                <button
                    onClick={onCleanupRuns}
                    className="rounded border border-amber-500/30 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-950/30"
                >
                    Nettoyer &gt;14j
                </button>
                <div className="col-span-2 text-[11px] text-gray-500">
                    {pagination.total} run{pagination.total > 1 ? 's' : ''} · page {pagination.page}/{pagination.totalPages} · {sortBy} {sortOrder}
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(170px,0.9fr)]">
                <div className="min-h-0 overflow-y-auto border-b border-gray-700/40">
                    {isLoading ? (
                        <div className="p-3 text-xs text-gray-400">Chargement des exécutions...</div>
                    ) : error ? (
                        <div className="p-3 text-xs text-red-300">{error}</div>
                    ) : runs.length === 0 ? (
                        <div className="p-3 text-xs text-gray-600 italic">Aucune exécution enregistrée pour cette fonction.</div>
                    ) : (
                        <div className="divide-y divide-gray-800/80">
                            {runs.map((run) => (
                                (() => {
                                    const diagnostic = run.error ? getQaDiagnosticPresentation(run.error) : null;
                                    return (
                                <div key={run.executionId} className="px-3 py-2 space-y-2">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className={`font-medium ${run.status === 'completed' ? 'text-green-400' : run.status === 'failed' || run.status === 'timed_out' ? 'text-red-300' : 'text-amber-300'}`}>
                                                    {getRunStatusLabel(run.status)}
                                                </span>
                                                <span className="text-gray-500">{run.runner}</span>
                                                {run.timing.durationMs != null && <span className="text-gray-500">{run.timing.durationMs}ms</span>}
                                            </div>
                                            <div className="mt-1 font-mono text-[11px] text-gray-500 truncate">{run.executionId}</div>
                                            <div className="mt-1 text-[11px] text-gray-500">{formatTimestamp(run.createdAt)}</div>
                                        </div>
                                        {run.error?.code && (
                                            <div className="text-right space-y-1">
                                                <span className="block text-[11px] text-red-300">{run.error.code}</span>
                                                {run.error.subsystem && (
                                                    <span className="block text-[11px] text-gray-500">{run.error.subsystem}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {run.error && (
                                        <div className="text-[11px] text-gray-400 space-y-1">
                                            {diagnostic && <div className="text-amber-200">Diagnostic QA: {diagnostic.label}</div>}
                                            <div className="text-red-200 whitespace-pre-wrap break-words">{run.error.message}</div>
                                            {diagnostic && <div className="text-cyan-200">Action recommandee: {diagnostic.recommendedAction}</div>}
                                            {(run.error.failureKind || typeof run.error.retryable === 'boolean') && (
                                                <div className="flex flex-wrap gap-3 text-gray-500">
                                                    {run.error.failureKind && <span>failure {run.error.failureKind}</span>}
                                                    {typeof run.error.retryable === 'boolean' && <span>{run.error.retryable ? 'retryable' : 'non retryable'}</span>}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {(run.outputs?.artifacts?.length ?? 0) > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {run.outputs?.artifacts?.map((artifact) => (
                                                <div
                                                    key={`${run.executionId}:${artifact.path}`}
                                                    className="flex items-center gap-1 rounded border border-cyan-500/20 bg-cyan-950/20 px-2 py-1 text-[11px] text-cyan-300"
                                                    title={artifact.path}
                                                >
                                                    <button
                                                        onClick={() => onOpenArtifact(run.executionId, artifact.path)}
                                                        className="max-w-[11rem] truncate text-left hover:text-cyan-200"
                                                        aria-label={`Prévisualiser ${artifact.path}`}
                                                    >
                                                        {artifact.path}
                                                    </button>
                                                    <button
                                                        onClick={() => onDownloadArtifact(run.executionId, artifact.path)}
                                                        className="text-cyan-400 hover:text-cyan-200"
                                                        title="Télécharger l'artefact"
                                                        aria-label={`Télécharger ${artifact.path}`}
                                                    >
                                                        ↓
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-[11px] text-gray-600 italic">Aucun artefact enregistré pour ce run.</div>
                                    )}
                                </div>
                                    );
                                })()
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-700/40 bg-gray-900/30 text-[11px] text-gray-400">
                    <button
                        onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
                        disabled={pagination.page <= 1}
                        className="rounded border border-gray-700/60 px-2 py-1 disabled:opacity-40"
                    >
                        Page précédente
                    </button>
                    <span>{pagination.page} / {pagination.totalPages}</span>
                    <button
                        onClick={() => onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
                        disabled={pagination.page >= pagination.totalPages}
                        className="rounded border border-gray-700/60 px-2 py-1 disabled:opacity-40"
                    >
                        Page suivante
                    </button>
                </div>

                <div className="min-h-0 overflow-y-auto px-3 py-2 bg-gray-950/50">
                    {isArtifactPreviewLoading ? (
                        <div className="text-xs text-gray-400">Chargement de l'aperçu d'artefact...</div>
                    ) : artifactPreviewError ? (
                        <div className="text-xs text-red-300">{artifactPreviewError}</div>
                    ) : renderArtifactPreview(artifactPreview)}
                </div>
            </div>
        </div>
    );
};

export default FunctionRunArtifactsPanel;