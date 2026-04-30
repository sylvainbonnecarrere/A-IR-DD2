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

describe('web_search_py clean presearch entrypoint', () => {
    it('uses transformed_query_raw to build one explicit engine plan per allowed domain and executes each plan once', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_presearch as presearch
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
        if 'site:wikipedia.org' in engine_query:
            return [
                {
                        'title': "Wikipedia - Drones de l'armée ukrainienne",
                    'href': 'https://wikipedia.org/wiki/Drones_de_l_armee_ukrainienne',
                    'body': 'Inventaire des drones TB2 Bayraktar, FPV et reconnaissance 2026.'
                }
            ]
        if 'site:drone-actu.fr' in engine_query:
            return [
                {
                    'title': 'Drone Actu - Armée ukrainienne drones 2026',
                    'href': 'https://drone-actu.fr/armee-ukrainienne-drones-2026',
                    'body': 'Analyse des modèles UAV, portée et usages tactiques.'
                }
            ]
        return []

def fake_transform(context, user_query, *, system_context, runtime_params):
    return {
        'normalized_query': 'armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
        'queries': ['armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026'],
        'english_queries': [],
        'must_include_terms': [],
        'exclude_terms': [],
        'raw_output': 'armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
        'transformed_query_raw': 'armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
        'mode': 'llm',
    }

def fake_rerank(context, user_query, transformed_query, results, fetched_fragments, *, runtime_params):
    selected = []
    for result in results:
        selected.append({
            'title': result['title'],
            'url': result['url'],
            'source_kind': 'search_snippet',
            'relevance_score': 9,
            'reasoning': 'source ciblée pertinente',
            'critical_fragment': result['snippet'],
            'mode': 'llm',
        })
    return {
        'evaluations': selected,
        'selected': selected,
    }

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
presearch.transform_query = fake_transform
web_search_py.rerank_sources = fake_rerank

result = web_search_py.run(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            'web_search': {
                'params': {
                    'allowed_domains': ['wikipedia.org', 'drone-actu.fr'],
                    'query_transformation': 'Q={{user_query}}',
                    'reranking_prompt': 'RERANK {{user_query}} {{source_content}}',
                    'relevance_threshold': 7,
                    'rerank_strategy': 'Fast',
                    'max_uses': 5,
                    'web_engine_search': True,
                    'web_engine': 'duckduckgo.com',
                    'web_engine_nb_result_select': 3,
                },
                'llm_runtime': {
                    'provider': 'OpenAI',
                    'model': 'gpt-test',
                    'api_key': 'sk-test',
                }
            }
        }
    ),
    {
        'query': "Peux tu chercher sur internet les différents types de drones de l'armée Ukrainienne ?",
        'num_results': 5,
        'language': 'fr',
        'safe_search': True,
    },
)

print(json.dumps({'result': result, 'seen_queries': seen_queries}, ensure_ascii=False))
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
                query: string;
                normalized_query: string;
                transformed_query_raw: string;
                system_context: string[];
                engine_query_plans: Array<{ domain: string; engine: string; engine_query_text: string; engine_query_url: string }>;
                engine_execution_trace: Array<{ domain: string; engine: string; engine_query_text: string; engine_query_url: string; backend: string; status: string; result_count: number }>;
                results_raw: Array<{ href: string; title: string; body: string }>;
                total_results: number;
                trace: {
                    system_context: string[];
                    transformed_query_raw: string;
                    engine_query_plans: Array<{ domain: string; engine_query_text: string; engine_query_url: string }>;
                    engine_execution_trace: Array<{ domain: string; backend: string; status: string; result_count: number }>;
                    queries: Array<{ query: string; engine: string; backend: string; engine_query_url: string; status: string; result_count: number }>;
                    steps: Array<{ name: string; status: string }>;
                    errors: Array<{ step: string; message: string }>;
                };
            };
            seen_queries: Array<{ query: string; backend: string; region: string; safesearch: string }>;
        };

        expect(payload.result.query).toBe("Peux tu chercher sur internet les différents types de drones de l'armée Ukrainienne ?");
        expect(payload.result.normalized_query).toBe('armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026');
        expect(payload.result.transformed_query_raw).toBe(payload.result.normalized_query);
        expect(payload.result.system_context).toEqual(expect.arrayContaining(['language:fr']));
        expect(payload.result.engine_query_plans).toEqual([
            expect.objectContaining({
                domain: 'wikipedia.org',
                engine: 'duckduckgo.com',
                engine_query_text: 'site:wikipedia.org armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
                engine_query_url: 'https://duckduckgo.com/?q=site%3Awikipedia.org+arm%C3%A9e+ukrainienne+drones+types+mod%C3%A8les+UAV+TB2+Bayraktar+Shahed+FPV+reconnaissance+armement+surveillance+combat+tactique+capacit%C3%A9s+sp%C3%A9cifications+port%C3%A9e+charge+utile+op%C3%A9rateurs+d%C3%A9ploiement+unit%C3%A9s+inventaire+2026',
            }),
            expect.objectContaining({
                domain: 'drone-actu.fr',
                engine: 'duckduckgo.com',
                engine_query_text: 'site:drone-actu.fr armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
                engine_query_url: 'https://duckduckgo.com/?q=site%3Adrone-actu.fr+arm%C3%A9e+ukrainienne+drones+types+mod%C3%A8les+UAV+TB2+Bayraktar+Shahed+FPV+reconnaissance+armement+surveillance+combat+tactique+capacit%C3%A9s+sp%C3%A9cifications+port%C3%A9e+charge+utile+op%C3%A9rateurs+d%C3%A9ploiement+unit%C3%A9s+inventaire+2026',
            }),
        ]);
        expect(payload.seen_queries).toEqual([
            {
                query: 'site:wikipedia.org armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
                backend: 'html',
                region: 'fr-fr',
                safesearch: 'on',
            },
            {
                query: 'site:drone-actu.fr armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
                backend: 'html',
                region: 'fr-fr',
                safesearch: 'on',
            },
        ]);
        expect(payload.result.engine_execution_trace).toEqual([
            expect.objectContaining({ domain: 'wikipedia.org', adapter_name: 'DuckDuckGoSearchAdapter', execution_kind: 'ddgs_text', query_engine: 'https://duckduckgo.com/?q=site%3Awikipedia.org+arm%C3%A9e+ukrainienne+drones+types+mod%C3%A8les+UAV+TB2+Bayraktar+Shahed+FPV+reconnaissance+armement+surveillance+combat+tactique+capacit%C3%A9s+sp%C3%A9cifications+port%C3%A9e+charge+utile+op%C3%A9rateurs+d%C3%A9ploiement+unit%C3%A9s+inventaire+2026', backend: 'ddgs_text_html', status: 'completed', result_count: 1 }),
            expect.objectContaining({ domain: 'drone-actu.fr', adapter_name: 'DuckDuckGoSearchAdapter', execution_kind: 'ddgs_text', query_engine: 'https://duckduckgo.com/?q=site%3Adrone-actu.fr+arm%C3%A9e+ukrainienne+drones+types+mod%C3%A8les+UAV+TB2+Bayraktar+Shahed+FPV+reconnaissance+armement+surveillance+combat+tactique+capacit%C3%A9s+sp%C3%A9cifications+port%C3%A9e+charge+utile+op%C3%A9rateurs+d%C3%A9ploiement+unit%C3%A9s+inventaire+2026', backend: 'ddgs_text_html', status: 'completed', result_count: 1 }),
        ]);
        expect(payload.result.trace.system_context).toEqual(payload.result.system_context);
        expect(payload.result.trace.transformed_query_raw).toBe(payload.result.transformed_query_raw);
        expect(payload.result.trace.engine_query_plans).toHaveLength(2);
        expect(payload.result.trace.engine_execution_trace).toHaveLength(2);
        expect(payload.result.trace.queries).toEqual([
            expect.objectContaining({
                query: 'site:wikipedia.org armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
                engine: 'duckduckgo.com',
                backend: 'ddgs_text_html',
                status: 'completed',
                result_count: 1,
            }),
            expect.objectContaining({
                query: 'site:drone-actu.fr armée ukrainienne drones types modèles UAV TB2 Bayraktar Shahed FPV reconnaissance armement surveillance combat tactique capacités spécifications portée charge utile opérateurs déploiement unités inventaire 2026',
                engine: 'duckduckgo.com',
                backend: 'ddgs_text_html',
                status: 'completed',
                result_count: 1,
            }),
        ]);
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
        expect(payload.result.results_raw).toHaveLength(2);
        expect(payload.result.total_results).toBe(2);
    });

    it('returns a bounded runtime error for a configured engine adapter that is not yet executable', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_presearch as presearch
import native.web_search_py as web_search_py
from core.function_context import FunctionContext

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, **kwargs):
        raise AssertionError('DDGS should not be called for unsupported runtime engines')

