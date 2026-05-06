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

describe('web_search_py pure abstraction pipeline', () => {
    it('uses hidden LLM transformation and reranking on a generic topic without topic-specific heuristics', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
import native.web_search_presearch as presearch
import native.web_search_query_transformation as query_transformation
import native.web_search_reranking as reranking
from core.function_context import FunctionContext

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, backend=None, **kwargs):
        return [
            {
                "title": "Mobilité urbaine 2024 - Ministère de la Transition écologique",
                "href": "https://example.gov/mobilite-urbaine-2024",
                "body": "France 2024 mobilité urbaine vélo part modale et usages en progression."
            },
            {
                "title": "Blog personnel sur le vélo urbain",
                "href": "https://blog.example/velo-urbain",
                "body": "Billet d'opinion sur le vélo urbain sans données France 2024."
            }
        ]

def fake_transform(*args, **kwargs):
    return {
        "normalized_query": "adoption vélo urbain france 2024",
        "queries": ["adoption vélo urbain france 2024"],
        "english_queries": [],
        "must_include_terms": ["france", "2024"],
        "exclude_terms": [],
        "raw_output": "{...}",
        "mode": "llm",
    }

def fake_rerank(context, user_query, transformed_query, results, fetched_fragments, *, runtime_params):
    return {
        "evaluations": [
            {
                "title": results[0]["title"],
                "url": results[0]["url"],
                "source_kind": "search_snippet",
                "relevance_score": 9,
                "reasoning": "source officielle pertinente",
                "critical_fragment": "France 2024 mobilité urbaine vélo part modale et usages en progression.",
                "mode": "llm",
            }
        ],
        "selected": [
            {
                "title": results[0]["title"],
                "url": results[0]["url"],
                "source_kind": "search_snippet",
                "relevance_score": 9,
                "reasoning": "source officielle pertinente",
                "critical_fragment": "France 2024 mobilité urbaine vélo part modale et usages en progression.",
                "mode": "llm",
            }
        ]
    }

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
presearch.transform_query = fake_transform
query_transformation.transform_query = fake_transform
web_search_py.transform_query = fake_transform
reranking.rerank_sources = fake_rerank
web_search_py.rerank_sources = fake_rerank

result = web_search_py.run(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            "web_search": {
                "params": {
                    "allowed_domains": ["example.gov"],
                    "query_transformation": "TRANSFORM {{user_query}}",
                    "reranking_prompt": "RERANK {{user_query}} {{source_content}}",
                    "relevance_threshold": 7,
                    "rerank_strategy": "Fast",
                    "max_uses": 3,
                    "web_engine_search": True,
                    "web_engine": "duckduckgo.com",
                    "web_engine_nb_result_select": 2,
                },
                "llm_runtime": {
                    "provider": "OpenAI",
                    "model": "gpt-test",
                    "api_key": "sk-test"
                }
            }
        }
    ),
    {
        "query": "Quels sont les chiffres récents sur l'adoption du vélo urbain en France ?",
        "num_results": 2,
        "language": "fr",
        "safe_search": True,
    },
)

print(json.dumps(result, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(
            pythonExecutable,
            ['-c', pythonSnippet],
            {
                cwd: workspaceRoot,
                timeout: 30000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                },
            },
        );

        expect(stderr).toBe('');

        const result = parseLastJsonLine<{
            normalized_query: string;
            results: Array<{ url: string; title: string }>;
            verified_fragments: Array<{ url: string; relevance_score: number }>;
            trace: {
                transformation: {
                    mode: string;
                    normalized_query: string;
                };
            };
        }>(stdout);

        expect(result.normalized_query).toBe('adoption vélo urbain france 2024');
        expect(result.trace.transformation.mode).toBe('llm');
        expect(result.results).toHaveLength(1);
        expect(result.results[0]?.url).toBe('https://example.gov/mobilite-urbaine-2024');
        expect(result.verified_fragments[0]?.relevance_score).toBe(9);
    });

    it('maps duckduckgo.com to valid DDGS text backends instead of the invalid duckduckgo backend', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
import native.web_search_presearch as presearch
import native.web_search_query_transformation as query_transformation
import native.web_search_reranking as reranking
from core.function_context import FunctionContext

calls = []

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, backend=None, **kwargs):
        calls.append({
            "query": query,
            "keywords": keywords,
            "region": region,
            "safesearch": safesearch,
            "max_results": max_results,
            "backend": backend,
        })
        if backend == "html":
            return [
                {
                    "title": "METEO PARIS par Météo-France",
                    "href": "https://meteofrance.com/previsions-meteo-france/paris/75000",
                    "body": "Prévisions météo Paris demain."
                }
            ]
        return []

