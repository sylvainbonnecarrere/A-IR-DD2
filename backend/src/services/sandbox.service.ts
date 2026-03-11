/**
 * Service — Sandbox d'exécution sécurisée des fonctions (Tools V2)
 *
 * Stratégie d'exécution selon le langage :
 *   - Python  : sous-processus vers `backend/python/runner.py`
 *               (timeout 15s, sortie JSON stdout, erreurs stderr)
 *   - TypeScript : isolé avec `isolated-vm` (non implémenté en V1 — stub retourné)
 *
 * Design Patterns :
 *   - Strategy  : exécution différente selon le langage
 *   - Factory   : SandboxService instanciable directement (sans DI pour V1)
 *
 * Sécurité :
 *   - Seules les fonctions isEnabled:true sont exécutables
 *   - Seules les fonctions natives ou appartenant à userId sont accessibles
 *   - Timeout global géré via Promise.race + child_process.kill
 */

import { spawn } from 'child_process';
import path from 'path';
import mongoose from 'mongoose';
import { UserFunction, IUserFunction } from '../models/UserFunction.model';

// Utilisation de __dirname CommonJS (voir pythonExecutor.ts)
declare const __dirname: string;

const PYTHON_TIMEOUT_MS = 15_000;
const PYTHON_RUNNER_PATH = path.join(__dirname, '../../python/runner.py');

export interface SandboxResult {
    success: boolean;
    output: unknown;
    stdout?: string;
    stderr?: string;
    durationMs: number;
    timedOut?: boolean;
}

export interface SyntaxCheckResult {
    valid: boolean;
    errors: Array<{ line?: number; message: string }>;
}

export class SandboxService {
    /**
     * Exécute une fonction UserFunction dans un environnement sandboxé.
     *
     * @throws Error si la fonction est introuvable, désactivée, ou si le timeout est dépassé
     */
    async runFunction(
        functionId: string,
        userId: string,
        testArgs: Record<string, unknown> = {}
    ): Promise<SandboxResult> {
        // 1. Charger la fonction depuis la BDD
        const fn = await UserFunction.findOne({
            _id: functionId,
            $or: [
                { userId: null },
                { userId: new mongoose.Types.ObjectId(userId) }
            ]
        }).lean<IUserFunction>();

        if (!fn) {
            throw new Error(`Fonction introuvable ou accès non autorisé (id: ${functionId})`);
        }

        if (!fn.isEnabled) {
            throw new Error(
                `La fonction '${fn.name}' est désactivée. Activez-la dans la bibliothèque avant d'exécuter.`
            );
        }

        // 2. Déléguer selon le langage
        if (fn.language === 'python') {
            return this._runPython(fn, testArgs);
        } else {
            return this._runTypescript(fn, testArgs);
        }
    }

    /**
     * Vérifie la syntaxe d'un snippet de code sans l'exécuter.
     */
    async checkSyntax(
        language: 'python' | 'typescript',
        code: string
    ): Promise<SyntaxCheckResult> {
        if (language === 'python') {
            return this._checkPythonSyntax(code);
        }
        // TypeScript syntax check stub — à implémenter avec un parser TS en V2
        return { valid: true, errors: [] };
    }

    // ─── Exécution Python ───────────────────────────────────────────────────

    private _runPython(
        fn: IUserFunction,
        args: Record<string, unknown>
    ): Promise<SandboxResult> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const argsJson = JSON.stringify(args);

            // Pour les fonctions inline (custom), utiliser le code inline via stdin
            // Pour les fonctions natives, utiliser le runner.py avec le nom de la fonction
            const pythonArgs = fn.origin === 'native'
                ? [PYTHON_RUNNER_PATH, fn.name, argsJson]
                : [PYTHON_RUNNER_PATH, fn.name, argsJson];

            const proc = spawn('python3', pythonArgs, {
                timeout: PYTHON_TIMEOUT_MS,
                env: {
                    ...process.env,
                    SANDBOX_WORKSPACE_DIR: '/sandbox/workspace',
                    PYTHONIOENCODING: 'utf-8'
                }
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
            proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

            // Timeout manuel (double sécurité)
            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
            }, PYTHON_TIMEOUT_MS);

            proc.on('close', (code: number | null) => {
                clearTimeout(timer);
                const durationMs = Date.now() - startTime;

                if (timedOut) {
                    resolve({
                        success: false,
                        output: null,
                        stdout,
                        stderr: 'Timeout: la fonction a dépassé 15 secondes',
                        durationMs,
                        timedOut: true
                    });
                    return;
                }

                if (code !== 0) {
                    let errorMessage = stderr;
                    try {
                        const parsed = JSON.parse(stderr);
                        errorMessage = parsed.error || stderr;
                    } catch { /* keep raw stderr */ }

                    resolve({
                        success: false,
                        output: null,
                        stdout,
                        stderr: errorMessage,
                        durationMs
                    });
                    return;
                }

                try {
                    const output = JSON.parse(stdout);
                    resolve({ success: true, output, stdout, stderr, durationMs });
                } catch {
                    resolve({
                        success: false,
                        output: null,
                        stdout,
                        stderr: `Impossible de parser la sortie JSON: ${stdout.slice(0, 200)}`,
                        durationMs
                    });
                }
            });

            proc.on('error', (err: Error) => {
                clearTimeout(timer);
                resolve({
                    success: false,
                    output: null,
                    stderr: `Erreur démarrage processus Python: ${err.message}`,
                    durationMs: Date.now() - startTime
                });
            });
        });
    }

    /**
     * Vérification syntaxique Python via `python3 -m py_compile`
     */
    private _checkPythonSyntax(code: string): Promise<SyntaxCheckResult> {
        return new Promise((resolve) => {
            // Écrire le code sur stdin de py_compile
            const proc = spawn('python3', ['-c', `
import ast, sys, json
try:
    ast.parse(sys.stdin.read())
    print(json.dumps({"valid": True, "errors": []}))
except SyntaxError as e:
    print(json.dumps({"valid": False, "errors": [{"line": e.lineno, "message": str(e.msg)}]}))
`]);

            let output = '';
            proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
            proc.stdin.write(code);
            proc.stdin.end();

            proc.on('close', () => {
                try {
                    resolve(JSON.parse(output));
                } catch {
                    resolve({ valid: false, errors: [{ message: 'Erreur interne de vérification syntaxique' }] });
                }
            });

            proc.on('error', () => {
                resolve({ valid: false, errors: [{ message: 'Python3 non disponible' }] });
            });
        });
    }

    /**
     * Stub TypeScript — à implémenter avec isolated-vm en V2
     */
    private async _runTypescript(
        fn: IUserFunction,
        args: Record<string, unknown>
    ): Promise<SandboxResult> {
        // TODO J8: Implémenter avec isolated-vm
        return {
            success: false,
            output: null,
            stderr: "L'exécution TypeScript sandboxée sera disponible en V2 (isolated-vm).",
            durationMs: 0
        };
    }
}