def fake_transform(context, user_query, *, system_context, runtime_params):
    return {
        'normalized_query': 'spectacles semaine Paris Bercy programmation dates horaires',
        'queries': ['spectacles semaine Paris Bercy programmation dates horaires'],
        'english_queries': [],
        'must_include_terms': [],
        'exclude_terms': [],
        'raw_output': 'spectacles semaine Paris Bercy programmation dates horaires',
        'transformed_query_raw': 'spectacles semaine Paris Bercy programmation dates horaires',
        'mode': 'llm',
    }

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
presearch.transform_query = fake_transform

result = web_search_py.run(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            'web_search': {
                'params': {
                    'allowed_domains': [],
                    'query_transformation': 'Q={{user_query}}',
                    'reranking_prompt': 'RERANK {{user_query}} {{source_content}}',
                    'web_engine_search': True,
                    'web_engine': 'google.com',
                    'web_engine_nb_result_select': 3,
                },
                'llm_runtime': {
                    'provider': 'OpenAI',
                    'model': 'gpt-test',
                    'api_key': 'sk-test',
                }
            }
        }
    ),
    {
        'query': 'Peux tu chercher sur internet les spectacles cette semaine à Paris dans la salle de Bercy ?',
        'num_results': 5,
        'language': 'fr',
        'safe_search': True,
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

        const payload = JSON.parse(stdout.trim()) as {
            error: { step: string; type: string; message: string };
            trace: {
                transformed_query_raw: string;
                engine_query_plans: Array<{ engine: string; adapter_name: string; engine_query_url: string }>;
                errors: Array<{ step: string; type: string; message: string }>;
            };
        };

        expect(payload.error).toEqual({
            step: 'execute_search',
            type: 'ValueError',
            message: 'SEARCH_ENGINE_UNAVAILABLE:google.com',
        });
        expect(payload.trace.transformed_query_raw).toBe('spectacles semaine Paris Bercy programmation dates horaires');
        expect(payload.trace.engine_query_plans).toEqual([
            expect.objectContaining({
                engine: 'google.com',
                adapter_name: 'GoogleSearchAdapter',
                engine_query_url: 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires',
            }),
        ]);
        expect(payload.trace.errors).toEqual([
            {
                step: 'execute_search',
                type: 'ValueError',
                message: 'SEARCH_ENGINE_UNAVAILABLE:google.com',
            },
        ]);
    });

    it('stops before search execution when hidden query transformation fails instead of falling back to the raw query', async () => {
        const workspaceRoot = resolveWorkspaceRoot();
        const pythonExecutable = resolvePythonExecutable(workspaceRoot);
        const pythonRoot = path.join(workspaceRoot, 'backend', 'python');

        const pythonSnippet = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(pythonRoot)})