def fake_transform(*args, **kwargs):
    return {
        "normalized_query": "quel temps il fera demain à paris",
        "queries": ["quel temps il fera demain à paris"],
        "english_queries": [],
        "must_include_terms": ["paris", "demain"],
        "exclude_terms": [],
        "raw_output": "{...}",
        "mode": "llm",
    }

def fake_rerank(context, user_query, transformed_query, results, fetched_fragments, *, runtime_params):
    return {
        "evaluations": [
            {
                "title": results[0]["title"],
                "url": results[0]["url"],
                "source_kind": "search_snippet",
                "relevance_score": 9,
                "reasoning": "source météo pertinente",
                "critical_fragment": results[0]["snippet"],
                "mode": "llm",
            }
        ],
        "selected": [
            {
                "title": results[0]["title"],
                "url": results[0]["url"],
                "source_kind": "search_snippet",
                "relevance_score": 9,
                "reasoning": "source météo pertinente",
                "critical_fragment": results[0]["snippet"],
                "mode": "llm",
            }
        ]
    }

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
presearch.transform_query = fake_transform
query_transformation.transform_query = fake_transform
web_search_py.transform_query = fake_transform
reranking.rerank_sources = fake_rerank
web_search_py.rerank_sources = fake_rerank

result = web_search_py.run(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            "web_search": {
                "params": {
                    "query_transformation": "TRANSFORM {{user_query}}",
                    "reranking_prompt": "RERANK {{user_query}} {{source_content}}",
                    "relevance_threshold": 7,
                    "rerank_strategy": "Fast",
                    "max_uses": 3,
                    "web_engine_search": True,
                    "web_engine": "duckduckgo.com",
                    "web_engine_nb_result_select": 1,
                },
                "llm_runtime": {
                    "provider": "OpenAI",
                    "model": "gpt-test",
                    "api_key": "sk-test"
                }
            }
        }
    ),
    {
        "query": "Peux tu chercher sur internet quel temps il fera demain à Paris ?",
        "num_results": 3,
        "language": "fr",
        "safe_search": True,
    },
)

print(json.dumps({"result": result, "calls": calls}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(
            pythonExecutable,
            ['-c', pythonSnippet],
            {
                cwd: workspaceRoot,
                timeout: 30000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                },
            },
        );

        expect(stderr).toBe('');

        const payload = parseLastJsonLine<{
            calls: Array<{ backend: string; region: string; query?: string }>;
            result: {
                results: Array<{ url: string }>;
                trace: {
                    steps: Array<{ name: string; status: string; details?: { search_backends?: string[] } }>;
                    queries: Array<{ attempts?: Array<{ backend: string; status: string }> }>;
                };
            };
        }>(stdout);

        expect(payload.calls.map((call) => call.backend)).toEqual(['html']);
        expect(payload.result.results[0]?.url).toBe('https://meteofrance.com/previsions-meteo-france/paris/75000');
        expect(payload.result.trace.queries[0]?.attempts?.map((attempt) => attempt.backend)).toEqual(['html']);
        expect(payload.result.trace.steps.find((step) => step.name === 'execute_search')?.details?.search_backends).toEqual(['html', 'api', 'lite']);
    });
});