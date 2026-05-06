import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function parseLastJsonLine<T>(stdout: string): T {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    return JSON.parse(lines[lines.length - 1]) as T;
}

function resolveWorkspaceRoot(): string {
    return path.resolve(__dirname, '../../../');
}

function resolvePythonExecutable(workspaceRoot: string): string {
    return process.platform === 'win32'
        ? path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(workspaceRoot, '.venv', 'bin', 'python');
}

describe('integration: web_search_py with hidden-llm mock', () => {
    it('uses the hidden-llm mock to transform query and builds engine_query_plans', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        // start mock server from test-utils
        // require via resolved path to avoid jest path issues
        const mockModulePath = path.join(workspaceRoot, 'backend', 'test-utils', 'hidden_llm_mock_server.js');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { startMockServer } = require(mockModulePath);
        const server = await startMockServer({ port: 0, defaultScenario: 'success' });

        const completion_api_url = `${server.url}/api/web-search/hidden-llm/complete`;

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

seen_queries = []

class FakeDDGS:
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, backend=None, **kwargs):
        engine_query = query or keywords
        seen_queries.append({
            'query': engine_query,
            'backend': backend,
            'region': region,
            'safesearch': safesearch,
        })
        return []

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True

result = web_search_py.run(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            'web_search': {
                'params': {
                    'allowed_domains': ['meteofrance.com'],
                    'query_transformation': 'Q={{user_query}}',
                    'web_engine_search': True,
                    'web_engine': 'duckduckgo.com',
                    'web_engine_nb_result_select': 2,
                },
                'llm_runtime': {
                    'provider': 'LLM local (on premise)',
                    'model': 'mock-model',
                    'endpoint': '${server.url}',
                    'transport': 'application-backend',
                    'completion_api_url': '${completion_api_url}',
                    'auth_token': 'jwt-hidden-token',
                }
            }
        }
    ),
    {
        'query': 'Donne la météo pour demain à Paris',
        'num_results': 5,
        'language': 'fr',
        'safe_search': True,
    },
)

print(json.dumps({'result': result, 'seen_queries': seen_queries}, ensure_ascii=False))
        `;

        try {
            const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
                cwd: workspaceRoot,
                timeout: 60000,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            });

            // allow stderr diagnostics from the hidden-LLM client (start/success events)
            // This test posts to the mock directly, so no hidden-LLM client diagnostics expected on stderr

            const payload = parseLastJsonLine<{ result: any; seen_queries: any[] }>(stdout);

            // The mock returns a short transformed query by default; ensure it's propagated
            expect(typeof payload.result.transformed_query_raw).toBe('string');
            expect(payload.result.transformed_query_raw.length).toBeGreaterThan(0);

            // Ensure engine_query_plans built from transformed_query_raw and allowed_domains
            expect(payload.result.engine_query_plans).toBeDefined();
            expect(payload.result.engine_query_plans.length).toBeGreaterThan(0);
            const plan = payload.result.engine_query_plans[0];
            expect(plan.engine_query_text).toContain(payload.result.transformed_query_raw.split(' ')[0]);
            expect(plan.engine).toBe('duckduckgo.com');

        } finally {
            await server.close();
        }
    }, 30000);

    it('two-step: explicit transform_query then execute in python sandbox flow', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const mockModulePath = path.join(workspaceRoot, 'backend', 'test-utils', 'hidden_llm_mock_server.js');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { startMockServer } = require(mockModulePath);
        const server = await startMockServer({ port: 0, defaultScenario: 'success' });

        const completion_api_url = `${server.url}/api/web-search/hidden-llm/complete`;

        const pythonSnippet = `
import json
import sys
import urllib.request

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

def post_json(url, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))

# Step 1: explicit transform via hidden-llm mock
resp = post_json('${completion_api_url}', {})
transformed = resp.get('text') if isinstance(resp, dict) else None
if not transformed:
    transformed = 'météo demain Paris'

# Step 2: execute pipeline using transformed query
seen_queries = []

class FakeDDGS:
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, backend=None, **kwargs):
        engine_query = query or keywords
        seen_queries.append({
            'query': engine_query,
            'backend': backend,
            'region': region,
            'safesearch': safesearch,
        })
        return []

def fake_transform(context, user_query, *, system_context, runtime_params):
    return {
        'normalized_query': transformed,
        'queries': [transformed],
        'english_queries': [],
        'must_include_terms': [],
        'exclude_terms': [],
        'raw_output': transformed,
        'transformed_query_raw': transformed,
        'mode': 'llm',
    }

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
import native.web_search_presearch as presearch
presearch.transform_query = fake_transform

result = web_search_py.run(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            'web_search': {
                'params': {
                    'allowed_domains': ['meteofrance.com'],
                    'query_transformation': 'Q={{user_query}}',
                    'web_engine_search': True,
                    'web_engine': 'duckduckgo.com',
                    'web_engine_nb_result_select': 2,
                },
                'llm_runtime': {
                    'provider': 'LLM local (on premise)',
                    'model': 'mock-model',
                    'endpoint': '${server.url}',
                    'transport': 'application-backend',
                    'completion_api_url': '${completion_api_url}',
                }
            }
        }
    ),
    {
        'query': 'Donne la météo pour demain à Paris',
        'num_results': 5,
        'language': 'fr',
        'safe_search': True,
    },
)

print(json.dumps({'transformed': transformed, 'result': result, 'seen_queries': seen_queries}, ensure_ascii=False))
        `;

        try {
            const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
                cwd: workspaceRoot,
                timeout: 60000,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            });

            // This test calls the mock directly via HTTP, so no hidden-LLM client diagnostics are expected on stderr

            const payload = parseLastJsonLine<{ transformed: string; result: any; seen_queries: any[] }>(stdout);

            expect(payload.transformed).toBeTruthy();
            expect(payload.result.transformed_query_raw).toBe(payload.transformed);
            expect(Array.isArray(payload.result.engine_query_plans)).toBe(true);
            expect(payload.result.engine_query_plans.length).toBeGreaterThan(0);
        } finally {
            await server.close();
        }
    }, 60000);
});
