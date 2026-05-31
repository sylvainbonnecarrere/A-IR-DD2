/**
 * Store Zustand — Gestion des Fonctions Personnalisées (Tools V2)
 *
 * Domain : Design Domain (prototypes statiques, CRUD, pas de runtime)
 * Pattern  : Repository via API calls, Store as cache
 *
 * Responsabilités :
 *   - Lister, créer, mettre à jour, supprimer, toggler les fonctions
 *   - Maintenir l'état loading/error
 *   - fournir `selectedFunctionId` pour l'éditeur Monaco
 */

import { create } from 'zustand';
import { toolRepository } from '../services/toolRepository';
import { matchesFunctionIdentity, resolveFunctionCommandId } from '../utils/functionCommandId';
import type { ToolSelection } from '../types';
import type {
    UserFunction,
    CreateFunctionPayload,
    UpdateFunctionPayload,
    FunctionFilter,
    SandboxRunResult,
    FunctionRunRecord,
    FunctionRunListResponse,
    FunctionRunSortField,
    FunctionRunSortOrder,
    FunctionRunCleanupResult,
    FunctionArtifactPreview,
    SyntaxCheckResult,
    BuildPreparationResult,
    RuntimeHealthReport,
    RuntimeCompatibilityContext,
    ToolWorkspaceSummary,
} from '../types/function.types';

const deriveRuntimeCompatibilityFromHealth = (runtimeHealth: RuntimeHealthReport): RuntimeCompatibilityContext => ({
    checkedAt: runtimeHealth.checkedAt,
    mode: runtimeHealth.runtime.docker.mode,
    securityLevel: runtimeHealth.runtime.docker.securityLevel,
    executionReady: runtimeHealth.runtime.docker.executionReady,
    preferredRunner: runtimeHealth.runtime.runners.preferred,
    warning: runtimeHealth.runtime.docker.warning,
    summary: runtimeHealth.summary
});

const DEFAULT_FUNCTION_WORKSPACE_KEY = '__active__';

let pendingFunctionLoadPromise: Promise<void> | null = null;
let pendingFunctionLoadWorkspaceKey: string | null = null;

const resolveFunctionLoadWorkspaceKey = (
    workflowId: string | undefined,
    activeWorkspace: ToolWorkspaceSummary | null,
): string => workflowId ?? activeWorkspace?.workflowId ?? DEFAULT_FUNCTION_WORKSPACE_KEY;

interface FunctionStore {
    // State
    functions: UserFunction[];
    selectedFunctionId: string | null;
    isLoading: boolean;
    error: string | null;
    filters: FunctionFilter;

    // Sandbox state
    sandboxResult: SandboxRunResult | null;
    isSandboxRunning: boolean;
    sandboxError: string | null;
    functionRuns: FunctionRunRecord[];
    functionRunsPagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        status?: FunctionRunRecord['status'];
        sortBy: FunctionRunSortField;
        sortOrder: FunctionRunSortOrder;
    };
    isFunctionRunsLoading: boolean;
    functionRunsError: string | null;
    artifactPreview: FunctionArtifactPreview | null;
    isArtifactPreviewLoading: boolean;
    artifactPreviewError: string | null;

    // Build state
    buildResult: BuildPreparationResult | null;
    isBuilding: boolean;
    buildError: string | null;

    // Runtime readiness state
    runtimeHealth: RuntimeHealthReport | null;
    runtimeCompatibility: RuntimeCompatibilityContext | null;
    activeWorkspace: ToolWorkspaceSummary | null;
    isRuntimeHealthLoading: boolean;
    runtimeHealthError: string | null;

    // Actions CRUD
    loadFunctions: (workflowId?: string) => Promise<void>;
    createFunction: (payload: CreateFunctionPayload) => Promise<UserFunction | null>;
    updateFunction: (id: string, payload: UpdateFunctionPayload) => Promise<UserFunction | null>;
    deleteFunction: (id: string) => Promise<boolean>;
    toggleFunction: (id: string, allowBashPy?: boolean) => Promise<void>;

    // Sélection
    selectFunction: (id: string | null) => void;
    getSelectedFunction: () => UserFunction | null;

    // Filtres
    setFilter: (filter: Partial<FunctionFilter>) => void;
    getFilteredFunctions: () => UserFunction[];

    // Sandbox
    runInSandbox: (functionId: string | undefined, testArgs: Record<string, unknown>, toolSelection?: ToolSelection) => Promise<SandboxRunResult | null>;
    checkSyntax: (language: 'python' | 'typescript', code: string) => Promise<SyntaxCheckResult | null>;
    clearSandboxResult: () => void;
    loadFunctionRuns: (
        functionId: string,
        options?: {
            limit?: number;
            page?: number;
            status?: FunctionRunRecord['status'];
            sortBy?: FunctionRunSortField;
            sortOrder?: FunctionRunSortOrder;
        }
    ) => Promise<void>;
    loadArtifactPreview: (functionId: string, executionId: string, artifactPath: string) => Promise<void>;
    cleanupFunctionRuns: (functionId: string, options: { retentionDays?: number; retainLatest?: number; dryRun?: boolean }) => Promise<FunctionRunCleanupResult | null>;
    clearArtifactPreview: () => void;
    runBuild: (functionId: string) => Promise<BuildPreparationResult | null>;
    loadBuildStatus: (functionId: string) => Promise<void>;
    clearBuildResult: () => void;
    loadRuntimeHealth: () => Promise<RuntimeHealthReport | null>;

    // Inline code update (optimiste, sans save)
    updateInlineCodeOptimistic: (id: string, code: string) => void;

    // Reset complet (appelé au logout / changement d'utilisateur)
    resetStore: () => void;
}

