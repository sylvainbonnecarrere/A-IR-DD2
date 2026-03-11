/**
 * FunctionEditorTab — Éditeur Monaco + SandboxConsole (J4)
 *
 * Fonctionnalités :
 *   - Éditeur Monaco avec langage Python ou TypeScript
 *   - Vérification syntaxique en temps réel (debounce 800ms)
 *   - Exécution sandbox via POST /api/sandbox/run
 *   - Console d'affichage des résultats (stdout/stderr/output)
 *   - Sauvegarde du code inline via PUT /api/functions/:id
 *   - CodingAgentPanel (prompt → génération LLM de code) — placeholder J8
 *
 * Couleur Phil : cyan-500
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { OnChange, OnMount } from '@monaco-editor/react';
import { useFunctionStore } from '../stores/useFunctionStore';
import { useNotifications } from '../contexts/NotificationContext';
import type { SandboxRunResult } from '../types/function.types';

// ─── SandboxConsole ────────────────────────────────────────────────────────────
interface SandboxConsoleProps {
    result: SandboxRunResult | null;
    isRunning: boolean;
    error: string | null;
}

const SandboxConsole: React.FC<SandboxConsoleProps> = ({ result, isRunning, error }) => {
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
                    {result.timedOut && <span className="text-yellow-400">⏱ Timeout</span>}
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

            {/* Stderr / Error */}
            {(result?.stderr || error) && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">Erreur</div>
                    <pre className="text-red-300 overflow-x-auto whitespace-pre-wrap break-words">
                        {result?.stderr || error}
                    </pre>
                </div>
            )}

            {/* Stdout (si pas success mais stdout dispo) */}
            {result?.stdout && !result.success && (
                <div className="px-3 py-2">
                    <div className="text-gray-500 mb-1 text-xs uppercase tracking-wider">Stdout</div>
                    <pre className="text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">
                        {result.stdout}
                    </pre>
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
        sandboxResult,
        isSandboxRunning,
        sandboxError,
    } = useFunctionStore();

    const { addNotification } = useNotifications();
    const fn = getSelectedFunction();

    const [code, setCode] = useState<string>('');
    const [testArgsStr, setTestArgsStr] = useState<string>('{}');
    const [testArgsValid, setTestArgsValid] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [syntaxErrors, setSyntaxErrors] = useState<Array<{ line?: number; message: string }>>([]);
    const [isConsolePanelOpen, setIsConsolePanelOpen] = useState(true);
    const syntaxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Charger le code de la fonction sélectionnée
    useEffect(() => {
        if (fn?.codeInline != null) {
            setCode(fn.codeInline);
        } else {
            setCode('');
        }
        clearSandboxResult();
        setSyntaxErrors([]);
    }, [fn?._id]);

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

    // Sauvegarder
    const handleSave = async () => {
        if (!fn || fn.isReadonly) return;
        setIsSaving(true);
        const updated = await updateFunction(fn._id, { codeInline: code });
        setIsSaving(false);
        if (updated) {
            addNotification({ type: 'success', title: 'Sauvegardé', message: `"${fn.name}" sauvegardée.` });
        }
    };

    // Exécuter dans le sandbox
    const handleRun = async () => {
        if (!fn) return;

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
                        disabled={isSandboxRunning}
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
                <div className="flex-1 overflow-hidden">
                    <Editor
                        height="100%"
                        language={monacoLanguage}
                        value={code}
                        onChange={handleCodeChange}
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

                {/* Panneau droit : Console + Args */}
                <div className="w-72 flex flex-col border-l border-gray-700/50 flex-shrink-0">
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

                    {/* Input Schema Preview */}
                    {fn.inputSchema && Object.keys(fn.inputSchema).length > 0 && (
                        <div className="border-t border-gray-700/40 p-3">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                                Schéma attendu
                            </p>
                            <div className="space-y-1">
                                {Object.entries(
                                    (fn.inputSchema as { properties?: Record<string, { type: string; description?: string }> })
                                        .properties ?? {}
                                ).slice(0, 5).map(([key, val]) => (
                                    <div key={key} className="flex gap-2 text-xs">
                                        <span className="font-mono text-cyan-400/80 flex-shrink-0">{key}</span>
                                        <span className="text-gray-600">{(val as any).type}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FunctionEditorTab;
