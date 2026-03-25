/**
 * FunctionEditorTab — Éditeur Monaco + SandboxConsole (J4)
 *
 * Fonctionnalités :
 *   - Éditeur Monaco avec langage Python ou TypeScript
 *   - Vérification syntaxique en temps réel (debounce 800ms)
 *   - Exécution de test via la façade frontend hybridée J9
 *   - Console d'affichage des résultats (stdout/stderr/output)
 *   - Sauvegarde du code inline via la façade frontend legacy->target
 *   - CodingAgentPanel (prompt → génération LLM de code) — placeholder J8
 *
 * Couleur Phil : cyan-500
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { OnChange, OnMount } from '@monaco-editor/react';
import { FunctionRunArtifactsPanel } from './FunctionRunArtifactsPanel';
import { toolRepository } from '../services/toolRepository';

// C8: Définitions de types FunctionContext injectées dans Monaco TypeScript
const FUNCTION_CONTEXT_TYPES = `
declare interface FunctionContext {
  userId: string;
  agentId?: string;
  workflowId?: string;
  depth: number;
  maxDepth: number;
  sessionId?: string;
}
declare type FunctionResult = unknown;
`;
import { useFunctionStore } from '../stores/useFunctionStore';
import { useNotifications } from '../contexts/NotificationContext';
import type { BuildPreparationResult, RuntimeHealthReport, SandboxRunResult, FunctionRunSortField, FunctionRunSortOrder } from '../types/function.types';

const RUN_RETENTION_DAYS = 14;
const RUN_RETAIN_LATEST = 20;

// ─── SandboxConsole ────────────────────────────────────────────────────────────
interface SandboxConsoleProps {
    result: SandboxRunResult | null;
    isRunning: boolean;
    error: string | null;
}

const SandboxConsole: React.FC<SandboxConsoleProps> = ({ result, isRunning, error }) => {
    const failureKindLabel = result?.metadata?.failureKind
        ? result.metadata.failureKind.replace(/_/g, ' ')
        : null;

    if (isRunning) {
        return (
            <div className="flex items-center gap-2 text-cyan-400 text-xs p-3">
                <div className="w-3 h-3 border border-cyan-500/40 border-t-cyan-400 rounded-full animate-spin" />
                Exécution en cours...
            </div>
        );
    }

    if (!result && !error) {
        return (
            <div className="text-gray-600 text-xs p-3 italic">
                Aucune exécution — cliquez sur ▶ Exécuter pour tester
            </div>
        );
    }

    return (
        <div className="text-xs font-mono">
            {/* Méta */}
            {result && (
                <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-700/40 text-gray-500">
                    <span className={result.success ? 'text-green-400' : 'text-red-400'}>
                        {result.success ? '✓ Succès' : '✗ Échec'}
                    </span>
                    <span>{result.durationMs}ms</span>
                    {result.runner && <span>{result.runner}</span>}
                    {typeof result.exitCode === 'number' && <span>exit {result.exitCode}</span>}
                    {result.timedOut && <span className="text-yellow-400">⏱ Timeout</span>}
                    {result.executionId && <span className="font-mono text-[11px] truncate">{result.executionId}</span>}
                </div>
            )}

            {(result?.resourceUsage?.wallTimeMs != null || result?.resourceUsage?.memoryLimitMb != null || failureKindLabel) && (
                <div className="px-3 py-2 border-b border-gray-700/40 text-[11px] text-gray-400 flex flex-wrap gap-3">
                    {result?.resourceUsage?.wallTimeMs != null && <span>wall {result.resourceUsage.wallTimeMs}ms</span>}
                    {result?.resourceUsage?.memoryLimitMb != null && <span>mem limit {result.resourceUsage.memoryLimitMb}MB</span>}
                    {failureKindLabel && <span>failure {failureKindLabel}</span>}
                </div>
            )}

            {/* Output JSON */}
            {result?.success && result.output !== null && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">Résultat</div>
                    <pre className="text-green-300 overflow-x-auto whitespace-pre-wrap break-words">
                        {JSON.stringify(result.output, null, 2)}
                    </pre>
                </div>
            )}

            {result?.stdout && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">Stdout</div>
                    <pre className="text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">
                        {result.stdout}
                    </pre>
                </div>
            )}

            {/* Stderr / Error */}
            {(result?.stderr || error) && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">Erreur</div>
                    <pre className="text-red-300 overflow-x-auto whitespace-pre-wrap break-words">
                        {result?.stderr || error}
                    </pre>
                </div>
            )}

            {(result?.metadata?.artifacts?.length ?? 0) > 0 && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">Artifacts</div>
                    <div className="space-y-1">
                        {result?.metadata?.artifacts?.map((artifact) => (
                            <div key={artifact.path} className="flex items-center justify-between gap-2 text-gray-300">
                                <span className="truncate">{artifact.path}</span>
                                <span className="text-[11px] uppercase tracking-wide text-gray-500">{artifact.kind}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

interface BuildStatusPanelProps {
    result: BuildPreparationResult | null;
    isBuilding: boolean;
    error: string | null;
}

const BuildStatusPanel: React.FC<BuildStatusPanelProps> = ({ result, isBuilding, error }) => {
    if (isBuilding) {
        return (
            <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-amber-300 flex items-center gap-2">
                <div className="w-3 h-3 border border-amber-500/40 border-t-amber-300 rounded-full animate-spin" />
                Préparation du build en cours...
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-red-300">
                {error}
            </div>
        );
    }

    if (!result) {
        return null;
    }

    return (
        <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-gray-300 space-y-1">
            <div className="flex items-center justify-between gap-2">
                <span className="text-green-300">Build prêt</span>
                <span className="text-gray-500">{new Date(result.builtAt).toLocaleString()}</span>
            </div>
            <div className="text-gray-500 truncate">Artefacts: {result.artifactPaths.length}</div>
            {result.warnings.length > 0 && (
                <div className="text-amber-300 whitespace-pre-wrap">{result.warnings.join('\n')}</div>
            )}
        </div>
    );
};

interface RuntimeStatusBannerProps {
    runtimeHealth: RuntimeHealthReport | null;
    isLoading: boolean;
    error: string | null;
    language: 'python' | 'typescript';
}

const RuntimeStatusBanner: React.FC<RuntimeStatusBannerProps> = ({ runtimeHealth, isLoading, error, language }) => {
    if (isLoading && !runtimeHealth) {
        return (
            <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-gray-400 flex items-center gap-2">
                <div className="w-3 h-3 border border-gray-500/40 border-t-cyan-400 rounded-full animate-spin" />
                Vérification du runtime d'exécution...
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-red-300">
                {error}
            </div>
        );
    }

    if (!runtimeHealth) {
        return null;
    }

    const canRun = runtimeHealth.capabilities.run[language];
    const isDevOnly = runtimeHealth.runtime.docker.securityLevel === 'dev-only';
    const dockerMode = runtimeHealth.runtime.docker.mode;
    const modeDetail = dockerMode === 'docker-desktop'
        ? 'Docker Desktop · dev-only (dev/test)'
        : dockerMode === 'rootless'
            ? 'Docker rootless'
            : dockerMode === 'rootful-linux'
                ? 'Docker rootful · dev-only (dev/test)'
                : 'mode non confirmé';
    if (canRun) {
        return (
            <div className={`px-3 py-2 border-b border-gray-700/40 text-xs ${isDevOnly ? 'text-amber-300' : 'text-emerald-300'}`}>
                Runtime {language === 'python' ? 'Python' : 'TypeScript'} prêt pour l'exécution via {modeDetail}.
                {runtimeHealth.runtime.docker.warning && (
                    <span className="text-gray-400"> {runtimeHealth.runtime.docker.warning}</span>
                )}
            </div>
        );
    }

    return (
        <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-amber-300">
            Exécution bloquée : {runtimeHealth.summary}
        </div>
    );
};

// ─── TestArgsEditor ────────────────────────────────────────────────────────────
interface TestArgsEditorProps {
    value: string;
    onChange: (v: string) => void;
    isValid: boolean;
}

const TestArgsEditor: React.FC<TestArgsEditorProps> = ({ value, onChange, isValid }) => (
    <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
            Arguments de test <span className="text-gray-600">(JSON)</span>
        </label>
        <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            rows={4}
            spellCheck={false}
            className={`w-full px-3 py-2 bg-gray-900/80 border rounded-lg text-xs font-mono text-gray-300 
                focus:outline-none resize-none transition-colors ${
                isValid ? 'border-gray-600/50 focus:border-cyan-500/40' : 'border-red-500/50'
            }`}
            placeholder='{"param1": "valeur", "param2": 42}'
        />
        {!isValid && (
            <p className="text-red-400 text-xs mt-1">JSON invalide</p>
        )}
    </div>
);

// ─── FunctionEditorTab ─────────────────────────────────────────────────────────
export const FunctionEditorTab: React.FC = () => {
    const {
        getSelectedFunction,
        updateFunction,
        updateInlineCodeOptimistic,
        runInSandbox,
        checkSyntax,
        clearSandboxResult,
        loadFunctionRuns,
        loadArtifactPreview,
        cleanupFunctionRuns,
        clearArtifactPreview,
        runBuild,
        loadBuildStatus,
        clearBuildResult,
        sandboxResult,
        isSandboxRunning,
        sandboxError,
        functionRuns,
        functionRunsPagination,
        isFunctionRunsLoading,
        functionRunsError,
        artifactPreview,
        isArtifactPreviewLoading,
        artifactPreviewError,
        buildResult,
        isBuilding,
        buildError,
        runtimeHealth,
        isRuntimeHealthLoading,
        runtimeHealthError,
        loadRuntimeHealth,
    } = useFunctionStore();

    const { addNotification } = useNotifications();
    const fn = getSelectedFunction();
    const resolvedToolId = fn?.toolId ?? fn?._id;
    const isWorkflowScopedFunction = Boolean(fn?.workflowId);

    const [code, setCode] = useState<string>('');
    const [testArgsStr, setTestArgsStr] = useState<string>('{}');
    const [testArgsValid, setTestArgsValid] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [syntaxErrors, setSyntaxErrors] = useState<Array<{ line?: number; message: string }>>([]);
    const [isConsolePanelOpen, setIsConsolePanelOpen] = useState(true);
    const [runPage, setRunPage] = useState(1);
    const [runStatusFilter, setRunStatusFilter] = useState<'all' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out'>('all');
    const [runSortBy, setRunSortBy] = useState<FunctionRunSortField>('createdAt');
    const [runSortOrder, setRunSortOrder] = useState<FunctionRunSortOrder>('desc');
    const syntaxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // C8: Injection des types FunctionContext dans Monaco TypeScript (onMount)
    const handleEditorMount: OnMount = useCallback((_editor, monaco) => {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
            FUNCTION_CONTEXT_TYPES,
            'file:///function-context.d.ts'
        );
    }, []);

    // ─── Schémas I/O ───────────────────────────────────────────────────────────
    const [showSchemas, setShowSchemas] = useState(false);
    const [inputSchemaStr, setInputSchemaStr] = useState('{}');
    const [outputSchemaStr, setOutputSchemaStr] = useState('{}');
    const [isSavingSchemas, setIsSavingSchemas] = useState(false);

    // Charger le code de la fonction sélectionnée
    useEffect(() => {
        if (fn?.codeInline != null) {
            setCode(fn.codeInline);
        } else {
            setCode('');
        }
        clearSandboxResult();
        clearBuildResult();
        clearArtifactPreview();
        setSyntaxErrors([]);
        // Synchroniser les schémas
        setInputSchemaStr(fn?.inputSchema && Object.keys(fn.inputSchema).length > 0
            ? JSON.stringify(fn.inputSchema, null, 2)
            : '{}');
        setOutputSchemaStr(fn?.outputSchema && Object.keys(fn.outputSchema).length > 0
            ? JSON.stringify(fn.outputSchema, null, 2)
            : '{}');
        setRunPage(1);
        setRunStatusFilter('all');
        setRunSortBy('createdAt');
        setRunSortOrder('desc');
        if (resolvedToolId && isWorkflowScopedFunction) {
            void loadBuildStatus(resolvedToolId);
        }
        if (resolvedToolId) {
            void loadFunctionRuns(resolvedToolId, { page: 1, limit: functionRunsPagination.limit, sortBy: 'createdAt', sortOrder: 'desc' });
        }
        void loadRuntimeHealth();
    }, [resolvedToolId, isWorkflowScopedFunction]);

    useEffect(() => {
        if (resolvedToolId && sandboxResult?.executionId) {
            void loadFunctionRuns(resolvedToolId, {
                page: runPage,
                limit: functionRunsPagination.limit,
                status: runStatusFilter === 'all' ? undefined : runStatusFilter,
                sortBy: runSortBy,
                sortOrder: runSortOrder
            });
        }
    }, [resolvedToolId, sandboxResult?.executionId, runPage, runStatusFilter, runSortBy, runSortOrder, functionRunsPagination.limit]);

    // Vérification syntaxique en temps réel (debounce 800ms)
    const handleCodeChange: OnChange = useCallback((value) => {
        const newCode = value ?? '';
        setCode(newCode);
        updateInlineCodeOptimistic(fn?._id ?? '', newCode);

        if (syntaxDebounceRef.current) clearTimeout(syntaxDebounceRef.current);

        syntaxDebounceRef.current = setTimeout(async () => {
            if (!fn) return;
            const result = await checkSyntax(fn.language, newCode);
            if (result) {
                setSyntaxErrors(result.errors);
            }
        }, 800);
    }, [fn, checkSyntax, updateInlineCodeOptimistic]);

    // Sauvegarder le code
    const handleSave = async () => {
        if (!fn || fn.isReadonly) return;
        setIsSaving(true);
        const updated = await updateFunction(fn._id, { codeInline: code });
        setIsSaving(false);
        if (updated) {
            addNotification({ type: 'success', title: 'Sauvegardé', message: `"${fn.name}" sauvegardée.` });
        }
    };

    // Sauvegarder les schémas I/O
    const handleSaveSchemas = async () => {
        if (!fn || fn.isReadonly) return;
        let inputSchema: Record<string, unknown>;
        let outputSchema: Record<string, unknown>;
        try {
            inputSchema = JSON.parse(inputSchemaStr);
        } catch {
            addNotification({ type: 'error', title: 'Input Schema invalide', message: 'JSON malformé dans le schéma d\'entrée.' });
            return;
        }
        try {
            outputSchema = JSON.parse(outputSchemaStr);
        } catch {
            addNotification({ type: 'error', title: 'Output Schema invalide', message: 'JSON malformé dans le schéma de sortie.' });
            return;
        }
        setIsSavingSchemas(true);
        await updateFunction(fn._id, { inputSchema, outputSchema });
        setIsSavingSchemas(false);
        addNotification({ type: 'success', title: 'Schémas sauvegardés', message: `Schémas de "${fn.name}" mis à jour.` });
    };

    // Exécuter dans le sandbox
    const handleRun = async () => {
        if (!fn) return;

        if (!runtimeHealth?.capabilities.run[fn.language]) {
            addNotification({
                type: 'error',
                title: 'Runtime non prêt',
                message: runtimeHealth?.summary || 'Le runtime d\'exécution n\'est pas prêt.'
            });
            return;
        }

        let testArgs: Record<string, unknown> = {};
        try {
            testArgs = JSON.parse(testArgsStr);
            setTestArgsValid(true);
        } catch {
            setTestArgsValid(false);
            addNotification({ type: 'error', title: 'JSON invalide', message: 'Corrigez les arguments de test.' });
            return;
        }

        // Sauvegarder d'abord si non readonly
        if (!fn.isReadonly && code !== fn.codeInline) {
            await updateFunction(fn._id, { codeInline: code });
        }

        await runInSandbox(fn._id, testArgs);
    };

    const handleBuild = async () => {
        if (!fn || fn.isReadonly) return;

        if (!isWorkflowScopedFunction) {
            clearBuildResult();
            addNotification({
                type: 'info',
                title: 'Build indisponible',
                message: 'Le build est disponible uniquement pour les fonctions custom rattachées à un workflow à ce stade.'
            });
            return;
        }

        if (code !== fn.codeInline) {
            const updated = await updateFunction(fn._id, { codeInline: code });
            if (!updated) {
                addNotification({ type: 'error', title: 'Build annulé', message: 'La sauvegarde du code a échoué avant la préparation du build.' });
                return;
            }
        }

        const result = await runBuild(resolvedToolId ?? fn._id);
        if (result) {
            addNotification({ type: 'success', title: 'Build prêt', message: `Artefacts préparés pour "${fn.name}".` });
        }
    };

    // Valider le JSON des args en temps réel
    const handleTestArgsChange = (value: string) => {
        setTestArgsStr(value);
        try {
            JSON.parse(value);
            setTestArgsValid(true);
        } catch {
            setTestArgsValid(false);
        }
    };

    const handleRefreshRuns = useCallback(() => {
        if (resolvedToolId) {
            void loadFunctionRuns(resolvedToolId, {
                page: runPage,
                limit: functionRunsPagination.limit,
                status: runStatusFilter === 'all' ? undefined : runStatusFilter,
                sortBy: runSortBy,
                sortOrder: runSortOrder
            });
        }
    }, [resolvedToolId, loadFunctionRuns, runPage, runStatusFilter, runSortBy, runSortOrder, functionRunsPagination.limit]);

    const handleOpenArtifact = useCallback((executionId: string, artifactPath: string) => {
        if (resolvedToolId) {
            void loadArtifactPreview(resolvedToolId, executionId, artifactPath);
        }
    }, [resolvedToolId, loadArtifactPreview]);

    const handleDownloadArtifact = useCallback(async (executionId: string, artifactPath: string) => {
        if (!resolvedToolId) {
            return;
        }

        try {
            const response = await toolRepository.downloadArtifact(resolvedToolId, executionId, artifactPath);

            const url = window.URL.createObjectURL(response.data);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = artifactPath.split('/').pop() || 'artifact';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(url);
        } catch (error: any) {
            addNotification({
                type: 'error',
                title: 'Téléchargement impossible',
                message: error.response?.data?.error || `Impossible de télécharger ${artifactPath}.`
            });
        }
    }, [resolvedToolId, addNotification]);

    const handleChangeRunPage = useCallback((page: number) => {
        setRunPage(page);
        if (resolvedToolId) {
            void loadFunctionRuns(resolvedToolId, {
                page,
                limit: functionRunsPagination.limit,
                status: runStatusFilter === 'all' ? undefined : runStatusFilter,
                sortBy: runSortBy,
                sortOrder: runSortOrder
            });
        }
    }, [resolvedToolId, loadFunctionRuns, functionRunsPagination.limit, runStatusFilter, runSortBy, runSortOrder]);

    const handleChangeRunStatusFilter = useCallback((status: 'all' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out') => {
        setRunStatusFilter(status);
        setRunPage(1);
        if (resolvedToolId) {
            void loadFunctionRuns(resolvedToolId, {
                page: 1,
                limit: functionRunsPagination.limit,
                status: status === 'all' ? undefined : status,
                sortBy: runSortBy,
                sortOrder: runSortOrder
            });
        }
    }, [resolvedToolId, loadFunctionRuns, functionRunsPagination.limit, runSortBy, runSortOrder]);

    const handleChangeRunSortBy = useCallback((sortBy: FunctionRunSortField) => {
        setRunSortBy(sortBy);
        setRunPage(1);
        if (resolvedToolId) {
            void loadFunctionRuns(resolvedToolId, {
                page: 1,
                limit: functionRunsPagination.limit,
                status: runStatusFilter === 'all' ? undefined : runStatusFilter,
                sortBy,
                sortOrder: runSortOrder
            });
        }
    }, [resolvedToolId, loadFunctionRuns, functionRunsPagination.limit, runStatusFilter, runSortOrder]);

    const handleChangeRunSortOrder = useCallback((sortOrder: FunctionRunSortOrder) => {
        setRunSortOrder(sortOrder);
        setRunPage(1);
        if (resolvedToolId) {
            void loadFunctionRuns(resolvedToolId, {
                page: 1,
                limit: functionRunsPagination.limit,
                status: runStatusFilter === 'all' ? undefined : runStatusFilter,
                sortBy: runSortBy,
                sortOrder
            });
        }
    }, [resolvedToolId, loadFunctionRuns, functionRunsPagination.limit, runStatusFilter, runSortBy]);

    const handleCleanupRuns = useCallback(async () => {
        if (!resolvedToolId) {
            return;
        }

        const confirmed = window.confirm(`Supprimer les runs de plus de ${RUN_RETENTION_DAYS} jours en conservant les ${RUN_RETAIN_LATEST} plus récents ?`);
        if (!confirmed) {
            return;
        }

        const result = await cleanupFunctionRuns(resolvedToolId, {
            retentionDays: RUN_RETENTION_DAYS,
            retainLatest: RUN_RETAIN_LATEST
        });

        if (!result) {
            addNotification({
                type: 'error',
                title: 'Nettoyage impossible',
                message: 'Le nettoyage des runs a échoué.'
            });
            return;
        }

        addNotification({
            type: 'success',
            title: 'Nettoyage terminé',
            message: `${result.deletedRuns} run(s) supprimé(s), ${result.deletedArtifacts.length} artefact(s) nettoyé(s).`
        });

        void loadFunctionRuns(resolvedToolId, {
            page: 1,
            limit: functionRunsPagination.limit,
            status: runStatusFilter === 'all' ? undefined : runStatusFilter,
            sortBy: runSortBy,
            sortOrder: runSortOrder
        });
        setRunPage(1);
    }, [resolvedToolId, cleanupFunctionRuns, addNotification, loadFunctionRuns, functionRunsPagination.limit, runStatusFilter, runSortBy, runSortOrder]);

    // Pas de fonction sélectionnée
    if (!fn) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2 p-8">
                <svg className="w-10 h-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <p className="text-sm text-center">Sélectionnez une fonction dans la Bibliothèque</p>
            </div>
        );
    }

    const monacoLanguage = fn.language === 'python' ? 'python' : 'typescript';
    const runDisabled = isSandboxRunning || isRuntimeHealthLoading || !runtimeHealth?.capabilities.run[fn.language];
    const runDisabledReason = runtimeHealthError
        || runtimeHealth?.summary
        || 'Le runtime d\'exécution n\'est pas encore prêt.';
    const buildDisabled = isBuilding || !isWorkflowScopedFunction;
    const buildDisabledReason = !isWorkflowScopedFunction
        ? 'Le build est réservé aux fonctions custom rattachées à un workflow.'
        : undefined;

    return (
        <div className="h-full flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/50 flex-shrink-0 bg-gray-900/80">
                {/* Nom + langage */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                        fn.language === 'python' ? 'bg-blue-900/60 text-blue-300' : 'bg-yellow-900/60 text-yellow-300'
                    }`}>
                        {fn.language === 'python' ? 'PY' : 'TS'}
                    </span>
                    <span className="font-mono text-sm text-gray-200 truncate">{fn.name}</span>
                    {fn.isReadonly && (
                        <span className="text-xs text-gray-500 flex-shrink-0">🔒 lecture seule</span>
                    )}
                </div>

                {/* Erreurs syntaxe */}
                {syntaxErrors.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-red-400 flex-shrink-0">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {syntaxErrors.length} erreur{syntaxErrors.length > 1 ? 's' : ''}
                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {!fn.isReadonly && (
                        <button
                            onClick={handleBuild}
                            disabled={buildDisabled}
                            title={buildDisabled ? buildDisabledReason : undefined}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isBuilding ? (
                                <div className="w-3 h-3 border border-amber-400/40 border-t-amber-300 rounded-full animate-spin" />
                            ) : (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M8 12l4 4m0 0l4-4m-4 4V4" />
                                </svg>
                            )}
                            Préparer build
                        </button>
                    )}

                    {!fn.isReadonly && (
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isSaving ? (
                                <div className="w-3 h-3 border border-gray-400/40 border-t-gray-300 rounded-full animate-spin" />
                            ) : (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                </svg>
                            )}
                            Sauvegarder
                        </button>
                    )}

                    <button
                        onClick={handleRun}
                        disabled={runDisabled}
                        title={runDisabled ? runDisabledReason : undefined}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-gray-900 font-semibold text-xs rounded-lg transition-colors"
                    >
                        {isSandboxRunning ? (
                            <div className="w-3 h-3 border-2 border-gray-900/40 border-t-gray-900 rounded-full animate-spin" />
                        ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                            </svg>
                        )}
                        Exécuter
                    </button>
                </div>
            </div>

            {/* Split: Editor (gauche) + Console + Args (droite) */}
            <div className="flex-1 flex overflow-hidden">
                {/* Monaco Editor */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {/* C8: Bannière d'aide signature TypeScript */}
                    {fn.language === 'typescript' && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-950/40 border-b border-blue-800/30 flex-shrink-0">
                            <span className="font-mono text-[11px] text-blue-300/90 truncate">
                                {'export function run(context: FunctionContext, args: { [key: string]: unknown }): unknown'}
                            </span>
                            <span className="text-[11px] text-blue-400/60 flex-shrink-0">
                                — accès via <code className="bg-blue-900/40 px-1 rounded">args.param_name</code>
                            </span>
                        </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                        <Editor
                            height="100%"
                            language={monacoLanguage}
                            value={code}
                            onChange={handleCodeChange}
                            onMount={handleEditorMount}
                            theme="vs-dark"
                            options={{
                                readOnly: fn.isReadonly,
                                fontSize: 13,
                                lineNumbers: 'on',
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                wordWrap: 'on',
                                tabSize: 4,
                                automaticLayout: true,
                                padding: { top: 8, bottom: 8 },
                                renderLineHighlight: 'line',
                                suggestOnTriggerCharacters: true,
                                bracketPairColorization: { enabled: true },
                            }}
                        />
                    </div>
                </div>

                {/* Panneau droit : Console + Args */}
                <div className="w-72 flex flex-col border-l border-gray-700/50 flex-shrink-0">
                    <RuntimeStatusBanner
                        runtimeHealth={runtimeHealth}
                        isLoading={isRuntimeHealthLoading}
                        error={runtimeHealthError}
                        language={fn.language}
                    />

                    <BuildStatusPanel
                        result={buildResult}
                        isBuilding={isBuilding}
                        error={buildError}
                    />

                    {/* Test Arguments */}
                    <div className="p-3 border-b border-gray-700/40">
                        <TestArgsEditor
                            value={testArgsStr}
                            onChange={handleTestArgsChange}
                            isValid={testArgsValid}
                        />
                    </div>

                    {/* Console */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <button
                            onClick={() => setIsConsolePanelOpen(v => !v)}
                            className="flex items-center justify-between px-3 py-2 border-b border-gray-700/40 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/30 transition-colors"
                        >
                            <span className="font-medium uppercase tracking-wider">Console</span>
                            <svg
                                className={`w-3 h-3 transition-transform ${isConsolePanelOpen ? '' : '-rotate-90'}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {isConsolePanelOpen && (
                            <div className="flex-1 overflow-y-auto bg-gray-950/60">
                                <SandboxConsole
                                    result={sandboxResult}
                                    isRunning={isSandboxRunning}
                                    error={sandboxError}
                                />
                            </div>
                        )}
                    </div>

                    <div className="h-72 border-t border-gray-700/40 overflow-hidden">
                        <FunctionRunArtifactsPanel
                            runs={functionRuns}
                            pagination={functionRunsPagination}
                            statusFilter={runStatusFilter}
                            sortBy={runSortBy}
                            sortOrder={runSortOrder}
                            isLoading={isFunctionRunsLoading}
                            error={functionRunsError}
                            artifactPreview={artifactPreview}
                            isArtifactPreviewLoading={isArtifactPreviewLoading}
                            artifactPreviewError={artifactPreviewError}
                            onRefresh={handleRefreshRuns}
                            onOpenArtifact={handleOpenArtifact}
                            onDownloadArtifact={handleDownloadArtifact}
                            onStatusFilterChange={handleChangeRunStatusFilter}
                            onSortByChange={handleChangeRunSortBy}
                            onSortOrderChange={handleChangeRunSortOrder}
                            onPageChange={handleChangeRunPage}
                            onCleanupRuns={handleCleanupRuns}
                        />
                    </div>

                    {/* Schémas I/O — expandable */}
                    <div className="border-t border-gray-700/40">
                        <button
                            onClick={() => setShowSchemas(v => !v)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/30 transition-colors"
                        >
                            <span className="font-medium uppercase tracking-wider">Schémas I/O</span>
                            <svg
                                className={`w-3 h-3 transition-transform ${showSchemas ? '' : '-rotate-90'}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {showSchemas && (
                            <div className="p-3 space-y-3">
                                {/* Input Schema */}
                                <div>
                                    <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Input Schema</label>
                                    <div className="h-28 border border-gray-700/50 rounded overflow-hidden">
                                        <Editor
                                            height="100%"
                                            language="json"
                                            value={inputSchemaStr}
                                            onChange={v => { if (!fn.isReadonly) setInputSchemaStr(v ?? '{}'); }}
                                            theme="vs-dark"
                                            options={{
                                                readOnly: fn.isReadonly,
                                                fontSize: 11,
                                                lineNumbers: 'off',
                                                minimap: { enabled: false },
                                                scrollBeyondLastLine: false,
                                                wordWrap: 'on',
                                                automaticLayout: true,
                                                padding: { top: 4, bottom: 4 },
                                                folding: false,
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* Output Schema */}
                                <div>
                                    <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Output Schema</label>
                                    <div className="h-28 border border-gray-700/50 rounded overflow-hidden">
                                        <Editor
                                            height="100%"
                                            language="json"
                                            value={outputSchemaStr}
                                            onChange={v => { if (!fn.isReadonly) setOutputSchemaStr(v ?? '{}'); }}
                                            theme="vs-dark"
                                            options={{
                                                readOnly: fn.isReadonly,
                                                fontSize: 11,
                                                lineNumbers: 'off',
                                                minimap: { enabled: false },
                                                scrollBeyondLastLine: false,
                                                wordWrap: 'on',
                                                automaticLayout: true,
                                                padding: { top: 4, bottom: 4 },
                                                folding: false,
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* Save schemas — custom only */}
                                {!fn.isReadonly && (
                                    <button
                                        onClick={handleSaveSchemas}
                                        disabled={isSavingSchemas}
                                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs rounded-md disabled:opacity-50 transition-colors"
                                    >
                                        {isSavingSchemas ? (
                                            <div className="w-3 h-3 border border-cyan-400/40 border-t-cyan-400 rounded-full animate-spin" />
                                        ) : (
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                            </svg>
                                        )}
                                        Sauvegarder les schémas
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FunctionEditorTab;
