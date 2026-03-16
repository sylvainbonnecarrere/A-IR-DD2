// backend/src/pythonExecutor.ts
// FIX: Removed the triple-slash directive for node types and added a manual declaration for `__dirname`.
// The `/// <reference types="node" />` directive was causing a "Cannot find type definition file for 'node'" error,
// likely due to an issue with the build environment's type resolution.
// Since this project runs in a CommonJS Node.js environment, `__dirname` is a globally available variable.
// By declaring it manually, we inform TypeScript of its existence and resolve the "Cannot find name '__dirname'" error
// without relying on the broken type reference.
declare const __dirname: string;

import { spawn } from 'child_process';
import path from 'path';
import mongoose from 'mongoose';
import { UserFunction, IUserFunction } from './models/UserFunction.model';
import { WHITELISTED_PYTHON_TOOLS } from './config';

// Path to the Tools V2 runner.py (J7.3)
const PYTHON_RUNNER_PATH = path.join(__dirname, '../python/runner.py');
const PYTHON_TIMEOUT_MS = 15_000;

// The manual calculation of __dirname using ESM features (import.meta.url) has been removed.
// This project is configured as a CommonJS module (see tsconfig.json),
// where `__dirname` is a globally available variable. The previous code created a module-type conflict,
// causing the 'exports is not defined' error.

export const executePythonTool = (toolName: string, args: object): Promise<object> => {
    return new Promise((resolve, reject) => {
        if (!WHITELISTED_PYTHON_TOOLS.includes(toolName)) {
            return reject(new Error(`Tool '${toolName}' is not whitelisted for execution.`));
        }

        // Resolve the path from the current file's directory to the project root, then to the utils folder.
        // This now correctly uses the __dirname provided by the CommonJS environment.
        const scriptPath = path.join(__dirname, `../../../utils/pythonTools/${toolName}.py`);
        const argsJsonString = JSON.stringify(args);

        const pythonProcess = spawn('python3', [scriptPath, argsJsonString]);

        let stdoutData = '';
        let stderrData = '';

        pythonProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`Python script exited with code ${code}. Stderr: ${stderrData}`);
                // Try to parse error from stderr if it's JSON, otherwise use the raw string
                try {
                    const errorJson = JSON.parse(stderrData);
                    return reject(new Error(errorJson.error || `Python script for '${toolName}' failed.`));
                } catch(e) {
                     return reject(new Error(stderrData || `Python script for '${toolName}' failed with exit code ${code}.`));
                }
            }
            if (stderrData) {
                console.warn(`Python script for '${toolName}' wrote to stderr but exited with code 0: ${stderrData}`);
            }
            try {
                const result = JSON.parse(stdoutData);
                resolve(result);
            } catch (error) {
                console.error(`Failed to parse JSON output from python script '${toolName}'. Output: ${stdoutData}`);
                reject(new Error(`Failed to parse JSON output from python script '${toolName}'.`));
            }
        });
        
        pythonProcess.on('error', (err) => {
             console.error(`Failed to start python process for '${toolName}'. Error: ${err.message}`);
             reject(new Error(`Failed to start python process for '${toolName}'. Is Python 3 installed and in your PATH?`));
        });
    });
};

/**
 * J7.4 — Execute a UserFunction (Tools V2) identified by its MongoDB _id.
 *
 * Flow:
 *  1. Load IUserFunction from DB (ownership: native OR belongs to userId)
 *  2. Validate enabled status
 *  3. Spawn runner.py with function name + args JSON
 *  4. Return parsed FunctionResult payload
 *
 * @param fnId    ObjectId string of the UserFunction document
 * @param args    Key/value map of function arguments
 * @param userId  Authenticated user id (for ownership gate)
 * @param agentId Optional agent id for context (audit / logging)
 */
export const executeFunctionById = async (
    fnId: string,
    args: Record<string, unknown>,
    userId: string,
    agentId?: string
): Promise<object> => {
    // --- 1. Load from DB with ownership gate ---
    if (!mongoose.Types.ObjectId.isValid(fnId)) {
        throw new Error(`Invalid function id: ${fnId}`);
    }

    const fn = await UserFunction.findOne({
        _id: new mongoose.Types.ObjectId(fnId),
        $or: [
            { userId: null },                                 // native / shared
            { userId: new mongoose.Types.ObjectId(userId) }  // user-owned
        ]
    }).lean<IUserFunction>();

    if (!fn) {
        throw new Error(`Function '${fnId}' not found or access denied for user '${userId}'.`);
    }
    if (!fn.isEnabled) {
        throw new Error(`Function '${fn.name}' is disabled.`);
    }

    // --- 2. Build sandboxed env context ---
    const workspaceRoot = process.env.WORKSPACE_ROOT ?? '/sandbox';
    const env = {
        ...process.env,
        SANDBOX_WORKSPACE_DIR: `${workspaceRoot}/users/${userId}/workspace`,
        FUNCTION_USER_ID: userId,
        FUNCTION_AGENT_ID: agentId ?? '',
        PYTHONIOENCODING: 'utf-8'
    };

    // --- 3. Spawn runner.py ---
    return new Promise((resolve, reject) => {
        const argsJson = JSON.stringify(args);
        const proc = spawn('python3', [PYTHON_RUNNER_PATH, fn.name, argsJson], { env });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
        proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
        }, PYTHON_TIMEOUT_MS);

        proc.on('close', (code: number | null) => {
            clearTimeout(timer);

            if (timedOut) {
                return reject(new Error(`Function '${fn.name}' timed out after ${PYTHON_TIMEOUT_MS / 1000}s.`));
            }

            if (code !== 0) {
                let errorMessage = stderr;
                try {
                    const parsed = JSON.parse(stderr);
                    errorMessage = parsed.error ?? stderr;
                } catch { /* keep raw stderr */ }
                return reject(new Error(errorMessage || `Function '${fn.name}' failed with exit code ${code}.`));
            }

            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(new Error(`Could not parse JSON output from function '${fn.name}': ${stdout.slice(0, 300)}`));
            }
        });

        proc.on('error', (err: Error) => {
            clearTimeout(timer);
            reject(new Error(`Failed to start Python process for '${fn.name}': ${err.message}`));
        });
    });
};
