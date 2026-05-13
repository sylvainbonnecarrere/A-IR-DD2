import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildPythonNativeWrapper } from '../services/runtime/runtimeWrappers';

const execFileAsync = promisify(execFile);

function resolveWorkspaceRoot(): string {
    return path.resolve(__dirname, '../../../');
}

function resolvePythonExecutable(workspaceRoot: string): string {
    return process.platform === 'win32'
        ? path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(workspaceRoot, '.venv', 'bin', 'python');
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

            const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', wrapper], {
                cwd: workspaceRoot,
                timeout: 30000,
                input: stdinPayload,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    SANDBOX_WORKSPACE_DIR: workspaceRoot,
                },
            } as any);

            expect(stderr.toString()).toBe('');

            const payload = JSON.parse(stdout.toString().trim()) as {
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