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

describe('web_search_py pipeline components', () => {
    it('builds a bounded system context array with mandatory language and resolved dates', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys
from datetime import date as real_date

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_system_context import build_system_context

class FakeDate(real_date):
    @classmethod
    def today(cls):
        return cls(2026, 4, 28)

context = build_system_context(
    'météo paris demain',
    language='fr',
    location='Paris',
    specialization='weather',
    date_provider=FakeDate,
)

print(json.dumps(context, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as string[];

        expect(Array.isArray(payload)).toBe(true);
        expect(payload.length).toBeLessThanOrEqual(20);
        expect(payload).toEqual(expect.arrayContaining([
            'language:fr',
            'current_date:28/04/2026',
            'relative_today:28/04/2026',
            'relative_tomorrow:29/04/2026',
            'target_date:29/04/2026',
            'location:Paris',
            'specialization:weather',
            'query:météo paris demain',
        ]));
    });

    it('keeps a strict raw transformed query and injects only system context plus user query into the LLM call', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_query_transformation as query_transformation

captured = {}

def fake_complete_text(context, *, system_prompt, user_prompt, timeout, max_tokens, allow_reasoning_retry=True):
    captured['system_prompt'] = system_prompt
    captured['user_prompt'] = user_prompt
    captured['timeout'] = timeout
    captured['max_tokens'] = max_tokens
    captured['allow_reasoning_retry'] = allow_reasoning_retry
    return '   météo Paris demain site officiel   '

query_transformation.complete_text = fake_complete_text

result = query_transformation.transform_query(
    context=None,
    user_query='Cherche sur le web la météo demain à Paris',
    system_context=['language:fr', 'target_date:29/04/2026'],
    runtime_params={
            'llm_runtime': {
                'provider': 'OpenAI',
                'model': 'gpt-test',
                'api_key': 'sk-test',
            },
        'query_transformation': 'Q={{user_query}}',
        'allowed_domains': ['meteofrance.com'],
        'request_list': False,
        'nb_request_transformation': 1,
        'cross_lingual_search': True,
        'fetch_timeout_seconds': 15,
    },
)

print(json.dumps({'captured': captured, 'result': result}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = parseLastJsonLine<{
            captured: { system_prompt: string; user_prompt: string; timeout: number; max_tokens: number; allow_reasoning_retry: boolean };
            result: {
                normalized_query: string;
                transformed_query_raw: string;
                queries: string[];
                english_queries: string[];
                must_include_terms: string[];
                exclude_terms: string[];
                raw_output: string;
                mode: string;
            };
        }>(stdout);

        expect(payload.captured.system_prompt).toBe('');
        expect(payload.captured.user_prompt).toBe('Q=Cherche sur le web la météo demain à Paris');
        expect(payload.captured.user_prompt).not.toContain('CTX=');
        expect(payload.captured.user_prompt).not.toContain('{{system_context}}');
        expect(payload.captured.user_prompt).not.toContain('ALLOWED_DOMAINS');
        expect(payload.captured.user_prompt).not.toContain('NB_REQUEST_TRANSFORMATION');
        expect(payload.captured.timeout).toBe(45);
        expect(payload.captured.max_tokens).toBe(220);
        expect(payload.captured.allow_reasoning_retry).toBe(false);
        expect(payload.result).toEqual({
            normalized_query: 'météo Paris demain site officiel',
            transformed_query_raw: 'météo Paris demain site officiel',
            queries: ['météo Paris demain site officiel'],
            english_queries: [],
            must_include_terms: [],
            exclude_terms: [],
            raw_output: 'météo Paris demain site officiel',
            mode: 'llm',
        });
    });

    it('compacts the legacy default transformation prompt for local runtimes before calling the hidden LLM', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_query_transformation as query_transformation

captured = {}

def fake_complete_text(context, *, system_prompt, user_prompt, timeout, max_tokens, allow_reasoning_retry=True):
    captured['system_prompt'] = system_prompt
    captured['user_prompt'] = user_prompt
    captured['timeout'] = timeout
    captured['allow_reasoning_retry'] = allow_reasoning_retry
    return 'météo paris demain prévisions'

query_transformation.complete_text = fake_complete_text

result = query_transformation.transform_query(
    context=None,
    user_query=${JSON.stringify("En allant sur internet, donne moi le temps qu'il fera demain à Paris")},
    system_context=['language:fr', 'target_date:06/05/2026'],
    runtime_params={
        'llm_runtime': {
            'provider': 'LLM local (on premise)',
            'model': 'qwen/qwen3.5-9b',
            'endpoint': 'http://host.docker.internal:1234',
        },
        'hidden_llm_timeout_seconds': 120,
        'query_transformation': query_transformation.DEFAULT_QUERY_TRANSFORMATION_TEMPLATE,
    },
)

print(json.dumps({'captured': captured, 'result': result}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            captured: { system_prompt: string; user_prompt: string; timeout: number; allow_reasoning_retry?: boolean };
            result: { transformed_query_raw: string; mode: string };
        };

        expect(payload.captured.system_prompt).toBe('');
        expect(payload.captured.user_prompt).toContain('Transforme la demande utilisateur en requête web concise.');
        expect(payload.captured.user_prompt).toContain('CONTEXTE=["language:fr", "target_date:06/05/2026"]');
        expect(payload.captured.user_prompt).not.toContain('PRINCIPES D\'ABSTRACTION');
        expect(payload.captured.user_prompt.length).toBeLessThan(400);
        expect(payload.captured.timeout).toBe(120);
        expect(payload.captured.allow_reasoning_retry).toBe(true);
        expect(payload.result.transformed_query_raw).toBe('météo paris demain prévisions');
        expect(payload.result.mode).toBe('llm');
    });

    it('uses a higher default hidden LLM timeout for local on-prem runtimes', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from core.function_context import FunctionContext
from native.web_search_runtime_params import resolve_runtime_params

result = resolve_runtime_params(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            'web_search': {
                'params': {
                    'web_engine': 'duckduckgo.com',
                },
                'llm_runtime': {
                    'provider': 'LLM local (on premise)',
                    'model': 'qwen/qwen3.5-9b',
                    'endpoint': 'http://host.docker.internal:1234',
                    'completion_api_url': 'http://host.docker.internal:3001/api/web-search/hidden-llm/complete',
                },
            }
        },
    ),
    {
        'query': 'météo demain Paris',
        'num_results': 5,
        'language': 'fr',
        'safe_search': True,
    },
)

print(json.dumps(result, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            hidden_llm_timeout_seconds: number;
            llm_runtime: { provider: string; endpoint: string };
        };

        expect(payload.hidden_llm_timeout_seconds).toBe(120);
        expect(payload.llm_runtime.provider).toBe('LLM local (on premise)');
        expect(payload.llm_runtime.endpoint).toBe('http://host.docker.internal:1234');
    });

    it('removes source_content from the reranking prompt sent to the hidden LLM', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_reranking as reranking

captured = {}

def fake_complete_text(context, *, system_prompt, user_prompt, timeout, max_tokens, allow_reasoning_retry=True):
    captured['system_prompt'] = system_prompt
    captured['user_prompt'] = user_prompt
    return json.dumps({
        'relevance_score': 9,
        'reasoning': 'source pertinente',
        'critical_fragment': 'Prévisions météo Paris demain 8°C 17°C.'
    }, ensure_ascii=False)

reranking.complete_text = fake_complete_text

result = reranking.rerank_sources(
    None,
    'Donne moi la météo pour demain à Paris',
    {
        'normalized_query': 'météo paris demain prévisions',
        'must_include_terms': [],
    },
    [{
        'title': 'Météo Paris demain',
        'url': 'https://meteofrance.com/previsions-meteo-france/paris/75000',
        'snippet': 'Prévisions météo Paris demain 8°C 17°C.',
    }],
    [],
    runtime_params={
        'allowed_domains': [],
        'reranking_prompt': ${JSON.stringify("# PARAMÈTRES D'ENTRÉE\n- INTENTION_INITIALE : {{user_query}}\n- SOURCE_WEB : {{source_content}}")},
        'relevance_threshold': 7,
        'rerank_strategy': 'Fast',
    },
)

print(json.dumps({'captured': captured, 'result': result}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            captured: { system_prompt: string; user_prompt: string };
            result: { selected: Array<{ url: string; relevance_score: number }> };
        };

        expect(payload.captured.system_prompt).toContain('INTENTION_INITIALE : Donne moi la météo pour demain à Paris');
        expect(payload.captured.system_prompt).not.toContain('{{source_content}}');
        expect(payload.captured.system_prompt).not.toContain('SOURCE_WEB :');
        expect(payload.captured.user_prompt).toContain('SOURCE_WEB: {"title": "Météo Paris demain"');
        expect(payload.result.selected[0]?.url).toBe('https://meteofrance.com/previsions-meteo-france/paris/75000');
    });

    it('targets the backend hidden llm completion endpoint for hidden transformation', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_llm_client import complete_text
from core.function_context import FunctionContext

captured = {}

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        captured['path'] = self.path
        captured['authorization'] = self.headers.get('Authorization')
        content_length = int(self.headers.get('Content-Length', '0'))
        raw_body = self.rfile.read(content_length).decode('utf-8')
        captured['body'] = json.loads(raw_body)
        response_body = json.dumps({
            'text': 'Paris météo demain 30/04/2026 prévisions températures précipitations vent'
        }).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def log_message(self, format, *args):
        return

server = HTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever)
thread.daemon = True
thread.start()
completion_api_url = f'http://127.0.0.1:{server.server_port}/api/web-search/hidden-llm/complete'

try:
    result = complete_text(
        FunctionContext(
            workspace_dir='.',
            function_name='web_search_py',
            private_context={
                'web_search': {
                    'llm_runtime': {
                        'provider': 'LLM local (on premise)',
                        'model': 'local-model',
                        'endpoint': 'http://host.docker.internal:11434',
                        'transport': 'application-backend',
                        'completion_api_url': completion_api_url,
                        'auth_token': 'jwt-hidden-token',
                    }
                }
            }
        ),
        system_prompt='CTX=["language:fr"]',
        user_prompt='Quelle est la météo pour demain à Paris ?',
        timeout=5,
        max_tokens=128,
    )
finally:
    server.shutdown()
    thread.join()
    server.server_close()

print(json.dumps({'captured': captured, 'result': result}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toContain('web_search_hidden_llm_request_start');
        expect(stderr).toContain('web_search_hidden_llm_request_success');

        const payload = parseLastJsonLine<{
            captured: {
                path: string;
                authorization?: string;
                body: {
                    runtime: {
                        provider: string;
                        model: string;
                        endpoint: string;
                        transport: string;
                    };
                    systemPrompt: string;
                    userPrompt: string;
                    timeoutSeconds: number;
                    maxTokens: number;
                };
            };
            result: string;
        }>(stdout);

        expect(payload.captured.path).toBe('/api/web-search/hidden-llm/complete');
        expect(payload.captured.authorization).toBe('Bearer jwt-hidden-token');
        expect(payload.captured.body).toEqual({
            runtime: {
                provider: 'LLM local (on premise)',
                model: 'local-model',
                endpoint: 'http://host.docker.internal:11434',
                transport: 'application-backend',
            },
            systemPrompt: 'CTX=["language:fr"]',
            userPrompt: 'Quelle est la météo pour demain à Paris ?',
            timeoutSeconds: 5,
            maxTokens: 128,
            allowReasoningRetry: true,
        });
        expect(payload.result).toBe('Paris météo demain 30/04/2026 prévisions températures précipitations vent');
    });

    it('mirrors the legacy weather query planning', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys
from datetime import date as real_date

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from native.web_search_query_transformation import build_candidate_queries

class FakeDate(real_date):
    @classmethod
    def today(cls):
        return cls(2026, 4, 28)

web_search_py.date = FakeDate
intent = web_search_py._analyze_query_intent('Cherche sur le web la météo et les températures minimales et maximales demain à Paris')

print(json.dumps({
    'legacy': web_search_py._build_candidate_queries(intent),
    'extracted': build_candidate_queries(intent),
}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as { legacy: string[]; extracted: string[] };
        expect(payload.extracted).toEqual(payload.legacy);
        expect(payload.extracted[0]).toBe('site:meteofrance.com météo "Paris" le 29/04/2026');
    });

    it('mirrors the legacy documentation query planning', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from native.web_search_query_transformation import build_candidate_queries

intent = web_search_py._analyze_query_intent('la documentation openai sur les responses api')

print(json.dumps({
    'legacy': web_search_py._build_candidate_queries(intent),
    'extracted': build_candidate_queries(intent),
}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as { legacy: string[]; extracted: string[] };
        expect(payload.extracted).toEqual(payload.legacy);
        expect(payload.extracted).toContain('site:platform.openai.com/docs responses api');
    });

    it('mirrors the legacy weather result projection and deduplication', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from native.web_search_result_filter import deduplicate_raw_results, project_results

raw_results = [
    {
        'title': 'Météo de Dieppe pour le Jeudi 30 Avril',
        'href': 'https://www.meteosun.com/meteo/previsions-ville/FR/dieppe/prevision-J-5',
        'body': 'Prévisions météo à Dieppe pour le jeudi 30 avril.'
    },
    {
        'title': 'Météo de Paris (75001) pour le Jeudi 30 Avril - Météo 10 jours',
        'href': 'https://www.meteosun.com/meteo/previsions-ville/FR/paris-FRXX0076/prevision-J-5',
        'body': 'Météo de Paris pour le jeudi 30 avril, minimales et maximales.'
    },
    {
        'title': 'Météo de Paris (75001) pour le Jeudi 30 Avril - Météo 10 jours',
        'href': 'https://www.meteosun.com/meteo/previsions-ville/FR/paris-FRXX0076/prevision-J-5',
        'body': 'Duplicate entry that should be removed.'
    },
    {
        'title': 'Historique météo Paris avril 2026',
        'href': 'https://www.weatherandclimate.com/france/paris?page=month&month=4',
        'body': 'Historique climat avril 2026 à Paris.'
    },
]

deduped_legacy = web_search_py._deduplicate_raw_results(raw_results)
deduped_extracted = deduplicate_raw_results(raw_results)
projected_legacy = web_search_py._project_results(deduped_legacy, 2, 'weather_location_forecast', ['paris'])
projected_extracted = project_results(deduped_extracted, 2, 'weather_location_forecast', ['paris'])

print(json.dumps({
    'deduped_legacy': deduped_legacy,
    'deduped_extracted': deduped_extracted,
    'projected_legacy': projected_legacy,
    'projected_extracted': projected_extracted,
}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            deduped_legacy: Array<{ href: string }>;
            deduped_extracted: Array<{ href: string }>;
            projected_legacy: Array<{ title: string; url: string }>;
            projected_extracted: Array<{ title: string; url: string }>;
        };

        expect(payload.deduped_extracted).toEqual(payload.deduped_legacy);
        expect(payload.projected_extracted).toEqual(payload.projected_legacy);
        expect(payload.projected_extracted).toHaveLength(1);
        expect(payload.projected_extracted[0]?.url).toContain('/paris-FRXX0076/');
    });

    it('mirrors the legacy documentation result projection', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from native.web_search_result_filter import project_results

raw_results = [
    {
        'title': 'OpenAI Responses API docs',
        'href': 'https://platform.openai.com/docs/api-reference/responses',
        'body': 'Official documentation for the Responses API.'
    },
    {
        'title': 'Blog post about responses api',
        'href': 'https://example.com/blog/responses-api',
        'body': 'Unofficial notes about the API.'
    },
]

legacy = web_search_py._project_results(raw_results, 2, 'documentation_lookup', [])
extracted = project_results(raw_results, 2, 'documentation_lookup', [])

print(json.dumps({
    'legacy': legacy,
    'extracted': extracted,
}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            legacy: Array<{ url: string }>;
            extracted: Array<{ url: string }>;
        };

        expect(payload.extracted).toEqual(payload.legacy);
        expect(payload.extracted).toHaveLength(1);
        expect(payload.extracted[0]?.url).toContain('platform.openai.com/docs');
    });

    it('does not open any page when dig_snippet is false', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_page_fetch import fetch_selected_pages

open_calls = []

def fake_opener(*args, **kwargs):
    open_calls.append('called')
    raise AssertionError('opener should not be called when dig_snippet is false')

pages = fetch_selected_pages([
    {
        'url': 'https://example.com/weather',
        'snippet': 'Snippet moteur Paris demain',
    }
], dig_snippet=False, opener=fake_opener)

print(json.dumps({
    'pages': pages,
    'open_calls': len(open_calls),
}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            pages: Array<{ status: string; content: string; fetched: boolean }>;
            open_calls: number;
        };

        expect(payload.open_calls).toBe(0);
        expect(payload.pages).toEqual([
            expect.objectContaining({
                status: 'snippet_only',
                content: 'Snippet moteur Paris demain',
                fetched: false,
            })
        ]);
    });

    it('fetches and normalizes HTML content with charset handling when dig_snippet is true', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_page_fetch import fetch_selected_pages

class FakeHeaders(dict):
    def get(self, key, default=None):
        return super().get(key, default)

class FakeResponse:
    def __init__(self, payload, content_type):
        self._payload = payload
        self.headers = FakeHeaders({'Content-Type': content_type})

    def read(self, limit=-1):
        if limit is None or limit < 0:
            return self._payload
        return self._payload[:limit]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

def fake_opener(request, timeout=0):
    html_payload = '<html><head><title>Météo Paris</title><style>.x{}</style></head><body><h1>Météo Paris</h1><p>Température minimale 8°C</p><script>alert(1)</script><p>Température maximale 17°C</p></body></html>'
    return FakeResponse(html_payload.encode('iso-8859-1', errors='replace'), 'text/html; charset=iso-8859-1')

pages = fetch_selected_pages([
    {
        'url': 'https://example.com/weather',
        'snippet': 'Snippet moteur Paris demain',
    }
], dig_snippet=True, opener=fake_opener)

print(json.dumps(pages, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as Array<{
            status: string;
            fetched: boolean;
            charset: string;
            content: string;
        }>;

        expect(payload).toHaveLength(1);
        expect(payload[0]).toEqual(expect.objectContaining({
            status: 'fetched',
            fetched: true,
            charset: 'iso-8859-1',
        }));
        expect(payload[0]?.content).toContain('Météo Paris');
        expect(payload[0]?.content).toContain('Température minimale 8°C');
        expect(payload[0]?.content).toContain('Température maximale 17°C');
        expect(payload[0]?.content).not.toContain('alert(1)');
    });

    it('falls back to the engine snippet when page fetch fails', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_page_fetch import fetch_selected_pages

def fake_opener(*args, **kwargs):
    raise TimeoutError('network timeout')

pages = fetch_selected_pages([
    {
        'url': 'https://example.com/weather',
        'snippet': 'Snippet moteur Paris demain',
    }
], dig_snippet=True, opener=fake_opener)

print(json.dumps(pages, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as Array<{
            status: string;
            fetched: boolean;
            content: string;
            error: string;
        }>;

        expect(payload).toEqual([
            expect.objectContaining({
                status: 'fetch_failed_snippet_fallback',
                fetched: false,
                content: 'Snippet moteur Paris demain',
                error: 'network timeout',
            })
        ]);
    });

    it('reranks verified sources and builds a bounded context block', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_context_pack import build_llm_context_block
from native.web_search_reranking import rerank_sources

intent = {
    'search_strategy': 'weather_location_forecast',
    'location_terms': ['paris'],
    'target_date_phrase': '30/04/2026',
    'normalized_query': 'météo et températures minimales et maximales à Paris le 30/04/2026',
}

results = [
    {
        'title': 'Météo Paris demain',
        'url': 'https://meteofrance.com/previsions-meteo-france/paris/75000',
        'snippet': 'Prévisions météo Paris demain 8°C 17°C le 30/04/2026.'
    },
    {
        'title': 'Météo Lyon archive',
        'url': 'https://example.com/archive-lyon',
        'snippet': 'Historique météo Lyon avril 2026.'
    },
]

fetched_fragments = [
    {
        'url': 'https://meteofrance.com/previsions-meteo-france/paris/75000',
        'source_kind': 'page_content',
        'content': 'Prévisions météo Paris pour le 30/04/2026. Température minimale 8°C. Température maximale 17°C.'
    }
]

reranked = rerank_sources(
    'Donne moi la météo pour demain à Paris',
    intent,
    results,
    fetched_fragments,
    relevance_threshold=7,
    rerank_strategy='Deep',
)
context_block = build_llm_context_block('Donne moi la météo pour demain à Paris', reranked['selected'], max_context_tokens=180)

print(json.dumps({
    'reranked': reranked,
    'context_block': context_block,
}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            reranked: {
                evaluations: Array<{ url: string; relevance_score: number }>;
                selected: Array<{ url: string; relevance_score: number; critical_fragment: string }>;
            };
            context_block: {
                sources: Array<{ reference: string; url: string }>;
                content: string;
                truncated: boolean;
            };
        };

        expect(payload.reranked.selected).toHaveLength(1);
        expect(payload.reranked.selected[0]?.url).toContain('meteofrance.com/previsions-meteo-france/paris/75000');
        expect(payload.reranked.selected[0]?.relevance_score).toBeGreaterThanOrEqual(7);
        expect(payload.reranked.selected[0]?.critical_fragment).toContain('30/04/2026');
        expect(payload.context_block.sources[0]?.reference).toBe('S1');
        expect(payload.context_block.content).toContain('Sources utilisées: S1');
    });

    it('builds explicit engine query plans from transformed_query_raw and allowed domains', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_engine_query_plan import build_engine_query_plans

print(json.dumps({
    'plans': build_engine_query_plans(
        web_engine='google.com',
        transformed_query_raw=' sport plus pratiqué france 2026 statistiques ',
        allowed_domains=['insee.fr', 'sports.gouv.fr', 'insee.fr'],
    ),
}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            plans: Array<{
                engine: string;
                transformed_query_raw: string;
                domain: string;
                engine_query_text: string;
                engine_query_url: string;
            }>;
        };

        expect(payload.plans).toEqual([
            {
                adapter_name: 'GoogleSearchAdapter',
                engine: 'google.com',
                transformed_query_raw: 'sport plus pratiqué france 2026 statistiques',
                domain: 'insee.fr',
                engine_query_text: 'site:insee.fr sport plus pratiqué france 2026 statistiques',
                engine_query_url: 'https://www.google.com/search?q=site%3Ainsee.fr+sport+plus+pratiqu%C3%A9+france+2026+statistiques',
            },
            {
                adapter_name: 'GoogleSearchAdapter',
                engine: 'google.com',
                transformed_query_raw: 'sport plus pratiqué france 2026 statistiques',
                domain: 'sports.gouv.fr',
                engine_query_text: 'site:sports.gouv.fr sport plus pratiqué france 2026 statistiques',
                engine_query_url: 'https://www.google.com/search?q=site%3Asports.gouv.fr+sport+plus+pratiqu%C3%A9+france+2026+statistiques',
            },
        ]);
    });

    it('builds explicit duckduckgo and bing engine urls without implicit fallback', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_engine_query_plan import build_engine_query_plans

print(json.dumps({
    'duckduckgo': build_engine_query_plans(
        web_engine='duckduckgo.com',
        transformed_query_raw='Paris météo demain 29/04/2026 prévisions températures',
        allowed_domains=[],
    ),
    'bing': build_engine_query_plans(
        web_engine='bing.com',
        transformed_query_raw='boulangerie adresses Saint-Nom-la-Bretèche France commerces artisanaux',
        allowed_domains=[],
    ),
}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            duckduckgo: Array<{ engine_query_url: string; engine_query_text: string; engine: string }>;
            bing: Array<{ engine_query_url: string; engine_query_text: string; engine: string }>;
        };

        expect(payload.duckduckgo).toEqual([
            expect.objectContaining({
                engine: 'duckduckgo.com',
                engine_query_text: 'Paris météo demain 29/04/2026 prévisions températures',
                engine_query_url: 'https://duckduckgo.com/?q=Paris+m%C3%A9t%C3%A9o+demain+29%2F04%2F2026+pr%C3%A9visions+temp%C3%A9ratures',
            }),
        ]);
        expect(payload.bing).toEqual([
            expect.objectContaining({
                engine: 'bing.com',
                engine_query_text: 'boulangerie adresses Saint-Nom-la-Bretèche France commerces artisanaux',
                engine_query_url: 'https://www.bing.com/search?q=boulangerie+adresses+Saint-Nom-la-Bret%C3%A8che+France+commerces+artisanaux',
            }),
        ]);
    });

    it('resolves explicit business adapters with documented query parameters and runtime support flags', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_engine_adapters import resolve_search_engine_adapter

engines = ['duckduckgo.com', 'google.com', 'bing.com', 'baidu.com', 'qwant.com']
payload = []
for engine in engines:
    adapter = resolve_search_engine_adapter(engine)
    execution = adapter.build_execution_request(
        engine_query_text='test search',
        region='fr-fr',
        safesearch='on',
        max_results=10,
    )
    payload.append({
        'engine': adapter.engine,
        'adapter_name': adapter.adapter_name,
        'execution_kind': adapter.execution_kind,
        'supported_runtime': adapter.supported_runtime,
        'query_url': adapter.build_query_url('test search'),
        'request': execution['request'],
    })

print(json.dumps(payload, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as Array<{
            engine: string;
            adapter_name: string;
            execution_kind: string;
            supported_runtime: boolean;
            query_url: string;
            request: Record<string, string | number>;
        }>;

        expect(payload).toEqual([
            {
                engine: 'duckduckgo.com',
                adapter_name: 'DuckDuckGoSearchAdapter',
                execution_kind: 'ddgs_text',
                supported_runtime: true,
                query_url: 'https://duckduckgo.com/?q=test+search',
                request: {
                    q: 'test search',
                    region: 'fr-fr',
                    safe_search: 'on',
                    max_results: 10,
                },
            },
            {
                engine: 'google.com',
                adapter_name: 'GoogleSearchAdapter',
                execution_kind: 'http_search_page',
                supported_runtime: true,
                query_url: 'https://www.google.com/search?q=test+search',
                request: {
                    q: 'test search',
                    region: 'fr-fr',
                    safe_search: 'on',
                    max_results: 10,
                },
            },
            {
                engine: 'bing.com',
                adapter_name: 'BingSearchAdapter',
                execution_kind: 'http_search_page',
                supported_runtime: true,
                query_url: 'https://www.bing.com/search?q=test+search',
                request: {
                    q: 'test search',
                    region: 'fr-fr',
                    safe_search: 'on',
                    max_results: 10,
                },
            },
            {
                engine: 'baidu.com',
                adapter_name: 'BaiduSearchAdapter',
                execution_kind: 'http_search_page',
                supported_runtime: true,
                query_url: 'https://www.baidu.com/s?wd=test+search',
                request: {
                    wd: 'test search',
                    region: 'fr-fr',
                    safe_search: 'on',
                    max_results: 10,
                },
            },
            {
                engine: 'qwant.com',
                adapter_name: 'QwantSearchAdapter',
                execution_kind: 'http_search_page',
                supported_runtime: true,
                query_url: 'https://www.qwant.com/?q=test+search',
                request: {
                    t: 'web',
                    q: 'test search',
                    region: 'fr-fr',
                    safe_search: 'on',
                    max_results: 10,
                },
            },
        ]);
    });

    it('returns a bounded business error when an unsupported engine is requested', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

from native.web_search_engine_query_plan import build_engine_query_plans

try:
    build_engine_query_plans(
        web_engine='search.example.com',
        transformed_query_raw='test requête',
        allowed_domains=[],
    )
except Exception as exc:
    print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(pythonExecutable, ['-c', pythonSnippet], {
            cwd: workspaceRoot,
            timeout: 30000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as { error: string };
        expect(payload.error).toBe('SEARCH_ENGINE_UNAVAILABLE:search.example.com');
    });
});