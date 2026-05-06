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

    it('dispatches a sandbox-like payload to web_search_py and executes the configured search engine with mock search data', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const nativeRoot = path.join(workspaceRoot, 'backend', 'python');
        const sandboxPayload = {
            functionName: 'web_search_py',
            args: {
                query: 'Quels sont les spectacles cette semaine à Paris dans la salle de Bercy ?',
                num_results: 3,
                language: 'fr',
                safe_search: true,
            },
            privateContext: {
                web_search: {
                    params: {
                        mock_transformed_query: 'spectacles semaine Paris Bercy programmation dates horaires',
                        mock_search_response_html: [
                            '<html>',
                            '  <body>',
                            '    <div id="search">',
                            '      <div class="g">',
                            '        <a href="/url?q=https%3A%2F%2Fwww.accorarena.com%2Ffr%2Fprogrammation%2Fspectacles-bercy&sa=U&ved=1">',
                            '          <h3>Accor Arena Paris Bercy - Programmation</h3>',
                            '        </a>',
                            '        <div>Concerts et spectacles cette semaine à Paris Bercy, dates et horaires.</div>',
                            '      </div>',
                            '    </div>',
                            '  </body>',
                            '</html>',
                        ].join('\n'),
                        query_transformation: 'Q={{user_query}}',
                        reranking_prompt: 'RERANK {{user_query}} {{source_content}}',
                        relevance_threshold: 1,
                        rerank_strategy: 'Fast',
                        web_engine_search: true,
                        web_engine: 'google.com',
                        web_engine_nb_result_select: 3,
                        dig_snippet: false,
                    },
                },
            },
        };
        const pythonSnippet = [
            'import json',
            'import sys',
            '',
            `sys.path.insert(0, ${JSON.stringify(nativeRoot)})`,
            '',
            'from runner import FUNCTION_REGISTRY, FunctionContext',
            '',
            `payload = json.loads(${JSON.stringify(JSON.stringify(sandboxPayload))})`,
            '',
            'context = FunctionContext(',
            "    workspace_dir='.',",
            "    function_name=payload['functionName'],",
            "    private_context=payload['privateContext'],",
            ')',
            "result = FUNCTION_REGISTRY[payload['functionName']](context, payload['args'])",
            "print(json.dumps({'result': result}, ensure_ascii=False))",
        ].join('\n');

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                SANDBOX_WORKSPACE_DIR: workspaceRoot,
            },
        });

        expect(stderr).toBe('');

        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        const payload = JSON.parse(lines[lines.length - 1]) as {
            result: {
                results: Array<{ title: string; url: string }>;
                trace: {
                    transformed_query_raw: string;
                    input: { web_engine: string };
                    engine_query_plans: Array<{ engine_query_url: string }>;
                    engine_execution_trace: Array<{
                        execution_kind: string;
                        requested_url: string;
                        final_url: string;
                        http_status: number;
                        mocked_response?: boolean;
                        status: string;
                    }>;
                    engine_top_results: Array<{ title: string; url: string }>;
                };
            };
        };
        const stdoutEvents = lines.slice(0, -1).map((line) => JSON.parse(line)) as Array<Record<string, unknown>>;
        const googleUrl = 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires';

        expect(payload.result.trace.input.web_engine).toBe('google.com');
        expect(payload.result.trace.transformed_query_raw).toBe('spectacles semaine Paris Bercy programmation dates horaires');
        expect(payload.result.trace.engine_query_plans).toEqual([
            expect.objectContaining({ engine_query_url: googleUrl }),
        ]);
        expect(payload.result.trace.engine_execution_trace).toEqual([
            expect.objectContaining({
                execution_kind: 'http_search_page',
                requested_url: googleUrl,
                final_url: googleUrl,
                http_status: 200,
                mocked_response: true,
                status: 'completed',
            }),
        ]);
        expect(payload.result.trace.engine_top_results).toEqual([
            expect.objectContaining({
                title: 'Accor Arena Paris Bercy - Programmation',
                url: 'https://www.accorarena.com/fr/programmation/spectacles-bercy',
            }),
        ]);
        expect(payload.result.results).toEqual([
            expect.objectContaining({
                title: 'Accor Arena Paris Bercy - Programmation',
                url: 'https://www.accorarena.com/fr/programmation/spectacles-bercy',
            }),
        ]);
        expect(stdoutEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ WEB_SEARCH_DEBUG: 'build_search_plan_start', has_mock_transformed_query: true, web_engine: 'google.com' }),
            expect.objectContaining({ WEB_SEARCH_DEBUG: 'query_transformation_mock', transformed_query_raw: 'spectacles semaine Paris Bercy programmation dates horaires' }),
            expect.objectContaining({ WEB_SEARCH_DEBUG: 'build_search_plan_ready', engine_query_plans: [expect.objectContaining({ engine_query_url: googleUrl })] }),
            expect.objectContaining({ WEB_SEARCH_DEBUG: 'engine_query_dispatch', engine_query_url: googleUrl, execution_kind: 'http_search_page' }),
            expect.objectContaining({ WEB_SEARCH_DEBUG: 'engine_query_result', engine_query_url: googleUrl, status: 'completed', result_count: 1, mocked_response: true }),
            expect.objectContaining({ WEB_SEARCH_DEBUG: 'engine_execution', top_results: [expect.objectContaining({ title: 'Accor Arena Paris Bercy - Programmation' })] }),
        ]));
    });
});