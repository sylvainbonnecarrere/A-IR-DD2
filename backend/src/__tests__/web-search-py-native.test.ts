import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function resolveWorkspaceRoot(): string {
    return path.resolve(__dirname, '../../../');
}

function resolvePythonExecutable(workspaceRoot: string): string {
    return process.platform === 'win32'
        ? path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(workspaceRoot, '.venv', 'bin', 'python');
}

describe('web_search_py native weather query shaping', () => {
    it('derives a dated search query and filters localized weather results instead of reusing the raw prompt', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys
from datetime import date as real_date

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

seen_queries = []

class FakeDate(real_date):
    @classmethod
    def today(cls):
        return cls(2026, 4, 28)

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        seen_queries.append(query or keywords)
        return [
            {
                "title": "METEO MARSEILLE par Météo-France - Prévisions météo gratuites",
                "href": "https://meteofrance.com/previsions-meteo-france/marseille/13000",
                "body": "Prévisions météo demain à Marseille avec températures minimales et maximales."
            },
            {
                "title": "METEO PARIS par Météo-France - Prévisions météo gratuites",
                "href": "https://meteofrance.com/previsions-meteo-france/paris/75000",
                "body": "Retrouvez les prévisions météo Paris demain avec températures minimales et maximales."
            }
        ]

web_search_py.date = FakeDate
web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo", "auto")

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Cherche sur le web la météo et les températures minimales et maximales demain à Paris",
        "num_results": 5,
        "language": "fr",
        "safe_search": True,
    },
)

print(json.dumps({"result": result, "seenQueries": seen_queries}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(
            pythonExecutable,
            ['-c', pythonSnippet],
            {
                cwd: workspaceRoot,
                timeout: 30000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            result: {
                normalized_query: string;
                total_results: number;
                results: Array<{ url: string; title: string }>;
                trace: {
                    intent: {
                        kind: string;
                        confidence: number;
                        location: string;
                        target_date_phrase: string;
                        search_strategy: string;
                    };
                    queries: Array<{ query: string; status: string; result_count?: number; attempts?: Array<{ backend: string; status: string; result_count?: number }> }>;
                    consulted_sources: Array<{ url: string }>;
                    selected_sources: Array<{ url: string }>;
                    steps: Array<{ name: string; status: string }>;
                    errors: Array<{ step: string; type: string; message: string }>;
                };
            };
            seenQueries: string[];
        };

        expect(payload.result.normalized_query).toBe(
            'météo et températures minimales et maximales à Paris le 29/04/2026'
        );
        expect(payload.seenQueries).not.toContain(
            'Cherche sur le web la météo et les températures minimales et maximales demain à Paris'
        );
        expect(payload.seenQueries).toContain(
            'site:meteofrance.com météo "Paris" le 29/04/2026'
        );
        expect(payload.result.trace.queries[0]?.attempts).toEqual([
            expect.objectContaining({ backend: 'duckduckgo', status: 'completed', result_count: 2 })
        ]);
        expect(payload.result.total_results).toBe(1);
        expect(payload.result.results[0]?.url).toContain('/paris/');
        expect(payload.result.results[0]?.title.toLowerCase()).toContain('paris');
        expect(payload.result.trace.intent.kind).toBe('weather');
        expect(payload.result.trace.intent.confidence).toBe(0.95);
        expect(payload.result.trace.intent.location).toBe('Paris');
        expect(payload.result.trace.intent.target_date_phrase).toBe('29/04/2026');
        expect(payload.result.trace.intent.search_strategy).toBe('weather_location_forecast');
        expect(payload.result.trace.steps.map((step) => step.name)).toEqual([
            'normalize_query',
            'build_search_plan',
            'execute_search',
            'project_results',
            'fetch_pages',
            'rerank_sources',
            'build_context_block',
        ]);
        expect(payload.result.trace.errors).toEqual([]);
        expect(payload.result.trace.consulted_sources[0]?.url).toContain('meteofrance.com');
        expect(payload.result.trace.selected_sources[0]?.url).toContain('/paris/');
    });

    it('deprioritizes archive-like Paris weather pages in favor of forecast pages', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        return [
            {
                "title": "Archive météo Paris - meteoblue",
                "href": "https://www.meteoblue.com/fr/meteo/historyclimate/weatherarchive/paris_france_2988507",
                "body": "Les données météorologiques historiques horaires depuis 1940 pour Paris."
            },
            {
                "title": "METEO PARIS par Météo-France - Prévisions météo gratuites pour aujourd’hui, demain et jusqu’à 15 jours",
                "href": "https://meteofrance.com/previsions-meteo-france/paris/75000",
                "body": "Retrouvez les prévisions météo Paris de Météo-France pour aujourd’hui, demain et jusqu’à 15 jours."
            }
        ]

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo", "auto")

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Cherche sur le web la météo et les températures minimales et maximales demain à Paris",
        "num_results": 5,
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
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const result = JSON.parse(stdout.trim()) as {
            results: Array<{ url: string; title: string }>;
        };

        expect(result.results[0]?.url).toContain('meteofrance.com/previsions-meteo-france/paris/75000');
        expect(result.results.some((item) => item.url.includes('weatherarchive'))).toBe(false);
    });

    it('classifies a non-weather prompt as generic_search with a stable strategy', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        return [
            {
                "title": "OpenAI documentation",
                "href": "https://platform.openai.com/docs/overview",
                "body": "Documentation overview for the OpenAI platform."
            }
        ]

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo", "auto")

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Cherche sur le web la documentation OpenAI sur les responses API",
        "num_results": 5,
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
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const result = JSON.parse(stdout.trim()) as {
            normalized_query: string;
            total_results: number;
            trace: {
                intent: {
                    kind: string;
                    confidence: number;
                    location: string;
                    target_date_phrase: string;
                    search_strategy: string;
                };
                queries: Array<{ query: string }>;
            };
        };

        expect(result.normalized_query).toBe('la documentation openai sur les responses api');
        expect(result.total_results).toBe(1);
        expect(result.trace.intent.kind).toBe('generic_search');
        expect(result.trace.intent.confidence).toBe(0.78);
        expect(result.trace.intent.location).toBe('');
        expect(result.trace.intent.target_date_phrase).toBe('');
        expect(result.trace.intent.search_strategy).toBe('documentation_lookup');
        expect(result.trace.queries).toEqual([
            expect.objectContaining({ query: 'la documentation openai sur les responses api', status: 'completed', result_count: 1 }),
            expect.objectContaining({ query: 'site:platform.openai.com/docs la documentation openai sur les responses api', status: 'completed', result_count: 1 }),
            expect.objectContaining({ query: 'site:openai.com la documentation openai sur les responses api', status: 'completed', result_count: 1 }),
            expect.objectContaining({ query: 'site:platform.openai.com/docs responses api', status: 'completed', result_count: 1 }),
        ]);
    });

    it('prefers trusted documentation domains over generic sources for documentation lookups', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        return [
            {
                "title": "Blog post about Responses API",
                "href": "https://random-blog.example/openai-responses-api",
                "body": "Unofficial article about the responses api."
            },
            {
                "title": "Responses API - OpenAI API",
                "href": "https://platform.openai.com/docs/api-reference/responses",
                "body": "Official API reference for the OpenAI Responses API."
            }
        ]

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo", "auto")

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Cherche sur le web la documentation OpenAI sur les responses API",
        "num_results": 5,
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
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const result = JSON.parse(stdout.trim()) as {
            results: Array<{ url: string; title: string }>;
            trace: { selected_sources: Array<{ url: string }> };
        };

        expect(result.results[0]?.url).toBe('https://platform.openai.com/docs/api-reference/responses');
        expect(result.results.some((item) => item.url.includes('random-blog.example'))).toBe(false);
        expect(result.trace.selected_sources[0]?.url).toBe('https://platform.openai.com/docs/api-reference/responses');
    });

    it('improves generic current-facts query shaping and avoids off-target foreign sources when a France source exists', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

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

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        seen_queries.append(query or keywords)
        return [
            {
                "title": "请问法语疑问形容词quel的具体用法？ - 知乎",
                "href": "https://www.zhihu.com/question/282245518",
                "body": "Question générale en chinois sur quel."
            },
            {
                "title": "Les chiffres-clés du sport en France",
                "href": "https://www.sports.gouv.fr/les-chiffres-cles-du-sport-en-france-2026",
                "body": "Le football reste le sport le plus pratiqué en France selon les dernières statistiques 2026."
            }
        ]

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo",)

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Quel sport est le plus pratiqué en France en 2026 d'après les derniers articles sur internet ?",
        "num_results": 5,
        "language": "fr",
        "safe_search": True,
    },
)