export const useFunctionStore = create<FunctionStore>((set, get) => ({
    // ─── Initial State ──────────────────────────────────────────────────────
    functions: [],
    selectedFunctionId: null,
    isLoading: false,
    error: null,
    filters: { origin: 'all', language: 'all', isEnabled: 'all', search: '' },
    sandboxResult: null,
    isSandboxRunning: false,
    sandboxError: null,
    functionRuns: [],
    functionRunsPagination: { page: 1, limit: 20, total: 0, totalPages: 1, sortBy: 'createdAt', sortOrder: 'desc' },
    isFunctionRunsLoading: false,
    functionRunsError: null,
    artifactPreview: null,
    isArtifactPreviewLoading: false,
    artifactPreviewError: null,
    buildResult: null,
    isBuilding: false,
    buildError: null,
    runtimeHealth: null,
    runtimeCompatibility: null,
    activeWorkspace: null,
    isRuntimeHealthLoading: false,
    runtimeHealthError: null,

    // ─── Charger les fonctions ───────────────────────────────────────────────
    loadFunctions: async (workflowId?: string) => {
        const state = get();
        const requestedWorkspaceKey = resolveFunctionLoadWorkspaceKey(workflowId, state.activeWorkspace);
        const alreadyLoadedCurrentWorkspace = state.error === null && !state.isLoading && (
            (!!workflowId && state.activeWorkspace?.workflowId === workflowId)
            || (!workflowId && !!state.activeWorkspace)
        );

        if (alreadyLoadedCurrentWorkspace) {
            return;
        }

        if (pendingFunctionLoadPromise && pendingFunctionLoadWorkspaceKey === requestedWorkspaceKey) {
            return pendingFunctionLoadPromise;
        }

        set({ isLoading: true, error: null });

        const loadPromise = toolRepository.loadPhilFunctions(workflowId)
            .then((result) => {
                set({
                    functions: result.functions,
                    runtimeCompatibility: result.runtimeCompatibility,
                    activeWorkspace: result.workspace,
                    isLoading: false
                });
            })
            .catch((err: any) => {
                set({
                    isLoading: false,
                    error: err.response?.data?.error || 'Erreur lors du chargement des fonctions'
                });
            })
            .finally(() => {
                if (pendingFunctionLoadPromise === loadPromise) {
                    pendingFunctionLoadPromise = null;
                    pendingFunctionLoadWorkspaceKey = null;
                }
            });

        pendingFunctionLoadPromise = loadPromise;
        pendingFunctionLoadWorkspaceKey = requestedWorkspaceKey;
        return loadPromise;
    },

    // ─── Créer une fonction custom ───────────────────────────────────────────
    createFunction: async (payload) => {
        set({ isLoading: true, error: null });
        try {
            const { data } = await toolRepository.createFunction(payload);
            set(state => ({
                functions: [...state.functions, data],
                selectedFunctionId: data._id,
                runtimeCompatibility: data.runtimeCompatibility ?? state.runtimeCompatibility,
                isLoading: false
            }));
            return data;
        } catch (err: any) {
            set({
                isLoading: false,
                error: err.response?.data?.error || 'Erreur lors de la création'
            });
            return null;
        }
    },

    // ─── Mettre à jour une fonction ──────────────────────────────────────────
    updateFunction: async (id, payload) => {
        set({ isLoading: true, error: null });
        try {
            const commandId = resolveFunctionCommandId(id, get().functions);
            const { data } = await toolRepository.updateFunction(commandId, payload);
            set(state => ({
                functions: state.functions.map(f => matchesFunctionIdentity(f, id) || matchesFunctionIdentity(f, commandId) ? data : f),
                runtimeCompatibility: data.runtimeCompatibility ?? state.runtimeCompatibility,
                isLoading: false
            }));
            return data;
        } catch (err: any) {
            set({
                isLoading: false,
                error: err.response?.data?.error || 'Erreur lors de la mise à jour'
            });
            return null;
        }
    },

    // ─── Supprimer une fonction ──────────────────────────────────────────────
    deleteFunction: async (id) => {
        try {
            const commandId = resolveFunctionCommandId(id, get().functions);
            await toolRepository.deleteFunction(commandId);
            set(state => ({
                functions: state.functions.filter(f => !matchesFunctionIdentity(f, id) && !matchesFunctionIdentity(f, commandId)),
                selectedFunctionId: state.selectedFunctionId === id ? null : state.selectedFunctionId
            }));
            return true;
        } catch (err: any) {
            set({ error: err.response?.data?.error || 'Erreur lors de la suppression' });
            return false;
        }
    },

    // ─── Toggle isEnabled ────────────────────────────────────────────────────
    toggleFunction: async (id, allowBashPy = false) => {
        try {
            const commandId = resolveFunctionCommandId(id, get().functions);
            const { data } = await toolRepository.toggleFunction(commandId, allowBashPy);
            set(state => ({
                functions: state.functions.map(f =>
                    matchesFunctionIdentity(f, id) || matchesFunctionIdentity(f, commandId)
                        ? { ...f, isEnabled: data.isEnabled }
                        : f
                )
            }));
        } catch (err: any) {
            set({ error: err.response?.data?.error || 'Erreur lors du toggle' });
        }
    },

    // ─── Sélection ───────────────────────────────────────────────────────────
    selectFunction: (id) => set({ selectedFunctionId: id }),

    getSelectedFunction: () => {
        const { functions, selectedFunctionId } = get();
        return functions.find(f => f._id === selectedFunctionId) ?? null;
    },

    // ─── Filtres ─────────────────────────────────────────────────────────────
    setFilter: (filter) =>
        set(state => ({ filters: { ...state.filters, ...filter } })),

    getFilteredFunctions: () => {
        const { functions, filters } = get();
        return functions.filter(fn => {
            if (filters.origin && filters.origin !== 'all' && fn.origin !== filters.origin) return false;
            if (filters.language && filters.language !== 'all' && fn.language !== filters.language) return false;
            if (filters.isEnabled !== undefined && filters.isEnabled !== 'all' && fn.isEnabled !== filters.isEnabled) return false;
            if (filters.search) {
                const q = filters.search.toLowerCase();
                if (!fn.name.toLowerCase().includes(q) && !fn.description.toLowerCase().includes(q)) return false;
            }
            return true;
        });
    },

    // ─── Sandbox ─────────────────────────────────────────────────────────────
    runInSandbox: async (functionId, testArgs, toolSelection) => {
        set({ isSandboxRunning: true, sandboxError: null, sandboxResult: null });
        try {
            const commandId = functionId
                ? resolveFunctionCommandId(functionId, get().functions)
                : undefined;
            const { data } = await toolRepository.runInSandbox(commandId, testArgs, toolSelection);
            set({ sandboxResult: data, isSandboxRunning: false });
            return data;
        } catch (err: any) {
            set({
                isSandboxRunning: false,
                sandboxError: err.response?.data?.error || 'Erreur d\'exécution sandbox'
            });
            return null;
        }
    },

    checkSyntax: async (language, code) => {
        try {
            const { data } = await toolRepository.checkSyntax(language, code);
            return data;
        } catch {
            return null;
        }
    },

    clearSandboxResult: () =>
        set({ sandboxResult: null, sandboxError: null }),

    loadFunctionRuns: async (functionId, options = {}) => {
        set({ isFunctionRunsLoading: true, functionRunsError: null });
        try {
            const commandId = resolveFunctionCommandId(functionId, get().functions);
            const limit = options.limit ?? 20;
            const page = options.page ?? 1;
            const sortBy = options.sortBy ?? get().functionRunsPagination.sortBy;
            const sortOrder = options.sortOrder ?? get().functionRunsPagination.sortOrder;
            const { data } = await toolRepository.loadFunctionRuns(commandId, {
                limit,
                page,
                status: options.status,
                sortBy,
                sortOrder
            });
            set({
                functionRuns: data.items,
                functionRunsPagination: data.pagination,
                runtimeCompatibility: data.runtimeCompatibility ?? get().runtimeCompatibility,
                isFunctionRunsLoading: false
            });
        } catch (err: any) {
            set({
                isFunctionRunsLoading: false,
                functionRunsError: err.response?.data?.error || 'Erreur lors du chargement des runs',
                functionRuns: [],
                functionRunsPagination: { page: 1, limit: 20, total: 0, totalPages: 1, sortBy: 'createdAt', sortOrder: 'desc' }
            });
        }
    },

    loadArtifactPreview: async (functionId, executionId, artifactPath) => {
        set({ isArtifactPreviewLoading: true, artifactPreviewError: null, artifactPreview: null });
        try {
            const commandId = resolveFunctionCommandId(functionId, get().functions);
            const { data } = await toolRepository.loadArtifactPreview(commandId, executionId, artifactPath);
            set({ artifactPreview: data, isArtifactPreviewLoading: false });
        } catch (err: any) {
            set({
                isArtifactPreviewLoading: false,
                artifactPreviewError: err.response?.data?.error || 'Erreur lors du chargement de l\'artefact'
            });
        }
    },

    cleanupFunctionRuns: async (functionId, options) => {
        try {
            const commandId = resolveFunctionCommandId(functionId, get().functions);
            const { data } = await toolRepository.cleanupFunctionRuns(commandId, options);
            return data;
        } catch (err: any) {
            set({
                functionRunsError: err.response?.data?.error || 'Erreur lors du nettoyage des runs'
            });
            return null;
        }
    },

    clearArtifactPreview: () => set({ artifactPreview: null, artifactPreviewError: null }),

    runBuild: async (functionId) => {
        set({ isBuilding: true, buildError: null });
        try {
            const commandId = resolveFunctionCommandId(functionId, get().functions);
            const { data } = await toolRepository.runBuild(commandId);
            set({ buildResult: data, isBuilding: false });
            return data;
        } catch (err: any) {
            set({
                isBuilding: false,
                buildError: err.response?.data?.error || 'Erreur lors de la préparation du build'
            });
            return null;
        }
    },

    loadBuildStatus: async (functionId) => {
        try {
            const commandId = resolveFunctionCommandId(functionId, get().functions);
            const { data } = await toolRepository.loadBuildStatus(commandId);
            set({ buildResult: data, buildError: null });
        } catch (err: any) {
            if (err.response?.status === 404) {
                set({ buildResult: null });
                return;
            }

            set({ buildError: err.response?.data?.error || 'Erreur lors du chargement du build' });
        }
    },

    clearBuildResult: () => set({ buildResult: null, buildError: null }),

    loadRuntimeHealth: async () => {
        set({ isRuntimeHealthLoading: true, runtimeHealthError: null });
        try {
            const { data } = await toolRepository.loadRuntimeHealth();
            set({
                runtimeHealth: data,
                runtimeCompatibility: deriveRuntimeCompatibilityFromHealth(data),
                isRuntimeHealthLoading: false,
                runtimeHealthError: null
            });
            return data;
        } catch (err: any) {
            set({
                isRuntimeHealthLoading: false,
                runtimeHealthError: err.response?.data?.error || 'Erreur lors du chargement de l\'état runtime'
            });
            return null;
        }
    },

    // ─── Optimistic inline code update ───────────────────────────────────────
    updateInlineCodeOptimistic: (id, code) =>
        set(state => ({
            functions: state.functions.map(f =>
                f._id === id ? { ...f, codeInline: code } : f
            )
        })),

    // ─── Reset complet (sécurité : appelé au logout pour ne pas fuiter les données) ─
    resetStore: () => {
        pendingFunctionLoadPromise = null;
        pendingFunctionLoadWorkspaceKey = null;
        set({
        functions: [],
        selectedFunctionId: null,
        isLoading: false,
        error: null,
        filters: { origin: 'all', language: 'all', isEnabled: 'all', search: '' },
        sandboxResult: null,
        isSandboxRunning: false,
        sandboxError: null,
        functionRuns: [],
        functionRunsPagination: { page: 1, limit: 20, total: 0, totalPages: 1, sortBy: 'createdAt', sortOrder: 'desc' },
        isFunctionRunsLoading: false,
        functionRunsError: null,
        artifactPreview: null,
        isArtifactPreviewLoading: false,
        artifactPreviewError: null,
        buildResult: null,
        isBuilding: false,
        buildError: null,
        runtimeHealth: null,
        runtimeCompatibility: null,
        activeWorkspace: null,
        isRuntimeHealthLoading: false,
        runtimeHealthError: null,
    });
    }
}));
