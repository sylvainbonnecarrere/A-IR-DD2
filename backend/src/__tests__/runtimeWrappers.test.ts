import { existsSync } from 'fs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { buildPythonNativeWrapper } from '../services/runtime/runtimeWrappers';

function resolveWorkspaceRoot(): string {
    return path.resolve(__dirname, '../../../');
}

function appendCandidate(candidates: string[], candidate?: string | null): void {
    const normalizedCandidate = candidate?.trim();
    if (!normalizedCandidate || candidates.includes(normalizedCandidate)) {
        return;
    }

    candidates.push(normalizedCandidate);
}

function resolveVirtualEnvPython(virtualEnv: string): string {
    return process.platform === 'win32'
        ? path.join(virtualEnv, 'Scripts', 'python.exe')
        : path.join(virtualEnv, 'bin', 'python');
}

function looksLikePath(candidate: string): boolean {
    return candidate.includes(path.sep) || candidate.includes('/') || candidate.includes('\\');
}

function isPythonExecutableAvailable(candidate: string): boolean {
    if (looksLikePath(candidate) && !existsSync(candidate)) {
        return false;
    }

    const probe = spawnSync(candidate, ['--version'], {
        stdio: 'ignore',
        windowsHide: true,
    });

    return !probe.error && probe.status === 0;
}

function resolvePythonExecutable(workspaceRoot: string): string {
    const candidates: string[] = [];
    appendCandidate(candidates, process.env.PYTHON_BIN);
    appendCandidate(candidates, process.env.PYTHON_EXECUTABLE);

    if (process.env.VIRTUAL_ENV) {
        appendCandidate(candidates, resolveVirtualEnvPython(process.env.VIRTUAL_ENV));
    }

    appendCandidate(candidates, resolveVirtualEnvPython(path.join(workspaceRoot, '.venv')));
    appendCandidate(candidates, 'python3');
    appendCandidate(candidates, 'python');

    const resolvedCandidate = candidates.find(isPythonExecutableAvailable);
    if (resolvedCandidate) {
        return resolvedCandidate;
    }

    throw new Error(
        `Python runtime not found. Set PYTHON_BIN or PYTHON_EXECUTABLE, activate a virtual environment, or install python3/python. Checked candidates: ${candidates.join(', ')}`,
    );
}

async function runPythonWrapper(
    pythonExecutable: string,
    wrapper: string,
    workspaceRoot: string,
    stdinPayload: string,
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(pythonExecutable, ['-c', wrapper], {
            cwd: workspaceRoot,
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                SANDBOX_WORKSPACE_DIR: workspaceRoot,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) {
                return;
            }

            settled = true;
            child.kill();
            reject(new Error('Python native wrapper test timed out'));
        }, 30_000);

        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            reject(error);
        });

        child.on('close', (exitCode) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);

            if ((exitCode ?? 1) !== 0) {
                reject(new Error(`Python wrapper exited with code ${exitCode}: ${stderr}`));
                return;
            }

            resolve({ stdout, stderr });
        });

        child.stdin.write(stdinPayload);
        child.stdin.end();
    });
}

describe('buildPythonNativeWrapper', () => {
    it('captures tool stdout and preserves a valid final JSON envelope', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'airdd2-native-wrapper-'));

        try {
            fs.writeFileSync(path.join(tempRoot, 'runner.py'), [
                'from dataclasses import dataclass',
                '',
                '@dataclass',
                'class FunctionContext:',
                '    workspace_dir: str',
                '    function_name: str',
                '    private_context: dict',
                '',
                'def noisy_tool(context, args):',
                '    print("hidden diagnostic line")',
                '    return {"echoed": args.get("value")}',
                '',
                'FUNCTION_REGISTRY = {"noisy_tool": noisy_tool}',
            ].join('\n'));

            const wrapper = buildPythonNativeWrapper(tempRoot);
            const stdinPayload = JSON.stringify({
                functionName: 'noisy_tool',
                toolVersionTag: '1',
                args: { value: 'hello' },
                privateContext: {}
            });

            const { stdout, stderr } = await runPythonWrapper(
                pythonExecutable,
                wrapper,
                workspaceRoot,
                stdinPayload,
            );

            expect(stderr).toBe('');

            const payload = JSON.parse(stdout.trim()) as {
                success: boolean;
                output: { echoed: string };
                stdout: string;
            };

            expect(payload).toEqual({
                success: true,
                output: { echoed: 'hello' },
                stdout: 'hidden diagnostic line',
            });
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

});