print(json.dumps({"result": result, "seen_queries": seen_queries}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(
            pythonExecutable,
            ['-c', pythonSnippet],
            {
                cwd: workspaceRoot,
                timeout: 30000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            result: {
                normalized_query: string;
                verified_fragments: Array<{ url: string; critical_fragment: string }>;
                reranked_sources: Array<{ url: string; relevance_score: number }>;
                llm_context_block: { content: string };
            };
            seen_queries: string[];
        };

        expect(payload.result.normalized_query).toBe('sport plus pratiqué france 2026');
        expect(payload.seen_queries).toEqual(expect.arrayContaining([
            'sport plus pratiqué france 2026 statistiques',
            'site:.fr sport plus pratiqué france 2026',
        ]));
        expect(payload.result.reranked_sources[0]?.url).toContain('sports.gouv.fr');
        expect(payload.result.verified_fragments[0]?.url).toContain('sports.gouv.fr');
        expect(payload.result.llm_context_block.content).toContain('football reste le sport le plus pratiqué');
    });

    it('returns a structured error with trace when a search step fails', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        backend = kwargs.get("backend")
        raise RuntimeError(f"search backend unavailable: {backend}")

def failing_html_search(candidate_query, region, max_results):
    raise RuntimeError("search backend unavailable: duckduckgo_html")

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo", "auto")
web_search_py._execute_duckduckgo_html_search = failing_html_search

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Cherche sur le web la météo et les températures minimales et maximales demain à Paris",
        "num_results": 5,
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
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const result = JSON.parse(stdout.trim()) as {
            results: Array<unknown>;
            total_results: number;
            error: { step: string; type: string; message: string };
            trace: {
                errors: Array<{ step: string; type: string; message: string }>;
                queries: Array<{ status: string; attempts?: Array<{ backend: string; status: string }> }>;
                steps: Array<{ name: string; status: string }>;
            };
        };

        expect(result.results).toEqual([]);
        expect(result.total_results).toBe(0);
        expect(result.error.step).toBe('execute_search');
        expect(result.error.type).toBe('RuntimeError');
        expect(result.error.message).toContain('search backend unavailable: duckduckgo_html');
        expect(result.trace.errors[0]?.step).toBe('execute_search');
        expect(result.trace.queries[0]?.attempts).toEqual([
            expect.objectContaining({ backend: 'duckduckgo', status: 'failed' }),
            expect.objectContaining({ backend: 'auto', status: 'failed' }),
            expect.objectContaining({ backend: 'duckduckgo_html', status: 'failed' })
        ]);
        expect(result.trace.steps.at(-1)).toEqual({
            name: 'execute_search',
            status: 'failed',
            details: {
                error: result.trace.errors[0],
            },
        });
    });

    it('skips page fetching when dig_snippet is false and keeps fetch trace explicit', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

fetch_calls = []

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        return [
            {
                "title": "METEO PARIS par Météo-France",
                "href": "https://meteofrance.com/previsions-meteo-france/paris/75000",
                "body": "Retrouvez les prévisions météo Paris demain."
            }
        ]

def fake_fetch_selected_pages(*args, **kwargs):
    fetch_calls.append('called')
    raise AssertionError('fetch_selected_pages should not be called')

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo",)
web_search_py.page_fetch_service.fetch_selected_pages = fake_fetch_selected_pages

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Cherche sur le web la météo et les températures minimales et maximales demain à Paris",
        "num_results": 5,
        "language": "fr",
        "safe_search": True,
        "dig_snippet": False,
    },
)

