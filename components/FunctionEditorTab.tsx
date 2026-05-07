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
import { getFunctionCommandId } from '../utils/functionCommandId';
import { formatQaDiagnosticMessage, getQaDiagnosticPresentation, getSandboxResultDiagnostic } from '../utils/toolDiagnostics';
import { buildToolSelectionFromFunction } from '../services/toolSelectionResolver';
import { useLocalization } from '../hooks/useLocalization';

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
import type { BuildPreparationResult, RuntimeHealthReport, SandboxRunResult, FunctionRunSortField, FunctionRunSortOrder, UserFunction, ToolReadinessStatus } from '../types/function.types';

const RUN_RETENTION_DAYS = 14;
const RUN_RETAIN_LATEST = 20;
type TranslateFn = (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => string;

// ─── SandboxConsole ────────────────────────────────────────────────────────────
interface SandboxConsoleProps {
    result: SandboxRunResult | null;
    isRunning: boolean;
    error: string | null;
}

const SandboxConsole: React.FC<SandboxConsoleProps> = ({ result, isRunning, error }) => {
    const { t } = useLocalization();
    const diagnostic = getSandboxResultDiagnostic(result);
    const failureKindLabel = result?.metadata?.failureKind
        ? result.metadata.failureKind.replace(/_/g, ' ')
        : null;
    const errorSubsystemLabel = result?.errorDetails?.subsystem
        ? result.errorDetails.subsystem.replace(/_/g, ' ')
        : result?.metadata?.failureSubsystem
            ? result.metadata.failureSubsystem.replace(/_/g, ' ')
            : null;

    if (isRunning) {
        return (
            <div className="flex items-center gap-2 text-cyan-400 text-xs p-3">
                <div className="w-3 h-3 border border-cyan-500/40 border-t-cyan-400 rounded-full animate-spin" />
                {t('functionEditor_console_running', 'Exécution en cours...')}
            </div>
        );
    }

    if (!result && !error) {
        return (
            <div className="text-gray-600 text-xs p-3 italic">
                {t('functionEditor_console_idle', 'Aucune exécution — cliquez sur ▶ Exécuter pour tester')}
            </div>
        );
    }

    return (
        <div className="text-xs font-mono">
            {/* Méta */}
            {result && (
                <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-700/40 text-gray-500">
                    <span className={result.success ? 'text-green-400' : 'text-red-400'}>
                        {result.success ? t('functionEditor_console_success', '✓ Succès') : t('functionEditor_console_failure', '✗ Échec')}
                    </span>
                    <span>{result.durationMs}ms</span>
                    {result.runner && <span>{result.runner}</span>}
                    {typeof result.exitCode === 'number' && <span>exit {result.exitCode}</span>}
                    {result.timedOut && <span className="text-yellow-400">{t('functionEditor_console_timeout', '⏱ Timeout')}</span>}
                    {result.executionId && <span className="font-mono text-[11px] truncate">{result.executionId}</span>}
                </div>
            )}

            {(result?.resourceUsage?.wallTimeMs != null || result?.resourceUsage?.memoryLimitMb != null || failureKindLabel || errorSubsystemLabel || result?.errorDetails?.code) && (
                <div className="px-3 py-2 border-b border-gray-700/40 text-[11px] text-gray-400 flex flex-wrap gap-3">
                    {result?.resourceUsage?.wallTimeMs != null && <span>wall {result.resourceUsage.wallTimeMs}ms</span>}
                    {result?.resourceUsage?.memoryLimitMb != null && <span>mem limit {result.resourceUsage.memoryLimitMb}MB</span>}
                    {failureKindLabel && <span>failure {failureKindLabel}</span>}
                    {errorSubsystemLabel && <span>subsystem {errorSubsystemLabel}</span>}
                    {result?.errorDetails?.code && <span>code {result.errorDetails.code}</span>}
                </div>
            )}

            {/* Output JSON */}
            {result?.success && result.output !== null && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">{t('functionEditor_console_result', 'Résultat')}</div>
                    <pre className="text-green-300 overflow-x-auto whitespace-pre-wrap break-words">
                        {JSON.stringify(result.output, null, 2)}
                    </pre>
                </div>
            )}

            {result?.stdout && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">{t('functionEditor_console_stdout', 'Stdout')}</div>
                    <pre className="text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">
                        {result.stdout}
                    </pre>
                </div>
            )}

            {/* Stderr / Error */}
            {(result?.stderr || error) && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">{t('functionEditor_console_error', 'Erreur')}</div>
                    <pre className="text-red-300 overflow-x-auto whitespace-pre-wrap break-words">
                        {result?.errorDetails?.message || result?.stderr || error}
                    </pre>
                </div>
            )}

            {diagnostic && (
                <div className="px-3 py-2 border-t border-gray-700/30">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">{t('functionEditor_console_qaDiagnostic', 'Diagnostic QA')}</div>
                    <div className="space-y-1 text-[11px] text-gray-300">
                        <div>{diagnostic.label}</div>
                        <div className="text-gray-500">{t('functionEditor_console_subsystem', 'Sous-systeme: {value}', { value: diagnostic.subsystemLabel })}</div>
                        <div className="text-cyan-200">{t('functionEditor_console_recommendedAction', 'Action recommandee: {value}', { value: diagnostic.recommendedAction })}</div>
                    </div>
                </div>
            )}

            {result?.errorDetails?.traceback && (
                <div className="px-3 py-2 border-t border-gray-700/30">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">{t('functionEditor_console_traceback', 'Traceback')}</div>
                    <pre className="text-orange-200 overflow-x-auto whitespace-pre-wrap break-words">
                        {result.errorDetails.traceback}
                    </pre>
                </div>
            )}

            {(result?.metadata?.artifacts?.length ?? 0) > 0 && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">{t('functionEditor_console_artifacts', 'Artifacts')}</div>
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
    const { t } = useLocalization();

    if (isBuilding) {
        return (
            <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-amber-300 flex items-center gap-2">
                <div className="w-3 h-3 border border-amber-500/40 border-t-amber-300 rounded-full animate-spin" />
                {t('functionEditor_build_preparing', 'Préparation du build en cours...')}
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
                <span className="text-green-300">{t('functionEditor_build_ready', 'Build prêt')}</span>
                <span className="text-gray-500">{new Date(result.builtAt).toLocaleString()}</span>
            </div>
            <div className="text-gray-500 truncate">{t('functionEditor_build_artifacts', 'Artefacts: {count}', { count: result.artifactPaths.length })}</div>
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

function summarizeNativePythonHealth(runtimeHealth: RuntimeHealthReport | null): {
    toneClass: string;
    summary: string;
    detail?: string;
} | null {
    const nativePythonHealth = runtimeHealth?.nativePython;
    if (!nativePythonHealth) {
        return null;
    }

    if (nativePythonHealth.status === 'healthy') {
        return {
            toneClass: 'text-emerald-300',
            summary: 'Imports critiques natifs Python verifies',
            detail: nativePythonHealth.summary
        };
    }

    if (nativePythonHealth.status === 'degraded') {
        const failingTools = nativePythonHealth.probes
            .filter((probe) => probe.status !== 'healthy')
            .map((probe) => probe.toolName);

        return {
            toneClass: 'text-amber-300',
            summary: failingTools.length > 0
                ? `Imports natifs critiques en echec: ${failingTools.join(', ')}`
                : 'Verification des imports natifs Python incomplete',
            detail: nativePythonHealth.summary
        };
    }

    return {
        toneClass: 'text-red-300',
        summary: 'Health natif Python indisponible',
        detail: nativePythonHealth.summary
    };
}

const RuntimeStatusBanner: React.FC<RuntimeStatusBannerProps> = ({ runtimeHealth, isLoading, error, language }) => {
    const { t } = useLocalization();

    if (isLoading && !runtimeHealth) {
        return (
            <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-gray-400 flex items-center gap-2">
                <div className="w-3 h-3 border border-gray-500/40 border-t-cyan-400 rounded-full animate-spin" />
                {t('functionEditor_runtime_checking', 'Vérification du runtime d\'exécution...')}
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
    const nativePythonSummary = language === 'python'
        ? summarizeNativePythonHealth(runtimeHealth)
        : null;
    const modeDetail = dockerMode === 'docker-desktop'
        ? t('functionEditor_runtime_mode_dockerDesktop', 'Docker Desktop · dev-only (dev/test)')
        : dockerMode === 'rootless'
            ? t('functionEditor_runtime_mode_rootless', 'Docker rootless')
            : dockerMode === 'rootful-linux'
                ? t('functionEditor_runtime_mode_rootful', 'Docker rootful · dev-only (dev/test)')
                : t('functionEditor_runtime_mode_unknown', 'mode non confirmé');
    if (canRun) {
        return (
            <div className={`px-3 py-2 border-b border-gray-700/40 text-xs ${isDevOnly ? 'text-amber-300' : 'text-emerald-300'}`}>
                <div>
                    {t('functionEditor_runtime_ready', 'Runtime {language} prêt pour l\'exécution via {mode}.', {
                        language: language === 'python' ? 'Python' : 'TypeScript',
                        mode: modeDetail,
                    })}
                </div>
                {runtimeHealth.runtime.docker.warning && (
                    <div className="text-gray-400 mt-1">{runtimeHealth.runtime.docker.warning}</div>
                )}
                {nativePythonSummary && (
                    <div className={`mt-1 ${nativePythonSummary.toneClass}`} title={nativePythonSummary.detail}>
                        {nativePythonSummary.summary}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="px-3 py-2 border-b border-gray-700/40 text-xs text-amber-300">
            <div>{t('functionEditor_runtime_blocked', 'Exécution bloquée : {summary}', { summary: runtimeHealth.summary })}</div>
            {nativePythonSummary && (
                <div className={`mt-1 ${nativePythonSummary.toneClass}`} title={nativePythonSummary.detail}>
                    {nativePythonSummary.summary}
                </div>
            )}
        </div>
    );
};

// ─── TestArgsEditor ────────────────────────────────────────────────────────────
interface TestArgsEditorProps {
    value: string;
    onChange: (v: string) => void;
    isValid: boolean;
    errorMessage?: string | null;
    example: string;
    helperText: string;
}

const TestArgsEditor: React.FC<TestArgsEditorProps> = ({ value, onChange, isValid, errorMessage, example, helperText }) => (
    <TestArgsEditorContent value={value} onChange={onChange} isValid={isValid} errorMessage={errorMessage} example={example} helperText={helperText} />
);

const TestArgsEditorContent: React.FC<TestArgsEditorProps> = ({ value, onChange, isValid, errorMessage, example, helperText }) => {
    const { t } = useLocalization();

    return (
        <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
                {t('functionEditor_testArgs_label', 'Arguments de test')} <span className="text-gray-600">(JSON)</span>
            </label>
            <textarea
                value={value}
                onChange={e => onChange(e.target.value)}
                rows={4}
                spellCheck={false}
                aria-label={t('functionEditor_testArgs_aria', 'Arguments de test JSON')}
                className={`w-full px-3 py-2 bg-gray-900/80 border rounded-lg text-xs font-mono text-gray-300 
                    focus:outline-none resize-none transition-colors ${
                    isValid ? 'border-gray-600/50 focus:border-cyan-500/40' : 'border-red-500/50'
                }`}
                placeholder={example}
            />
            <div className="mt-2 rounded-lg border border-gray-700/40 bg-gray-900/60 p-2.5 text-[11px] text-gray-400 space-y-2">
                <p>{helperText}</p>
                <div>
                    <div className="uppercase tracking-wider text-gray-500 mb-1">{t('functionEditor_testArgs_example', 'Exemple valide')}</div>
                    <pre className="whitespace-pre-wrap break-words text-cyan-200">{example}</pre>
                </div>
                <p className="text-gray-500">{t('functionEditor_testArgs_strictJson', 'JSON strict uniquement: utilisez des doubles quotes pour les cles et les chaines, jamais des quotes simples ni la syntaxe objet JavaScript.')}</p>
            </div>
            {!isValid && errorMessage && (
                <p className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{errorMessage}</p>
            )}
        </div>
    );
};

interface FunctionPreparationSummary {
    categoryLabel: string;
    scopeLabel: string;
    preparationLabel: string;
    toneClass: string;
    helperText: string;
}

const mapReadinessToPreparationSummary = (fn: UserFunction, readinessStatus: ToolReadinessStatus, t: TranslateFn): FunctionPreparationSummary => {
    const categoryLabel = fn.origin === 'native' || fn.isReadonly ? t('functionEditor_preparation_category_native', 'Native readonly') : t('functionEditor_preparation_category_custom', 'Custom editable');
    const scopeLabel = fn.workflowId ? t('functionEditor_preparation_scope_workflow', 'Rattachee a un workflow') : (fn.origin === 'native' ? t('functionEditor_preparation_scope_platform', 'Catalogue plateforme') : t('functionEditor_preparation_scope_outside', 'Hors workflow'));

    if (readinessStatus.requirement === 'platform_provision') {
        return {
            categoryLabel,
            scopeLabel,
            preparationLabel: readinessStatus.state === 'ready'
                ? t('functionEditor_preparation_platform_confirmed', 'Provisionnement plateforme confirme')
                : t('functionEditor_preparation_platform_pending', 'Provisionnement plateforme en attente'),
            toneClass: readinessStatus.state === 'ready'
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                : 'border-cyan-500/30 bg-cyan-950/20 text-cyan-200',
            helperText: `${readinessStatus.summary} ${readinessStatus.actionLabel}.`
        };
    }

    if (readinessStatus.requirement === 'author_build') {
        return {
            categoryLabel,
            scopeLabel,
            preparationLabel: readinessStatus.state === 'ready'
                ? t('functionEditor_preparation_build_confirmed', 'Build auteur confirme')
                : t('functionEditor_preparation_build_required', 'Build auteur requis'),
            toneClass: readinessStatus.state === 'ready'
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                : 'border-amber-500/30 bg-amber-950/20 text-amber-200',
            helperText: `${readinessStatus.summary} ${readinessStatus.actionLabel}.`
        };
    }

    return {
        categoryLabel,
        scopeLabel,
        preparationLabel: t('functionEditor_preparation_none', 'Aucune preparation supplementaire requise'),
        toneClass: readinessStatus.runnable
            ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
            : 'border-gray-600/30 bg-gray-900/50 text-gray-300',
        helperText: `${readinessStatus.summary} ${readinessStatus.actionLabel}.`
    };
};

const getTestArgsExample = (language: 'python' | 'typescript') => {
    if (language === 'python') {
        return '{\n  "user_name": "Ada",\n  "score": 42\n}';
    }

    return '{\n  "user_name": "Ada"\n}';
};

const getTestArgsHelperText = (language: 'python' | 'typescript', t: TranslateFn) => {
    if (language === 'python') {
        return t('functionEditor_testArgs_helper_python', 'Exemple QA Python: la fonction lit des donnees JSON strictes depuis args, par exemple args["user_name"] et args["score"].');
    }

    return t('functionEditor_testArgs_helper_typescript', 'Exemple QA TypeScript: la fonction lit des donnees JSON strictes depuis args.user_name. Avec cet exemple, la reponse attendue est: Ton nom, Ada, est maintenant enregistre dans ma memoire.');
};

const buildJsonValidationMessage = (error: unknown, t: TranslateFn) => {
    const parseMessage = error instanceof Error ? error.message : t('functionEditor_json_invalid_format', 'Format JSON invalide.');
    return t('functionEditor_json_invalid_message', 'JSON invalide. {message}\nExemple valide:\n{\n  "user_name": "Ada"\n}', { message: parseMessage });
};

const getPreparationSummary = (fn: UserFunction, t: TranslateFn): FunctionPreparationSummary => {
    if (fn.readinessStatus) {
        return mapReadinessToPreparationSummary(fn, fn.readinessStatus, t);
    }

    if (fn.origin === 'native' || fn.isReadonly) {
        return {
            categoryLabel: t('functionEditor_preparation_category_native', 'Native readonly'),
            scopeLabel: fn.workflowId ? t('functionEditor_preparation_scope_exposed', 'Exposee dans un workflow') : t('functionEditor_preparation_scope_platform', 'Catalogue plateforme'),
            preparationLabel: t('functionEditor_preparation_platform_required', 'Preparation plateforme requise'),
            toneClass: 'border-cyan-500/30 bg-cyan-950/20 text-cyan-200',
            helperText: t('functionEditor_preparation_platform_helper', 'Cette fonction ne suit pas le build auteur. Elle doit etre preparee et provisionnee par la plateforme avant execution fiable.')
        };
    }

    if (fn.workflowId) {
        return {
            categoryLabel: t('functionEditor_preparation_category_custom', 'Custom editable'),
            scopeLabel: t('functionEditor_preparation_scope_workflow', 'Rattachee a un workflow'),
            preparationLabel: t('functionEditor_preparation_build_available', 'Build auteur disponible'),
            toneClass: 'border-amber-500/30 bg-amber-950/20 text-amber-200',
            helperText: t('functionEditor_preparation_build_helper', 'Le code peut etre sauvegarde puis prepare via le build auteur avant validation QA approfondie.')
        };
    }

    return {
        categoryLabel: t('functionEditor_preparation_category_custom', 'Custom editable'),
        scopeLabel: t('functionEditor_preparation_scope_outside', 'Hors workflow'),
        preparationLabel: t('functionEditor_preparation_build_unavailable', 'Build auteur indisponible'),
        toneClass: 'border-gray-600/30 bg-gray-900/50 text-gray-300',
        helperText: t('functionEditor_preparation_build_unavailable_helper', 'Le build auteur est reserve aux fonctions custom rattachees a un workflow. Cette fonction peut etre editee et testee, mais pas preparee via ce bouton.')
    };
};

interface PreparationStatusCardProps {
    summary: FunctionPreparationSummary;
}

const PreparationStatusCard: React.FC<PreparationStatusCardProps> = ({ summary }) => (
    <PreparationStatusCardContent summary={summary} />
);

const PreparationStatusCardContent: React.FC<PreparationStatusCardProps> = ({ summary }) => {
    const { t } = useLocalization();

    return (
        <div className={`px-3 py-2 border-b border-gray-700/40 text-xs ${summary.toneClass}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{t('functionEditor_preparation_categoryLabel', 'Categorie {value}', { value: summary.categoryLabel })}</span>
                <span>{summary.scopeLabel}</span>
            </div>
            <div className="mt-1 font-medium">{summary.preparationLabel}</div>
            <div className="mt-1 text-[11px] opacity-90">{summary.helperText}</div>
        </div>
    );
};

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
    const { t } = useLocalization();
    const fn = getSelectedFunction();
    const resolvedToolId = fn ? getFunctionCommandId(fn) : null;
    const isWorkflowScopedFunction = Boolean(fn?.workflowId);
    const preparationSummary = fn ? getPreparationSummary(fn, t) : null;

    const [code, setCode] = useState<string>('');
    const [testArgsStr, setTestArgsStr] = useState<string>('{}');
    const [testArgsValid, setTestArgsValid] = useState(true);
    const [testArgsErrorMessage, setTestArgsErrorMessage] = useState<string | null>(null);
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
        setTestArgsErrorMessage(null);
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
            addNotification({
                type: 'success',
                title: t('functionEditor_notification_saved_title', 'Sauvegardé'),
                message: t('functionEditor_notification_saved_message', '"{name}" sauvegardée.', { name: fn.name })
            });
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
            addNotification({
                type: 'error',
                title: t('functionEditor_notification_inputSchemaInvalid_title', 'Input Schema invalide'),
                message: t('functionEditor_notification_inputSchemaInvalid_message', 'JSON malformé dans le schéma d\'entrée.')
            });
            return;
        }
        try {
            outputSchema = JSON.parse(outputSchemaStr);
        } catch {
            addNotification({
                type: 'error',
                title: t('functionEditor_notification_outputSchemaInvalid_title', 'Output Schema invalide'),
                message: t('functionEditor_notification_outputSchemaInvalid_message', 'JSON malformé dans le schéma de sortie.')
            });
            return;
        }
        setIsSavingSchemas(true);
        await updateFunction(fn._id, { inputSchema, outputSchema });
        setIsSavingSchemas(false);
        addNotification({
            type: 'success',
            title: t('functionEditor_notification_schemasSaved_title', 'Schémas sauvegardés'),
            message: t('functionEditor_notification_schemasSaved_message', 'Schémas de "{name}" mis à jour.', { name: fn.name })
        });
    };

    // Exécuter dans le sandbox
    const handleRun = async () => {
        if (!fn) return;

        if (!runtimeHealth?.capabilities.run[fn.language]) {
            addNotification({
                type: 'error',
                title: t('functionEditor_notification_runtimeNotReady_title', 'Runtime non prêt'),
                message: formatQaDiagnosticMessage({
                    code: 'RUNTIME_NOT_READY',
                    subsystem: 'runtime_readiness',
                    message: runtimeHealth?.summary || 'Le runtime d\'execution n\'est pas pret.',
                    retryable: true
                })
            });
            return;
        }

        let testArgs: Record<string, unknown> = {};
        try {
            testArgs = JSON.parse(testArgsStr);
            setTestArgsValid(true);
            setTestArgsErrorMessage(null);
        } catch (error) {
            const message = buildJsonValidationMessage(error, t);
            setTestArgsValid(false);
            setTestArgsErrorMessage(message);
            addNotification({
                type: 'error',
                title: t('functionEditor_notification_jsonInvalid_title', 'JSON invalide'),
                message: formatQaDiagnosticMessage({
                    code: 'JSON_INVALID',
                    subsystem: 'validation',
                    message,
                    retryable: false
                })
            });
            return;
        }

        // Sauvegarder d'abord si non readonly
        if (!fn.isReadonly && code !== fn.codeInline && resolvedToolId) {
            await updateFunction(resolvedToolId, { codeInline: code });
        }

        const result = await runInSandbox(
            undefined,
            testArgs,
            buildToolSelectionFromFunction(fn)
        );
        if (!result) {
            addNotification({
                type: 'error',
                title: t('functionEditor_notification_runFailed_title', 'Exécution échouée'),
                message: formatQaDiagnosticMessage(undefined, t('functionEditor_notification_runFailed_message', 'Le sandbox n\'a retourne aucun resultat. Consultez la console d\'execution.'))
            });
            return;
        }

        const resultDiagnostic = result.success
            ? null
            : getQaDiagnosticPresentation(result.errorDetails ?? {
                code: result.metadata?.failureKind,
                subsystem: result.metadata?.failureSubsystem,
                failureKind: result.metadata?.failureKind,
                message: result.stderr,
                retryable: false
            });

        addNotification({
            type: result.success ? 'success' : 'error',
            title: result.success ? t('functionEditor_notification_runDone_title', 'Exécution terminée') : t('functionEditor_notification_runError_title', 'Exécution en erreur'),
            message: result.success
                ? t('functionEditor_notification_runDone_message', 'Résultat disponible pour "{name}" dans la console d\'exécution.', { name: fn.name })
                : formatQaDiagnosticMessage(result.errorDetails ?? {
                    code: result.metadata?.failureKind,
                    subsystem: result.metadata?.failureSubsystem,
                    failureKind: result.metadata?.failureKind,
                    message: result.stderr || t('functionEditor_notification_runError_defaultMessage', 'Le sandbox a renvoye une erreur.'),
                    retryable: false
                }, resultDiagnostic?.label)
        });
    };

    const handleBuild = async () => {
        if (!fn || fn.isReadonly) return;

        if (!isWorkflowScopedFunction) {
            clearBuildResult();
            addNotification({
                type: 'info',
                title: t('functionEditor_notification_buildUnavailable_title', 'Build indisponible'),
                message: formatQaDiagnosticMessage({
                    code: 'BUILD_PREPARATION_ERROR',
                    subsystem: 'build_preparation',
                    message: t('functionEditor_notification_buildUnavailable_message', 'Le build est disponible uniquement pour les fonctions custom rattachees a un workflow a ce stade.'),
                    retryable: false
                })
            });
            return;
        }

        if (code !== fn.codeInline) {
            const updated = await updateFunction(resolvedToolId ?? fn._id, { codeInline: code });
            if (!updated) {
                addNotification({
                    type: 'error',
                    title: t('functionEditor_notification_buildCanceled_title', 'Build annulé'),
                    message: formatQaDiagnosticMessage({
                        code: 'BUILD_PREPARATION_ERROR',
                        subsystem: 'build_preparation',
                        message: t('functionEditor_notification_buildCanceled_message', 'La sauvegarde du code a echoue avant la preparation du build.'),
                        retryable: false
                    })
                });
                return;
            }
        }

        const result = await runBuild(resolvedToolId ?? fn._id);
        if (result) {
            addNotification({
                type: 'success',
                title: t('functionEditor_notification_buildReady_title', 'Build prêt'),
                message: t('functionEditor_notification_buildReady_message', 'Artefacts préparés pour "{name}".', { name: fn.name })
            });
        }
    };

    // Valider le JSON des args en temps réel
    const handleTestArgsChange = (value: string) => {
        setTestArgsStr(value);
        try {
            JSON.parse(value);
            setTestArgsValid(true);
            setTestArgsErrorMessage(null);
        } catch (error) {
            setTestArgsValid(false);
            setTestArgsErrorMessage(buildJsonValidationMessage(error, t));
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
                title: t('functionEditor_notification_downloadFailed_title', 'Téléchargement impossible'),
                message: formatQaDiagnosticMessage({
                    code: 'SANDBOX_RUNTIME_ERROR',
                    subsystem: 'sandbox_runtime',
                    message: error.response?.data?.error || t('functionEditor_notification_downloadFailed_message', 'Impossible de telecharger {artifactPath}.', { artifactPath }),
                    retryable: false
                })
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

        const confirmed = window.confirm(t('functionEditor_cleanup_confirm', 'Supprimer les runs de plus de {days} jours en conservant les {count} plus récents ?', {
            days: RUN_RETENTION_DAYS,
            count: RUN_RETAIN_LATEST,
        }));
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
                title: t('functionEditor_notification_cleanupFailed_title', 'Nettoyage impossible'),
                message: formatQaDiagnosticMessage({
                    code: 'SANDBOX_RUNTIME_ERROR',
                    subsystem: 'sandbox_runtime',
                    message: t('functionEditor_notification_cleanupFailed_message', 'Le nettoyage des runs a echoue.'),
                    retryable: false
                })
            });
            return;
        }

        addNotification({
            type: 'success',
            title: t('functionEditor_notification_cleanupDone_title', 'Nettoyage terminé'),
            message: t('functionEditor_notification_cleanupDone_message', '{runs} run(s) supprime(s), {artifacts} artefact(s) nettoye(s).\nAction recommandee: verifier qu\'il reste au moins un run de reference pour QA.', {
                runs: result.deletedRuns,
                artifacts: result.deletedArtifacts.length,
            })
        });

        void loadFunctionRuns(resolvedToolId, {
            page: 1,
            limit: functionRunsPagination.limit,
            status: runStatusFilter === 'all' ? undefined : runStatusFilter,
            sortBy: runSortBy,
            sortOrder: runSortOrder
        });
        setRunPage(1);
    }, [resolvedToolId, cleanupFunctionRuns, addNotification, loadFunctionRuns, functionRunsPagination.limit, runStatusFilter, runSortBy, runSortOrder, t]);

    // Pas de fonction sélectionnée
    if (!fn) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2 p-8">
                <svg className="w-10 h-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <p className="text-sm text-center">{t('functionEditor_empty', 'Sélectionnez une fonction dans la Bibliothèque')}</p>
            </div>
        );
    }

    const monacoLanguage = fn.language === 'python' ? 'python' : 'typescript';
    const readinessBlocked = fn.readinessStatus?.runnable === false;
    const runDisabled = isSandboxRunning || isRuntimeHealthLoading || !runtimeHealth?.capabilities.run[fn.language] || readinessBlocked;
    const runDisabledReason = readinessBlocked
        ? `${fn.readinessStatus?.summary || t('functionEditor_notRunnable', 'Cette fonction n\'est pas encore exécutable.')} ${fn.readinessStatus?.actionLabel || ''}`.trim()
        : runtimeHealthError
            || runtimeHealth?.summary
            || t('functionEditor_runtime_notReady', 'Le runtime d\'exécution n\'est pas encore prêt.');
    const buildDisabled = isBuilding || !isWorkflowScopedFunction;
    const buildDisabledReason = !isWorkflowScopedFunction
        ? t('functionEditor_build_disabled', 'Le build est réservé aux fonctions custom rattachées à un workflow.')
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
                        <span className="text-xs text-gray-500 flex-shrink-0">{t('functionEditor_readonly', '🔒 lecture seule')}</span>
                    )}
                </div>

                {/* Erreurs syntaxe */}
                {syntaxErrors.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-red-400 flex-shrink-0">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {t('functionEditor_syntaxErrors', '{count} erreur(s)', { count: syntaxErrors.length })}
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
                            {t('functionEditor_build_button', 'Préparer build')}
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
                            {t('save', 'Sauvegarder')}
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
                        {t('functionEditor_run_button', 'Exécuter')}
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
                                {t('functionEditor_typescript_hint', '— accès via')} <code className="bg-blue-900/40 px-1 rounded">args.param_name</code>
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
                <div data-testid="function-editor-sidebar" className="w-72 min-h-0 overflow-y-auto flex flex-col border-l border-gray-700/50 flex-shrink-0">
                    <RuntimeStatusBanner
                        runtimeHealth={runtimeHealth}
                        isLoading={isRuntimeHealthLoading}
                        error={runtimeHealthError}
                        language={fn.language}
                    />

                    {preparationSummary && (
                        <PreparationStatusCard summary={preparationSummary} />
                    )}

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
                            errorMessage={testArgsErrorMessage}
                            example={getTestArgsExample(fn.language)}
                            helperText={getTestArgsHelperText(fn.language, t)}
                        />
                    </div>

                    {/* Console */}
                    <div className="min-h-52 flex flex-col overflow-hidden border-t border-gray-700/40">
                        <button
                            onClick={() => setIsConsolePanelOpen(v => !v)}
                            className="flex items-center justify-between px-3 py-2 border-b border-gray-700/40 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/30 transition-colors"
                        >
                            <span className="font-medium uppercase tracking-wider">{t('functionEditor_console_title', 'Console')}</span>
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

                    <div className="h-72 flex-shrink-0 border-t border-gray-700/40 overflow-hidden">
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
                    <div className="flex-shrink-0 border-t border-gray-700/40">
                        <button
                            onClick={() => setShowSchemas(v => !v)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/30 transition-colors"
                        >
                            <span className="font-medium uppercase tracking-wider">{t('functionEditor_schemas_title', 'Schémas I/O')}</span>
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
                                    <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">{t('functionEditor_inputSchema', 'Input Schema')}</label>
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
                                    <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">{t('functionEditor_outputSchema', 'Output Schema')}</label>
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
                                        {t('functionEditor_saveSchemas', 'Sauvegarder les schémas')}
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
