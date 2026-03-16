/**
 * Service — Sandbox d'exécution sécurisée des fonctions (Tools V2)
 *
 * Stratégie d'exécution selon le langage :
 *   - Python  : sous-processus vers `backend/python/runner.py`
 *               (timeout 15s, sortie JSON stdout, erreurs stderr)
 *   - TypeScript : sous-processus Node.js avec environnement réduit
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
    // C9.1: Exécutable Python détecté dynamiquement (python3 ou python selon l'OS)
    private pythonExecutable: string = 'python3';
    private pythonDetected: boolean = false;

    /**
     * Vérifie la disponibilité du sandbox Python.
     * Détecte l'exécutable python3 ou python disponible sur l'OS courant.
     * Windows utilise souvent 'python', Linux/Mac 'python3'.
     */
    async checkHealth(): Promise<{
        python: { available: boolean; version?: string; executable: string };
        typescript: { available: boolean; engine: 'node-subprocess' };
    }> {
        const pythonResult = await this._detectPython();
        return {
            python: pythonResult,
            typescript: { available: true, engine: 'node-subprocess' }
        };
    }

    /**
     * Détecte l'exécutable Python disponible (python3 > python).
     * Met en cache le résultat dans this.pythonExecutable.
     */
    private async _detectPython(): Promise<{ available: boolean; version?: string; executable: string }> {
        for (const exe of ['python3', 'python']) {
            try {
                const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
                    const proc = spawn(exe, ['--version']);
                    let stdout = '';
                    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
                    proc.stderr.on('data', (d: Buffer) => { stdout += d.toString(); }); // python --version écrit sur stderr
                    proc.on('close', (code) => resolve({ code: code ?? 1, stdout }));
                    proc.on('error', () => resolve({ code: 1, stdout: '' }));
                });
                if (result.code === 0) {
                    this.pythonExecutable = exe;
                    this.pythonDetected = true;
                    return { available: true, version: result.stdout.trim(), executable: exe };
                }
            } catch { /* essayer le suivant */ }
        }
        return { available: false, executable: 'python3' };
    }

    /**
     * S'assure que l'exécutable Python est détecté avant utilisation.
     */
    private async _ensurePythonDetected(): Promise<void> {
        if (!this.pythonDetected) {
            await this._detectPython();
        }
    }

    /**
     *
     * @throws Error si la fonction est introuvable, désactivée, ou si le timeout est dépassé
     */
    async runFunction(
        functionId: string,
        userId: string,
        testArgs: Record<string, unknown> = {}
    ): Promise<SandboxResult> {
        // 1. Charger la fonction depuis la BDD
        // C9.1 FIX: S'assurer que Python est détecté avant execution
        await this._ensurePythonDetected();

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

            const pythonArgs = fn.origin === 'native'
                ? [PYTHON_RUNNER_PATH, fn.name, argsJson]
                : [PYTHON_RUNNER_PATH, fn.name, argsJson];

            // C9.1 FIX: utiliser l'exécutable détecté (python3 ou python)
            const proc = spawn(this.pythonExecutable, pythonArgs, {
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
            // C9.1 FIX: utiliser l'exécutable détecté
            const proc = spawn(this.pythonExecutable, ['-c', `
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
    * Exécution TypeScript sandboxée via un sous-processus Node.js à environnement réduit.
     *
     * Contrat du code utilisateur :
     *   - `args` est disponible en global (objet passé à la fonction)
     *   - `console.log/error/warn` sont capturés dans stdout
     *   - Si l'utilisateur définit `function run(args) {...}`, son retour devient l'output
     *   - Sinon, toute valeur assignée à `__result__` en dernière ligne est l'output
     */
    private async _runTypescript(
        fn: IUserFunction,
        args: Record<string, unknown>
    ): Promise<SandboxResult> {
        const startTime = Date.now();
        const timeoutMs = parseInt(process.env.FUNCTION_SANDBOX_TIMEOUT_MS || '15000');
        return this._runTypescriptSubprocess(fn, args, timeoutMs, startTime);
    }

    /**
     * Exécution TypeScript dans un child process Node.js avec environment vidé.
     * Protège MongoDB credentials, JWT_SECRET, etc. (process env non transmis).
     * Timeout piloté par SIGTERM (fiable cross-platform).
     *
     * Contrat identique : fonction `run(args)` ou code libre avec `__result__`.
     */
    private _runTypescriptSubprocess(
        fn: IUserFunction,
        args: Record<string, unknown>,
        timeoutMs: number,
        startTime: number
    ): Promise<SandboxResult> {
        return new Promise((resolve) => {
            const argsJson = JSON.stringify(args).replace(/\\/g, '\\\\').replace(/`/g, '\\`');

            // Wrapper minimal : console redirigé, run() appelé ou code libre
            const wrapper = `
const args = ${argsJson};
const __logs = [];
const console = {
    log:   (...a) => __logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')),
    error: (...a) => __logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')),
    warn:  (...a) => __logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')),
};
let __result__ = undefined;
try {
    ${fn.codeInline || ''}
    if (typeof run === 'function') { __result__ = run(args); }
    process.stdout.write(JSON.stringify({ success: true, output: __result__, stdout: __logs.join('\\n') }));
} catch(e) {
    process.stdout.write(JSON.stringify({ success: false, output: null, stderr: e.message, stdout: __logs.join('\\n') }));
}`;

            const proc = spawn(process.execPath, ['--eval', wrapper], {
                // Env vidé : aucun accès aux secrets MONGODB_URI / JWT_SECRET / ENCRYPTION_KEY
                env: {
                    HOME: process.env.HOME ?? '',
                    TMP: process.env.TMP ?? '',
                    TEMP: process.env.TEMP ?? '',
                    ...(process.platform === 'win32'
                        ? { USERPROFILE: process.env.USERPROFILE ?? '' }
                        : {}),
                }
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
            proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
            }, timeoutMs);

            proc.on('close', () => {
                clearTimeout(timer);
                const durationMs = Date.now() - startTime;

                if (timedOut) {
                    resolve({ success: false, output: null, stderr: 'Timeout: exécution TypeScript dépassée', durationMs, timedOut: true });
                    return;
                }

                try {
                    const result = JSON.parse(stdout) as SandboxResult;
                    resolve({ ...result, durationMs });
                } catch {
                    resolve({
                        success: false,
                        output: null,
                        stderr: stderr || `Sortie JSON invalide: ${stdout.slice(0, 200)}`,
                        durationMs
                    });
                }
            });

            proc.on('error', (err: Error) => {
                clearTimeout(timer);
                resolve({
                    success: false,
                    output: null,
                    stderr: `Erreur démarrage sandbox Node: ${err.message}`,
                    durationMs: Date.now() - startTime
                });
            });
        });
    }
}
