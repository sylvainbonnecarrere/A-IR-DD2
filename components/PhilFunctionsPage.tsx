/**
 * PhilFunctionsPage — Bibliothèque de Fonctions Personnalisées (Tools V2)
 *
 * Page principale du robot Phil (path: /phil/functions).
 * Deux onglets :
 *   1. Bibliothèque  — FunctionLibraryTab  : liste, filtres, cartes, toggle
 *   2. Éditeur       — FunctionEditorTab   : Monaco editor + SandboxConsole (J4)
 *
 * Couleur Phil : cyan-500
 */

import React, { useEffect, useState } from 'react';
import { useFunctionStore } from '../stores/useFunctionStore';
import { useDesignStore } from '../stores/useDesignStore';
import { useNotifications } from '../contexts/NotificationContext';
import { useAuth } from '../hooks/useAuth';
import { FunctionEditorTab } from './FunctionEditorTab';
import { SandboxHealthLoader } from './SandboxHealthLoader';
import type { UserFunction, FunctionOrigin, FunctionLanguage, RuntimeCompatibilityContext } from '../types/function.types';

// ─── Icônes inline ────────────────────────────────────────────────────────────
const PyIcon = () => (
    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-500/30">PY</span>
);
const TsIcon = () => (
    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-900/60 text-yellow-300 border border-yellow-500/30">TS</span>
);
const NativeBadge = () => (
    <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-900/40 text-cyan-400 border border-cyan-500/30">native</span>
);
const CustomBadge = () => (
    <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-900/40 text-purple-400 border border-purple-500/30">custom</span>
);

const RuntimeCompatibilityBanner: React.FC<{ runtimeCompatibility: RuntimeCompatibilityContext | null }> = ({ runtimeCompatibility }) => {
    if (!runtimeCompatibility) {
        return null;
    }

    const toneClass = !runtimeCompatibility.executionReady
        ? 'bg-red-950/35 border-red-500/30 text-red-200'
        : runtimeCompatibility.securityLevel === 'dev-only'
            ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
            : 'bg-emerald-950/25 border-emerald-500/25 text-emerald-200';

    const modeLabel = runtimeCompatibility.mode === 'docker-desktop'
        ? 'Docker Desktop'
        : runtimeCompatibility.mode === 'rootless'
            ? 'Docker rootless'
            : runtimeCompatibility.mode === 'rootful-linux'
                ? 'Docker rootful'
                : 'mode inconnu';
    const securityLabel = runtimeCompatibility.securityLevel === 'dev-only'
        ? 'dev-only (dev/test)'
        : runtimeCompatibility.securityLevel;

    return (
        <div className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-xs ${toneClass}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">Compatibilité runtime</span>
                <span>{modeLabel}</span>
                <span>niveau {securityLabel}</span>
                <span>runner {runtimeCompatibility.preferredRunner}</span>
            </div>
            <div className="mt-1 text-[11px] opacity-90">
                {runtimeCompatibility.warning || runtimeCompatibility.summary}
            </div>
        </div>
    );
};

// ─── DeleteConfirmModal ───────────────────────────────────────────────────────
interface DeleteConfirmModalProps {
    fnName: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ fnName, onConfirm, onCancel }) => (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60]">
        <div className="bg-gray-800 border border-red-500/40 rounded-xl p-6 w-96 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <div>
                    <h3 className="text-base font-semibold text-white">Supprimer la fonction</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Cette action est irréversible</p>
                </div>
            </div>
            <p className="text-sm text-gray-300 mb-6">
                Êtes-vous sûr de vouloir supprimer la fonction{' '}
                <span className="font-mono text-red-300">"{fnName}"</span> ?
                <br />
                <span className="text-xs text-gray-500 mt-1 block">Elle ne pourra pas être récupérée.</span>
            </p>
            <div className="flex gap-3">
                <button
                    onClick={onCancel}
                    className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-700/50 transition-colors"
                >
                    Annuler
                </button>
                <button
                    onClick={onConfirm}
                    className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-colors"
                >
                    Supprimer définitivement
                </button>
            </div>
        </div>
    </div>
);