print(json.dumps({"result": result, "fetch_calls": fetch_calls}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(
            pythonExecutable,
            ['-c', pythonSnippet],
            {
                cwd: workspaceRoot,
                timeout: 30000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            result: {
                verified_fragments: Array<unknown>;
                llm_context_block: { sources: Array<unknown> };
                trace: {
                    page_fetches: Array<unknown>;
                    steps: Array<{ name: string; status: string; details?: Record<string, unknown> }>;
                };
            };
            fetch_calls: string[];
        };

        expect(payload.fetch_calls).toEqual([]);
        expect(payload.result.verified_fragments).toEqual([
            expect.objectContaining({
                source_kind: 'search_snippet',
                relevance_score: expect.any(Number),
                critical_fragment: 'Retrouvez les prévisions météo Paris demain.',
            })
        ]);
        expect(payload.result.llm_context_block.sources).toEqual([
            expect.objectContaining({
                reference: 'S1',
            })
        ]);
        expect(payload.result.trace.page_fetches).toEqual([]);
        expect(payload.result.trace.steps.at(-1)).toEqual({
            name: 'build_context_block',
            status: 'completed',
            details: {
                source_count: 1,
                estimated_tokens: expect.any(Number),
                truncated: false,
            },
        });
    });

    it('fetches verified fragments when dig_snippet is true and supports nested web_search_params', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        return [
            {
                "title": "METEO MARSEILLE par Météo-France",
                "href": "https://meteofrance.com/previsions-meteo-france/marseille/13000",
                "body": "Prévisions météo demain à Marseille."
            },
            {
                "title": "METEO PARIS par Météo-France",
                "href": "https://meteofrance.com/previsions-meteo-france/paris/75000",
                "body": "Retrouvez les prévisions météo Paris demain."
            }
        ]

def fake_fetch_selected_pages(results, dig_snippet=False, **kwargs):
    return [
        {
            "url": results[0]["url"],
            "status": "fetched",
            "fetched": True,
            "truncated": False,
            "content": "Contenu vérifié Paris demain 8°C 17°C",
        }
    ]

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo",)
web_search_py.page_fetch_service.fetch_selected_pages = fake_fetch_selected_pages

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Cherche sur le web la météo et les températures minimales et maximales demain à Paris",
        "num_results": 5,
        "language": "fr",
        "safe_search": True,
        "web_search_params": {
            "dig_snippet": True,
            "web_engine_nb_result_select": 1,
        },
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
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const result = JSON.parse(stdout.trim()) as {
            total_results: number;
            verified_fragments: Array<{ url: string; source_kind: string; relevance_score: number; critical_fragment: string }>;
            llm_context_block: { sources: Array<{ reference: string; url: string }>; content: string };
            reranked_sources: Array<{ url: string; relevance_score: number }>;
            trace: {
                page_fetches: Array<{ url: string; status: string; fetched: boolean }>;
                steps: Array<{ name: string; status: string; details?: Record<string, number | boolean | string> }>;
            };
        };

        expect(result.total_results).toBe(1);
        expect(result.verified_fragments).toEqual([
            expect.objectContaining({
                source_kind: 'page_content',
                critical_fragment: 'Contenu vérifié Paris demain 8°C 17°C',
                relevance_score: expect.any(Number),
            })
        ]);
        expect(result.reranked_sources[0]?.relevance_score).toBeGreaterThanOrEqual(7);
        expect(result.llm_context_block.sources[0]).toEqual(expect.objectContaining({
            reference: 'S1',
        }));
        expect(result.llm_context_block.content).toContain('Contenu vérifié Paris demain 8°C 17°C');
        expect(result.trace.page_fetches).toEqual([
            expect.objectContaining({
                status: 'fetched',
                fetched: true,
            })
        ]);
        expect(result.trace.steps.at(-1)).toEqual({
            name: 'build_context_block',
            status: 'completed',
            details: {
                source_count: 1,
                estimated_tokens: expect.any(Number),
                truncated: false,
            },
        });
    });

    it('extracts Paris from the exact QA weather prompt phrased with sur Paris', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys
from datetime import date as real_date

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py

class FakeDate(real_date):
    @classmethod
    def today(cls):
        return cls(2026, 4, 28)

web_search_py.date = FakeDate

print(json.dumps(web_search_py._analyze_query_intent('En allant sur internet, donne moi la météo sur Paris pour demain.'), ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(
            pythonExecutable,
            ['-c', pythonSnippet],
            {
                cwd: workspaceRoot,
                timeout: 30000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const intent = JSON.parse(stdout.trim()) as {
            location: string;
            normalized_query: string;
            location_terms: string[];
        };

        expect(intent.location).toBe('Paris');
        expect(intent.location_terms).toEqual(['paris']);
        expect(intent.normalized_query).toBe('météo et températures minimales et maximales à Paris le 29/04/2026');
    });

    it('extracts Paris from a short weather prompt without preposition', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys
from datetime import date as real_date

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py

class FakeDate(real_date):
    @classmethod
    def today(cls):
        return cls(2026, 4, 28)

web_search_py.date = FakeDate

print(json.dumps(web_search_py._analyze_query_intent('météo Paris demain'), ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(
            pythonExecutable,
            ['-c', pythonSnippet],
            {
                cwd: workspaceRoot,
                timeout: 30000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const intent = JSON.parse(stdout.trim()) as {
            location: string;
            normalized_query: string;
            location_terms: string[];
        };

        expect(intent.location).toBe('Paris');
        expect(intent.location_terms).toEqual(['paris']);
        expect(intent.normalized_query).toBe('météo et températures minimales et maximales à Paris le 29/04/2026');
    });

    it('falls back from duckduckgo to auto backend when the first backend is offline', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys
from datetime import date as real_date

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

seen_attempts = []

class FakeDate(real_date):
    @classmethod
    def today(cls):
        return cls(2026, 4, 28)

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        backend = kwargs.get("backend")
        seen_attempts.append({"backend": backend, "query": query or keywords})
        if backend == 'duckduckgo':
            raise RuntimeError('duckduckgo offline')
        return [
            {
                "title": "METEO PARIS par Météo-France - Prévisions météo gratuites",
                "href": "https://meteofrance.com/previsions-meteo-france/paris/75000",
                "body": "Retrouvez les prévisions météo Paris demain avec températures minimales et maximales."
            }
        ]

web_search_py.date = FakeDate
web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo", "auto")

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "En allant sur internet, donne moi la météo sur Paris pour demain.",
        "num_results": 5,
        "language": "fr",
        "safe_search": True,
    },
)

print(json.dumps({"result": result, "seenAttempts": seen_attempts}, ensure_ascii=False))
        `;

        const { stdout, stderr } = await execFileAsync(
            pythonExecutable,
            ['-c', pythonSnippet],
            {
                cwd: workspaceRoot,
                timeout: 30000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const payload = JSON.parse(stdout.trim()) as {
            result: {
                total_results: number;
                results: Array<{ url: string }>;
                trace: {
                    queries: Array<{
                        status: string;
                        attempts: Array<{ backend: string; status: string }>;
                    }>;
                };
            };
            seenAttempts: Array<{ backend: string; query: string }>;
        };

        expect(payload.result.total_results).toBe(1);
        expect(payload.result.results[0]?.url).toContain('/paris/');
        expect(payload.seenAttempts.slice(0, 2)).toEqual([
            expect.objectContaining({ backend: 'duckduckgo', query: 'site:meteofrance.com météo "Paris" le 29/04/2026' }),
            expect.objectContaining({ backend: 'auto', query: 'site:meteofrance.com météo "Paris" le 29/04/2026' })
        ]);
        expect(payload.result.trace.queries[0]).toEqual(expect.objectContaining({
            status: 'completed',
            attempts: [
                expect.objectContaining({ backend: 'duckduckgo', status: 'failed' }),
                expect.objectContaining({ backend: 'auto', status: 'completed' })
            ]
        }));
    });

    it('falls back to direct duckduckgo html scraping when DDGS backends are unavailable', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys
from datetime import date as real_date

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_py as web_search_py
from core.function_context import FunctionContext

class FakeDate(real_date):
    @classmethod
    def today(cls):
        return cls(2026, 4, 28)

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, **kwargs):
        raise RuntimeError('ddgs backend unavailable')

def fake_html_search(candidate_query, region, max_results):
    return [
        {
            "title": "METEO PARIS par Météo-France - Prévisions météo gratuites",
            "href": "https://meteofrance.com/previsions-meteo-france/paris/75000",
            "body": "Retrouvez les prévisions météo Paris demain avec températures minimales et maximales."
        }
    ]

web_search_py.date = FakeDate
web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo", "auto")
web_search_py._execute_duckduckgo_html_search = fake_html_search

result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "météo Paris demain",
        "num_results": 5,
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
                    PYTHONIOENCODING: 'utf-8'
                }
            }
        );

        expect(stderr).toBe('');

        const result = JSON.parse(stdout.trim()) as {
            total_results: number;
            normalized_query: string;
            results: Array<{ url: string }>;
            trace: {
                queries: Array<{
                    status: string;
                    attempts: Array<{ backend: string; status: string }>;
                }>;
            };
        };

        expect(result.normalized_query).toBe('météo et températures minimales et maximales à Paris le 29/04/2026');
        expect(result.total_results).toBe(1);
        expect(result.results[0]?.url).toContain('/paris/');
        expect(result.trace.queries[0]).toEqual(expect.objectContaining({
            status: 'completed',
            attempts: [
                expect.objectContaining({ backend: 'duckduckgo', status: 'failed' }),
                expect.objectContaining({ backend: 'auto', status: 'failed' }),
                expect.objectContaining({ backend: 'duckduckgo_html', status: 'completed' })
            ]
        }));
    });
});