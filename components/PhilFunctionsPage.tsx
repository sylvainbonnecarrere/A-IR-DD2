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
import { useNotifications } from '../contexts/NotificationContext';
import { FunctionEditorTab } from './FunctionEditorTab';
import type { UserFunction, FunctionOrigin, FunctionLanguage } from '../types/function.types';

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

// ─── FunctionCard ─────────────────────────────────────────────────────────────
interface FunctionCardProps {
    fn: UserFunction;
    isSelected: boolean;
    onSelect: () => void;
    onToggle: () => void;
    onDelete?: () => void;
}

const FunctionCard: React.FC<FunctionCardProps> = ({
    fn,
    isSelected,
    onSelect,
    onToggle,
    onDelete
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

            {/* Actions — visible au hover pour custom */}
            {!fn.isReadonly && onDelete && (
                <button
                    onClick={e => { e.stopPropagation(); onDelete(); }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 p-1 rounded"
                    title="Supprimer la fonction"
                    aria-label="Supprimer la fonction"
                >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
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
    } = useFunctionStore();

    const { addNotification } = useNotifications();
    const [isCreating, setIsCreating] = useState(false);
    const [newFnName, setNewFnName] = useState('');
    const [newFnDesc, setNewFnDesc] = useState('');
    const [newFnLang, setNewFnLang] = useState<FunctionLanguage>('python');

    useEffect(() => {
        loadFunctions();
    }, [loadFunctions]);

    const filteredFns = getFilteredFunctions();
    const nativeCount = filteredFns.filter(f => f.origin === 'native').length;
    const customCount = filteredFns.filter(f => f.origin === 'custom').length;

    const handleDelete = async (fn: UserFunction) => {
        if (!window.confirm(`Supprimer la fonction "${fn.name}" ? Cette action est irréversible.`)) return;
        const ok = await deleteFunction(fn._id);
        if (ok) {
            addNotification({ type: 'success', title: 'Fonction supprimée', message: `"${fn.name}" a été supprimée.` });
        }
    };

    const handleCreate = async () => {
        if (!newFnName.trim() || !newFnDesc.trim()) {
            addNotification({ type: 'error', title: 'Champs requis', message: 'Le nom et la description sont obligatoires.' });
            return;
        }
        const created = await createFunction({
            name: newFnName.trim(),
            description: newFnDesc.trim(),
            language: newFnLang,
            codeInline: newFnLang === 'python'
                ? `# Votre fonction ${newFnName}\n\n\ndef run(context, args):\n    \"\"\"\n    ${newFnDesc}\n    \"\"\"\n    # TODO: Implémentez votre logique ici\n    return {"result": "ok"}\n`
                : `// Votre fonction ${newFnName}\nexport function run(context: any, args: any) {\n  // TODO: Implémentez votre logique ici\n  return { result: "ok" };\n}\n`
        });
        if (created) {
            addNotification({ type: 'success', title: 'Fonction créée', message: `"${created.name}" est prête à éditer.` });
            setIsCreating(false);
            setNewFnName('');
            setNewFnDesc('');
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
                    className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-900 font-semibold rounded-lg text-sm transition-colors flex-shrink-0"
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
            </div>

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
                            onToggle={() => toggleFunction(fn._id)}
                            onDelete={() => handleDelete(fn)}
                        />
                    ))}
                </div>
            </div>

            {/* Create Modal */}
            {isCreating && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 w-96 shadow-2xl">
                        <h3 className="text-lg font-semibold text-white mb-4">Nouvelle fonction</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">
                                    Nom <span className="text-gray-500">(snake_case)</span>
                                </label>
                                <input
                                    type="text"
                                    value={newFnName}
                                    onChange={e => setNewFnName(e.target.value)}
                                    placeholder="ma_fonction_py"
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 font-mono focus:outline-none focus:border-cyan-500/60"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
                                <textarea
                                    value={newFnDesc}
                                    onChange={e => setNewFnDesc(e.target.value)}
                                    placeholder="Décrivez ce que fait cette fonction..."
                                    rows={3}
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60 resize-none"
                                />
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
                                onClick={() => setIsCreating(false)}
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
    const { getSelectedFunction } = useFunctionStore();
    const fn = getSelectedFunction();

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

    return (
        <div className="flex flex-col h-full p-4 space-y-4 overflow-y-auto">
            {/* Title */}
            <div>
                <div className="flex items-center gap-2 mb-1">
                    {fn.language === 'python' ? <PyIcon /> : <TsIcon />}
                    {fn.origin === 'native' ? <NativeBadge /> : <CustomBadge />}
                </div>
                <h3 className="text-lg font-mono font-bold text-white">{fn.name}</h3>
                <p className="text-sm text-gray-400 mt-1 leading-relaxed">{fn.description}</p>
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

// ─── EditorTabPlaceholder ─────────────────────────────────────────────────────
// Placeholder pour J4 (Monaco Editor)
const EditorTabPlaceholder: React.FC = () => {
    const { getSelectedFunction } = useFunctionStore();
    const fn = getSelectedFunction();

    return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3 p-8">
            <div className="w-16 h-16 rounded-xl bg-gray-800/80 border border-gray-700 flex items-center justify-center">
                <svg className="w-8 h-8 text-cyan-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
            </div>
            <p className="text-center text-sm">
                {fn ? (
                    <>
                        <span className="text-gray-300 font-mono">{fn.name}</span><br />
                        L'éditeur Monaco sera disponible au Jalon J4
                    </>
                ) : (
                    'Sélectionnez une fonction dans la bibliothèque'
                )}
            </p>
            {fn && !fn.isReadonly && fn.codeInline && (
                <pre className="text-xs bg-gray-900/80 border border-gray-700/50 rounded-lg p-4 overflow-auto max-w-full max-h-80 text-gray-300 w-full">
                    {fn.codeInline}
                </pre>
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
                <div>
                    <h1 className="text-base font-bold text-white leading-tight">Fonctions Personnalisées</h1>
                    <p className="text-xs text-gray-400">Phil · Bibliothèque de fonctions pour les agents</p>
                </div>
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