// ─── FunctionCard ─────────────────────────────────────────────────────────────
interface FunctionCardProps {
    fn: UserFunction;
    isSelected: boolean;
    onSelect: () => void;
    onToggle: () => void;
    onDeleteRequest?: () => void;
}

const FunctionCard: React.FC<FunctionCardProps> = ({
    fn,
    isSelected,
    onSelect,
    onToggle,
    onDeleteRequest
}) => {
    return (
        <div
            className={`group relative rounded-lg border cursor-pointer transition-all duration-150 p-3 ${
                isSelected
                    ? 'border-cyan-500 bg-cyan-950/40 shadow-lg shadow-cyan-900/20'
                    : 'border-gray-700/50 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
            }`}
            onClick={onSelect}
        >
            {/* Header */}
            <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    {fn.language === 'python' ? <PyIcon /> : <TsIcon />}
                    <span className="font-mono text-sm font-semibold text-gray-100 truncate">
                        {fn.name}
                    </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {fn.origin === 'native' ? <NativeBadge /> : <CustomBadge />}
                    {/* Toggle switch */}
                    <button
                        onClick={e => { e.stopPropagation(); onToggle(); }}
                        className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                            fn.isEnabled ? 'bg-cyan-500' : 'bg-gray-600'
                        }`}
                        title={fn.isEnabled ? 'Désactiver' : 'Activer'}
                        aria-label={fn.isEnabled ? 'Désactiver la fonction' : 'Activer la fonction'}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            fn.isEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                    </button>
                </div>
            </div>

            {/* Description */}
            <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                {fn.description}
            </p>

            {/* Tags */}
            {fn.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {fn.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-400">
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {/* Bouton suppression — rangée dédiée sous la carte (custom uniquement) */}
            {fn.origin === 'custom' && !fn.isReadonly && onDeleteRequest && (
                <div className="mt-2 pt-2 border-t border-gray-700/40 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={e => { e.stopPropagation(); onDeleteRequest(); }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-900/30 hover:bg-red-800/50 border border-red-700/40 hover:border-red-600/60 text-red-400 hover:text-red-300 text-xs transition-all"
                        title="Supprimer définitivement cette fonction"
                    >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Supprimer
                    </button>
                </div>
            )}
        </div>
    );
};

// ─── FunctionLibraryTab ───────────────────────────────────────────────────────
const FunctionLibraryTab: React.FC = () => {
    const {
        isLoading,
        error,
        selectedFunctionId,
        filters,
        loadFunctions,
        selectFunction,
        toggleFunction,
        deleteFunction,
        setFilter,
        getFilteredFunctions,
        createFunction,
        runtimeCompatibility,
    } = useFunctionStore();

    const { addNotification } = useNotifications();
    const { isAuthenticated } = useAuth();
    const currentWorkflowId = useDesignStore((state) => state.currentWorkflowId);
    const activeWorkflow = useDesignStore((state) => state.getActiveWorkflow());
    const [isCreating, setIsCreating] = useState(false);
    const [newFnName, setNewFnName] = useState('');
    const [newFnDesc, setNewFnDesc] = useState('');
    const [newFnLang, setNewFnLang] = useState<FunctionLanguage>('python');
    const [nameTouched, setNameTouched] = useState(false);
    const [descTouched, setDescTouched] = useState(false);
    const [pendingDeleteFn, setPendingDeleteFn] = useState<UserFunction | null>(null);
    // C6: état pour la modal de consentement bash_py
    const [bashPyConsentTarget, setBashPyConsentTarget] = useState<string | null>(null);

    // Règles miroir du schéma Zod backend (createFunctionSchema)
    const NAME_REGEX = /^[a-z][a-z0-9_]*$/;
    const nameValue = newFnName.trim();
    const descValue = newFnDesc.trim();
    const nameError: string | null =
        !nameValue ? 'Le nom est obligatoire.' :
        nameValue.length < 2 ? 'Minimum 2 caractères.' :
        nameValue.length > 64 ? 'Maximum 64 caractères.' :
        !NAME_REGEX.test(nameValue) ? 'Format requis : snake_case — lettres minuscules, chiffres et _ uniquement, commençant par une lettre.' :
        null;
    const descError: string | null =
        !descValue ? 'La description est obligatoire.' :
        descValue.length < 10 ? `Minimum 10 caractères (${descValue.length}/10).` :
        descValue.length > 500 ? 'Maximum 500 caractères.' :
        null;

    useEffect(() => {
        if (isAuthenticated) {
            loadFunctions(currentWorkflowId ?? undefined);
        }
    }, [loadFunctions, isAuthenticated, currentWorkflowId]);

    // ── Bannière invité ──────────────────────────────────────────────────────
    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
                <div className="w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
                    <svg className="w-7 h-7 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                </div>
                <div>
                    <p className="text-gray-300 font-medium mb-1">Utilisateur invité</p>
                    <p className="text-sm text-gray-500">
                        Veuillez vous connecter pour accéder aux fonctions personnalisées.
                    </p>
                </div>
                <div className="flex items-center gap-2 mt-1 px-4 py-2 rounded-lg bg-gray-800/60 border border-gray-700/50 text-xs text-gray-500">
                    <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Connexion requise
                </div>
            </div>
        );
    }

    const filteredFns = getFilteredFunctions();
    const nativeCount = filteredFns.filter(f => f.origin === 'native').length;
    const customCount = filteredFns.filter(f => f.origin === 'custom').length;

    const handleDeleteConfirmed = async () => {
        if (!pendingDeleteFn) return;
        const ok = await deleteFunction(pendingDeleteFn._id);
        setPendingDeleteFn(null);
        if (ok) {
            addNotification({ type: 'success', title: 'Fonction supprimée', message: `"${pendingDeleteFn.name}" a été supprimée.` });
        }
    };

    // C6: Handler de toggle enrichi — interception bash_py pour consentement
    const handleToggle = (fn: UserFunction) => {
        if (fn.name === 'bash_py' && !fn.isEnabled) {
            setBashPyConsentTarget(fn._id);
            return;
        }
        toggleFunction(fn._id);
    };

    // C6: Confirmation du consentement bash_py → retry avec allowBashPy: true
    const handleBashPyConsentConfirm = async () => {
        if (!bashPyConsentTarget) return;
        const targetId = bashPyConsentTarget;
        setBashPyConsentTarget(null);
        await toggleFunction(targetId, true);
        addNotification({
            type: 'success',
            title: 'bash_py activée',
            message: 'La fonction shell est maintenant disponible. Docker sandbox requis pour l’exécution.'
        });
    };

    const handleCreate = async () => {
        if (!currentWorkflowId) {
            addNotification({
                type: 'error',
                title: 'Workflow requis',
                message: 'Sélectionnez un workflow actif avant de créer une fonction personnalisée.'
            });
            return;
        }

        setNameTouched(true);
        setDescTouched(true);
        if (nameError || descError) {
            addNotification({ type: 'error', title: 'Formulaire invalide', message: nameError ?? descError ?? 'Corrigez les erreurs.' });
            return;
        }
        const created = await createFunction({
            name: nameValue,
            description: descValue,
            language: newFnLang,
            workflowId: currentWorkflowId,
            codeInline: newFnLang === 'python'
                ? `# Votre fonction ${nameValue}\n\n\ndef run(context, args):\n    \"\"\"\n    ${descValue}\n    \"\"\"\n    # TODO: Implémentez votre logique ici\n    return {"result": "ok"}\n`
                : `// Votre fonction ${nameValue}\n// Accès aux arguments : args.param_name, args.limit, etc.\nexport function run(\n  context: { userId: string; agentId?: string; workflowId?: string; depth: number },\n  args: { [key: string]: unknown }  // Ex: { user_name: string; limit?: number }\n): unknown {\n  // TODO: Implémentez votre logique ici\n  return { result: "ok" };\n}\n`
        });
        if (created) {
            addNotification({ type: 'success', title: 'Fonction créée', message: `"${created.name}" est prête à éditer.` });
            setIsCreating(false);
            setNewFnName('');
            setNewFnDesc('');
            setNameTouched(false);
            setDescTouched(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-3 p-4 border-b border-gray-700/50 flex-shrink-0">
                {/* Search */}
                <div className="flex-1 relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Rechercher une fonction..."
                        value={filters.search ?? ''}
                        onChange={e => setFilter({ search: e.target.value })}
                        className="w-full pl-9 pr-3 py-2 bg-gray-800/60 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
                    />
                </div>

                {/* Filter: Origin */}
                <select
                    value={filters.origin ?? 'all'}
                    onChange={e => setFilter({ origin: e.target.value as FunctionOrigin | 'all' })}
                    className="px-3 py-2 bg-gray-800/60 border border-gray-600/50 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-cyan-500/50"
                >
                    <option value="all">Toutes origines</option>
                    <option value="native">Natives</option>
                    <option value="custom">Custom</option>
                </select>

                {/* Filter: Language */}
                <select
                    value={filters.language ?? 'all'}
                    onChange={e => setFilter({ language: e.target.value as FunctionLanguage | 'all' })}
                    className="px-3 py-2 bg-gray-800/60 border border-gray-600/50 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-cyan-500/50"
                >
                    <option value="all">Tous langages</option>
                    <option value="python">Python</option>
                    <option value="typescript">TypeScript</option>
                </select>

                {/* Create Button */}
                <button
                    onClick={() => setIsCreating(true)}
                    disabled={!currentWorkflowId}
                    title={!currentWorkflowId ? 'Sélectionnez un workflow actif pour créer une fonction.' : undefined}
                    className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed text-gray-900 font-semibold rounded-lg text-sm transition-colors flex-shrink-0"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Nouvelle fonction
                </button>
            </div>

            {/* Stats */}
            <div className="flex gap-4 px-4 py-2 border-b border-gray-700/30 text-xs text-gray-500 flex-shrink-0">
                <span>{filteredFns.length} fonction{filteredFns.length !== 1 ? 's' : ''}</span>
                <span className="text-cyan-500/70">{nativeCount} native{nativeCount !== 1 ? 's' : ''}</span>
                <span className="text-purple-400/70">{customCount} custom</span>
                <span className="text-gray-400/80">workflow {activeWorkflow?.name ?? 'non sélectionné'}</span>
            </div>

            <RuntimeCompatibilityBanner runtimeCompatibility={runtimeCompatibility} />

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {isLoading && !filteredFns.length && (
                    <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                        <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mr-3" />
                        Chargement...
                    </div>
                )}

                {error && (
                    <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/30 text-red-300 text-sm mb-4">
                        {error}
                    </div>
                )}

                {!isLoading && filteredFns.length === 0 && !error && (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm gap-2">
                        <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                        <span>Aucune fonction trouvée</span>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-2">
                    {filteredFns.map(fn => (
                        <FunctionCard
                            key={fn._id}
                            fn={fn}
                            isSelected={fn._id === selectedFunctionId}
                            onSelect={() => selectFunction(fn._id)}
                            onToggle={() => handleToggle(fn)}
                            onDeleteRequest={() => setPendingDeleteFn(fn)}
                        />
                    ))}
                </div>
            </div>

            {/* Modale de confirmation suppression */}
            {pendingDeleteFn && (
                <DeleteConfirmModal
                    fnName={pendingDeleteFn.name}
                    onConfirm={handleDeleteConfirmed}
                    onCancel={() => setPendingDeleteFn(null)}
                />
            )}

            {/* C6: Modal de consentement bash_py */}
            {bashPyConsentTarget !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 border border-red-700/50 rounded-xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-900/50 border border-red-700 flex items-center justify-center flex-shrink-0">
                                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="font-bold text-red-300 text-base">Consentement de sécurité requis</h3>
                                <p className="text-xs text-gray-500">Fonction bash_py — Exécution shell</p>
                            </div>
                        </div>
                        <div className="bg-red-950/40 border border-red-800/30 rounded-lg p-4 mb-4 text-sm text-red-200 space-y-2">
                            <p>⚠️ <strong>bash_py</strong> permet d’exécuter des commandes shell directement sur le système.</p>
                            <ul className="text-xs text-red-300/80 space-y-1 ml-4 list-disc">
                                <li>Sur <strong>Windows</strong> : exécution PowerShell (détection automatique)</li>
                                <li>Sur <strong>Linux/macOS</strong> : exécution Bash</li>
                                <li>Requère un environnement Docker sandbox actif</li>
                                <li>Les commandes dangereuses sont bloquées par whitelist</li>
                            </ul>
                            <p className="text-xs text-yellow-400 mt-2">Cette fonction ne doit être activée que si vous comprenez les risques d’exécution de commandes système.</p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setBashPyConsentTarget(null)}
                                className="flex-1 py-2.5 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-800 transition-colors"
                            >
                                Annuler
                            </button>
                            <button
                                onClick={handleBashPyConsentConfirm}
                                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-colors"
                            >
                                J’accepte, activer bash_py
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Modal */}
            {isCreating && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 w-96 shadow-2xl">
                        <h3 className="text-lg font-semibold text-white mb-4">Nouvelle fonction</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">
                                    Nom <span className="text-red-400">*</span>{' '}
                                    <span className="text-gray-600 font-normal">snake_case, lettres minuscules + chiffres + _</span>
                                </label>
                                <input
                                    type="text"
                                    value={newFnName}
                                    onChange={e => { setNewFnName(e.target.value); setNameTouched(true); }}
                                    onBlur={() => setNameTouched(true)}
                                    placeholder="ma_fonction_py"
                                    className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-sm text-gray-200 font-mono focus:outline-none focus:border-cyan-500/60 ${
                                        nameTouched && nameError ? 'border-red-500/60' : 'border-gray-600'
                                    }`}
                                />
                                {nameTouched && nameError && (
                                    <p className="text-xs text-red-400 mt-1">{nameError}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">
                                    Description <span className="text-red-400">*</span>
                                    <span className="text-gray-600 font-normal ml-1">(min. 10 caractères — obligatoire pour le function calling)</span>
                                </label>
                                <textarea
                                    value={newFnDesc}
                                    onChange={e => { setNewFnDesc(e.target.value); setDescTouched(true); }}
                                    onBlur={() => setDescTouched(true)}
                                    placeholder="Décrivez ce que fait cette fonction..."
                                    rows={3}
                                    className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60 resize-none ${
                                        descTouched && descError ? 'border-red-500/60' : 'border-gray-600'
                                    }`}
                                />
                                {descTouched && descError && (
                                    <p className="text-xs text-red-400 mt-1">{descError}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Langage</label>
                                <div className="flex gap-2">
                                    {(['python', 'typescript'] as FunctionLanguage[]).map(lang => (
                                        <button
                                            key={lang}
                                            onClick={() => setNewFnLang(lang)}
                                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                newFnLang === lang
                                                    ? 'bg-cyan-500/20 border border-cyan-500 text-cyan-300'
                                                    : 'bg-gray-700 border border-gray-600 text-gray-400 hover:border-gray-500'
                                            }`}
                                        >
                                            {lang === 'python' ? '🐍 Python' : '📘 TypeScript'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => { setIsCreating(false); setNewFnName(''); setNewFnDesc(''); setNameTouched(false); setDescTouched(false); }}
                                className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-700/50 transition-colors"
                            >
                                Annuler
                            </button>
                            <button
                                onClick={handleCreate}
                                className="flex-1 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-gray-900 font-semibold text-sm transition-colors"
                            >
                                Créer
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── FunctionDetailPanel ──────────────────────────────────────────────────────
// Panneau latéral droit — affiche les détails de la fonction sélectionnée
// et le lien vers l'éditeur Monaco (J4)
const FunctionDetailPanel: React.FC<{ onOpenEditor: () => void }> = ({ onOpenEditor }) => {
    const { getSelectedFunction, updateFunction, activeWorkspace } = useFunctionStore();
    const { addNotification } = useNotifications();
    const fn = getSelectedFunction();

    const [editDesc, setEditDesc] = useState('');
    const [isSavingDesc, setIsSavingDesc] = useState(false);

    // Synchronise l'édition locale quand la fonction sélectionnée change
    useEffect(() => {
        setEditDesc(fn?.description ?? '');
    }, [fn?._id]);

    if (!fn) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-2 p-8">
                <svg className="w-12 h-12 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <p className="text-center">Sélectionnez une fonction<br />pour voir ses détails</p>
            </div>
        );
    }

    const descChanged = editDesc.trim() !== fn.description.trim();

    const handleSaveDesc = async () => {
        if (!editDesc.trim()) {
            addNotification({ type: 'error', title: 'Description requise', message: 'La description ne peut pas être vide.' });
            return;
        }
        setIsSavingDesc(true);
        const updated = await updateFunction(fn._id, { description: editDesc.trim() });
        setIsSavingDesc(false);
        if (updated) {
            addNotification({ type: 'success', title: 'Description mise à jour', message: `"${fn.name}" modifiée.` });
        }
    };

    return (
        <div className="flex flex-col h-full p-4 space-y-4 overflow-y-auto">
            {/* Title */}
            <div>
                <div className="flex items-center gap-2 mb-1">
                    {fn.language === 'python' ? <PyIcon /> : <TsIcon />}
                    {fn.origin === 'native' ? <NativeBadge /> : <CustomBadge />}
                </div>
                <h3 className="text-lg font-mono font-bold text-white">{fn.name}</h3>

                {/* Description — éditable pour les fonctions custom */}
                {fn.isReadonly ? (
                    <p className="text-sm text-gray-400 mt-1 leading-relaxed">{fn.description}</p>
                ) : (
                    <div className="mt-2">
                        <label className="text-xs font-medium text-gray-500 mb-1 block">
                            Description <span className="text-red-400">*</span>
                        </label>
                        <textarea
                            value={editDesc}
                            onChange={e => setEditDesc(e.target.value)}
                            rows={3}
                            className="w-full px-2.5 py-2 bg-gray-900/60 border border-gray-700/60 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-cyan-500/40 resize-none"
                        />
                        {/* C7 FIX: Bouton toujours visible (disabled si rien n'a changé) */}
                        <button
                            onClick={handleSaveDesc}
                            disabled={isSavingDesc || !editDesc.trim() || !descChanged}
                            className={`mt-1.5 flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs transition-all ${
                                descChanged && editDesc.trim()
                                    ? 'bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-400 cursor-pointer'
                                    : 'bg-gray-800/40 border-gray-700/40 text-gray-600 cursor-not-allowed opacity-50'
                            }`}
                            title={descChanged ? 'Enregistrer les modifications' : 'Aucune modification à sauvegarder'}
                        >
                            {isSavingDesc ? (
                                <div className="w-3 h-3 border border-cyan-400/40 border-t-cyan-400 rounded-full animate-spin" />
                            ) : (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                </svg>
                            )}
                            Sauvegarder la description
                        </button>
                    </div>
                )}
            </div>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-800/60 rounded-lg p-2">
                    <div className="text-gray-500 mb-0.5">Version</div>
                    <div className="text-gray-300 font-mono">{fn.version}</div>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-2">
                    <div className="text-gray-500 mb-0.5">Statut</div>
                    <div className={fn.isEnabled ? 'text-green-400' : 'text-red-400'}>
                        {fn.isEnabled ? '● Activée' : '● Désactivée'}
                    </div>
                </div>
                {fn.dependencies.length > 0 && (
                    <div className="col-span-2 bg-gray-800/60 rounded-lg p-2">
                        <div className="text-gray-500 mb-1">Dépendances</div>
                        <div className="flex flex-wrap gap-1">
                            {fn.dependencies.map(dep => (
                                <span key={dep} className="font-mono text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
                                    {dep}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                {(fn.workspaceContext || activeWorkspace) && (
                    <div className="col-span-2 bg-gray-800/60 rounded-lg p-2">
                        <div className="text-gray-500 mb-1">Workspace</div>
                        <div className="space-y-1 text-gray-300">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-gray-500">Racine logique</span>
                                <span className="font-mono text-[11px] truncate">{fn.workspaceContext?.logicalRoot ?? activeWorkspace?.logicalRoot}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-gray-500">Statut</span>
                                <span className="text-[11px] uppercase tracking-wide">{fn.workspaceContext?.status ?? activeWorkspace?.status}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-gray-500">Source root</span>
                                <span className="font-mono text-[11px] truncate">{fn.workspaceContext?.runtimeRoots.sourceRoot ?? activeWorkspace?.runtimeRoots.sourceRoot}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Input Schema Preview */}
            {fn.inputSchema && Object.keys(fn.inputSchema).length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Schéma d'entrée</h4>
                    <pre className="text-xs bg-gray-900/80 border border-gray-700/50 rounded-lg p-3 overflow-x-auto text-gray-300 max-h-40">
                        {JSON.stringify(fn.inputSchema, null, 2)}
                    </pre>
                </div>
            )}

            {/* CTA — Ouvrir éditeur */}
            {!fn.isReadonly && (
                <button
                    onClick={onOpenEditor}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500/60 text-cyan-400 rounded-lg text-sm font-medium transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Ouvrir dans l'éditeur
                </button>
            )}
            {fn.isReadonly && (
                <div className="text-xs text-gray-500 text-center py-2 border border-gray-700/40 rounded-lg">
                    🔒 Fonction native — lecture seule
                </div>
            )}
        </div>
    );
};

// ─── PhilFunctionsPage ────────────────────────────────────────────────────────
type TabId = 'library' | 'editor';

export const PhilFunctionsPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabId>('library');
    const { selectedFunctionId } = useFunctionStore();

    const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
        {
            id: 'library',
            label: 'Bibliothèque',
            icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
            )
        },
        {
            id: 'editor',
            label: 'Éditeur',
            icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
            )
        }
    ];

    return (
        <div className="h-full flex flex-col bg-gray-900 text-gray-100">
            {/* Page Header */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-700/70 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                </div>
                <div className="flex-1">
                    <h1 className="text-base font-bold text-white leading-tight">Fonctions Personnalisées</h1>
                    <p className="text-xs text-gray-400">Phil · Bibliothèque de fonctions pour les agents</p>
                </div>
                {/* C9.2: Indicateur sandbox Python */}
                <SandboxHealthLoader />
            </div>

            {/* Tabs */}
            <div className="flex gap-0 border-b border-gray-700/50 flex-shrink-0 px-4 pt-2">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
                            activeTab === tab.id
                                ? 'text-cyan-400 border-cyan-500 bg-cyan-950/30'
                                : 'text-gray-400 border-transparent hover:text-gray-300 hover:bg-gray-800/40'
                        }`}
                    >
                        {tab.icon}
                        {tab.label}
                        {tab.id === 'editor' && selectedFunctionId && (
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                        )}
                    </button>
                ))}
            </div>

            {/* Content — Split view pour la bibliothèque */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'library' && (
                    <div className="h-full flex">
                        {/* Left: Function list */}
                        <div className="w-1/2 border-r border-gray-700/50 relative">
                            <FunctionLibraryTab />
                        </div>
                        {/* Right: Detail panel */}
                        <div className="w-1/2">
                            <FunctionDetailPanel onOpenEditor={() => setActiveTab('editor')} />
                        </div>
                    </div>
                )}

                {activeTab === 'editor' && (
                    <div className="h-full">
                        <FunctionEditorTab />
                    </div>
                )}
            </div>
        </div>
    );
};

export default PhilFunctionsPage;
