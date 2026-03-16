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
import apiClient from '../utils/apiClient';
import type {
    UserFunction,
    CreateFunctionPayload,
    UpdateFunctionPayload,
    FunctionFilter,
    SandboxRunResult,
    SyntaxCheckResult,
} from '../types/function.types';

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
    runInSandbox: (functionId: string, testArgs: Record<string, unknown>) => Promise<void>;
    checkSyntax: (language: 'python' | 'typescript', code: string) => Promise<SyntaxCheckResult | null>;
    clearSandboxResult: () => void;

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

    // ─── Charger les fonctions ───────────────────────────────────────────────
    loadFunctions: async (workflowId?: string) => {
        set({ isLoading: true, error: null });
        try {
            const params = new URLSearchParams();
            if (workflowId) params.append('workflowId', workflowId);

            const { data } = await apiClient.get<UserFunction[]>(
                `/api/functions${params.size > 0 ? `?${params}` : ''}`
            );
            set({ functions: data, isLoading: false });
        } catch (err: any) {
            set({
                isLoading: false,
                error: err.response?.data?.error || 'Erreur lors du chargement des fonctions'
            });
        }
    },

    // ─── Créer une fonction custom ───────────────────────────────────────────
    createFunction: async (payload) => {
        set({ isLoading: true, error: null });
        try {
            const { data } = await apiClient.post<UserFunction>('/api/functions', payload);
            set(state => ({
                functions: [...state.functions, data],
                selectedFunctionId: data._id,
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
            const { data } = await apiClient.put<UserFunction>(`/api/functions/${id}`, payload);
            set(state => ({
                functions: state.functions.map(f => f._id === id ? data : f),
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
            await apiClient.delete(`/api/functions/${id}`);
            set(state => ({
                functions: state.functions.filter(f => f._id !== id),
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
            const { data } = await apiClient.patch<{ id: string; isEnabled: boolean }>(
                `/api/functions/${id}/toggle`,
                { allowBashPy }
            );
            set(state => ({
                functions: state.functions.map(f =>
                    f._id === id ? { ...f, isEnabled: data.isEnabled } : f
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
    runInSandbox: async (functionId, testArgs) => {
        set({ isSandboxRunning: true, sandboxError: null, sandboxResult: null });
        try {
            const { data } = await apiClient.post<SandboxRunResult>('/api/sandbox/run', {
                functionId,
                testArgs
            });
            set({ sandboxResult: data, isSandboxRunning: false });
        } catch (err: any) {
            set({
                isSandboxRunning: false,
                sandboxError: err.response?.data?.error || 'Erreur d\'exécution sandbox'
            });
        }
    },

    checkSyntax: async (language, code) => {
        try {
            const { data } = await apiClient.post<SyntaxCheckResult>('/api/sandbox/check', {
                language,
                code
            });
            return data;
        } catch {
            return null;
        }
    },

    clearSandboxResult: () =>
        set({ sandboxResult: null, sandboxError: null }),

    // ─── Optimistic inline code update ───────────────────────────────────────
    updateInlineCodeOptimistic: (id, code) =>
        set(state => ({
            functions: state.functions.map(f =>
                f._id === id ? { ...f, codeInline: code } : f
            )
        })),

    // ─── Reset complet (sécurité : appelé au logout pour ne pas fuiter les données) ─
    resetStore: () => set({
        functions: [],
        selectedFunctionId: null,
        isLoading: false,
        error: null,
        filters: { origin: 'all', language: 'all', isEnabled: 'all', search: '' },
        sandboxResult: null,
        isSandboxRunning: false,
        sandboxError: null,
    })
}));