import native.web_search_presearch as presearch
import native.web_search_py as web_search_py
from core.function_context import FunctionContext

seen_queries = []

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, backend=None, **kwargs):
        seen_queries.append(query or keywords)
        return []

def failing_transform(context, user_query, *, system_context, runtime_params):
    return {
        'normalized_query': 'quel temps il fera demain à paris',
        'queries': ['quel temps il fera demain à paris'],
        'english_queries': [],
        'must_include_terms': [],
        'exclude_terms': [],
        'raw_output': '[Erreur LLM] LMStudio API error (http://192.168.56.1:1234): 502 - terminated',
        'transformed_query_raw': 'quel temps il fera demain à paris',
        'mode': 'fallback',
    }

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
presearch.transform_query = failing_transform

result = web_search_py.run(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            'web_search': {
                'params': {
                    'query_transformation': 'Q={{user_query}}',
                    'web_engine_search': True,
                    'web_engine': 'duckduckgo.com',
                    'web_engine_nb_result_select': 3,
                },
                'llm_runtime': {
                    'provider': 'LLM local (on premise)',
                    'model': 'local-model',
                    'endpoint': 'http://host.docker.internal:1234',
                }
            }
        }
    ),
    {
        'query': 'Peux tu chercher sur internet quel temps il fera demain à Paris ?',
        'num_results': 5,
        'language': 'fr',
        'safe_search': True,
    },
)

print(json.dumps({'result': result, 'seen_queries': seen_queries}, ensure_ascii=False))
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
                results: unknown[];
                normalized_query: string;
                error?: { step: string; type: string; message: string };
                trace: {
                    errors: Array<{ step: string; message: string }>;
                    steps: Array<{ name: string; status: string }>;
                };
            };
            seen_queries: string[];
        };

        expect(payload.seen_queries).toEqual([]);
        expect(payload.result.results).toEqual([]);
        expect(payload.result.error).toEqual(expect.objectContaining({
            step: 'build_search_plan',
            message: expect.stringContaining('QUERY_TRANSFORMATION_FAILED:'),
        }));
        expect(payload.result.trace.errors[0]?.message).toContain('LMStudio API error');
        expect(payload.result.trace.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'build_search_plan', status: 'failed' }),
        ]));
    });
});