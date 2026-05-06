import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function parseLastJsonLine<T>(stdout: string): T {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    return JSON.parse(lines[lines.length - 1]) as T;
}

function parseJsonLines(stdout: string): unknown[] {
    return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

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

        const payload = parseLastJsonLine<{
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
        }>(stdout);

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

    it('uses duckduckgo.com by default and exposes the top 3 engine results for QA visibility', async () => {
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
        return [
            {
                'title': 'Météo-France Paris demain',
                'href': 'https://meteofrance.com/previsions-meteo-france/paris/75000',
                'body': 'Prévisions météo Paris demain 8°C 17°C.'
            },
            {
                'title': 'La Chaîne Météo Paris demain',
                'href': 'https://www.lachainemeteo.com/meteo-france/ville-33/previsions-meteo-paris-demain',
                'body': 'Temps prévu demain à Paris avec minimales et maximales.'
            },
            {
                'title': 'Weather.com Paris demain',
                'href': 'https://weather.com/fr-FR/temps/paris',
                'body': 'Prévisions météo heure par heure et sur 10 jours.'
            },
        ]

def fake_transform(context, user_query, *, system_context, runtime_params):
    return {
        'normalized_query': 'météo et températures minimales et maximales à Paris le 06/05/2026',
        'queries': ['météo et températures minimales et maximales à Paris le 06/05/2026'],
        'english_queries': [],
        'must_include_terms': [],
        'exclude_terms': [],
        'raw_output': 'météo et températures minimales et maximales à Paris le 06/05/2026',
        'transformed_query_raw': 'météo et températures minimales et maximales à Paris le 06/05/2026',
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
            'reasoning': 'résultat météo visible QA',
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
                    'query_transformation': 'Q={{user_query}}',
                    'reranking_prompt': 'RERANK {{user_query}} {{source_content}}',
                    'web_engine_search': True,
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
        'query': 'En allant sur internet donne moi la météo pour demain à Paris.',
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

        const payload = parseLastJsonLine<{
            result: {
                total_results: number;
                engine_top_results: Array<{ rank: number; title: string; url: string; snippet: string }>;
                trace: {
                    input: { web_engine: string };
                    engine_top_results: Array<{ rank: number; title: string; url: string; snippet: string }>;
                };
            };
            seen_queries: Array<{ query: string; backend: string; region: string; safesearch: string }>;
        }>(stdout);

        expect(payload.result.trace.input.web_engine).toBe('duckduckgo.com');
        expect(payload.seen_queries[0]?.backend).toBe('duckduckgo');
        expect(payload.result.total_results).toBe(3);
        expect(payload.result.engine_top_results).toEqual([
            expect.objectContaining({ rank: 1, title: 'Météo-France Paris demain', url: 'https://meteofrance.com/previsions-meteo-france/paris/75000' }),
            expect.objectContaining({ rank: 2, title: 'La Chaîne Météo Paris demain', url: 'https://www.lachainemeteo.com/meteo-france/ville-33/previsions-meteo-paris-demain' }),
            expect.objectContaining({ rank: 3, title: 'Weather.com Paris demain', url: 'https://weather.com/fr-FR/temps/paris' }),
        ]);
        expect(payload.result.trace.engine_top_results).toEqual(payload.result.engine_top_results);
    });

    it('surfaces rerank diagnostics when engine results exist but none pass the relevance threshold', async () => {
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

    def text(self, query=None, keywords=None, region=None, safesearch=None, max_results=None, backend=None, **kwargs):
        return [
            {
                'title': 'Météo-France Paris demain',
                'href': 'https://meteofrance.com/previsions-meteo-france/paris/75000',
                'body': 'Prévisions météo Paris demain 8°C 17°C.'
            },
            {
                'title': 'La Chaîne Météo Paris demain',
                'href': 'https://www.lachainemeteo.com/meteo-france/ville-33/previsions-meteo-paris-demain',
                'body': 'Temps prévu demain à Paris avec minimales et maximales.'
            },
            {
                'title': 'Weather.com Paris demain',
                'href': 'https://weather.com/fr-FR/temps/paris',
                'body': 'Prévisions météo heure par heure et sur 10 jours.'
            },
        ]

def fake_transform(context, user_query, *, system_context, runtime_params):
    return {
        'normalized_query': 'météo et températures minimales et maximales à Paris le 06/05/2026',
        'queries': ['météo et températures minimales et maximales à Paris le 06/05/2026'],
        'english_queries': [],
        'must_include_terms': [],
        'exclude_terms': [],
        'raw_output': 'météo et températures minimales et maximales à Paris le 06/05/2026',
        'transformed_query_raw': 'météo et températures minimales et maximales à Paris le 06/05/2026',
        'mode': 'llm',
    }

def fake_rerank(context, user_query, transformed_query, results, fetched_fragments, *, runtime_params):
    return {
        'evaluations': [
            {
                'title': results[0]['title'],
                'url': results[0]['url'],
                'source_kind': 'search_snippet',
                'relevance_score': 6,
                'reasoning': 'recouvrement lexical partiel',
                'critical_fragment': results[0]['snippet'],
                'mode': 'fallback',
                'fallback_reason': 'llm_error',
                'llm_error': 'LMStudio request timeout exceeded after 10000ms',
            },
            {
                'title': results[1]['title'],
                'url': results[1]['url'],
                'source_kind': 'search_snippet',
                'relevance_score': 5,
                'reasoning': 'source plausible mais trop générique',
                'critical_fragment': results[1]['snippet'],
                'mode': 'fallback',
                'fallback_reason': 'llm_error',
                'llm_error': 'LMStudio request timeout exceeded after 10000ms',
            },
            {
                'title': results[2]['title'],
                'url': results[2]['url'],
                'source_kind': 'search_snippet',
                'relevance_score': 4,
                'reasoning': 'résultat trop généraliste',
                'critical_fragment': results[2]['snippet'],
                'mode': 'fallback',
                'fallback_reason': 'llm_error',
                'llm_error': 'LMStudio request timeout exceeded after 10000ms',
            },
        ],
        'selected': [],
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
                    'query_transformation': 'Q={{user_query}}',
                    'reranking_prompt': 'RERANK {{user_query}} {{source_content}}',
                    'web_engine_search': True,
                    'web_engine_nb_result_select': 3,
                    'relevance_threshold': 7,
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
        'query': 'En allant sur internet donne moi la météo pour demain à Paris.',
        'num_results': 5,
        'language': 'fr',
        'safe_search': True,
    },
)

print(json.dumps({'result': result}, ensure_ascii=False))
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

        const payload = parseLastJsonLine<{
            result: {
                engine_top_results: Array<{ rank: number; title: string; url: string }>;
                rerank_diagnostics: {
                    threshold: number;
                    evaluation_count: number;
                    selected_count: number;
                    best_score: number;
                    fallback_count: number;
                    top_candidates: Array<{
                        rank: number;
                        title: string;
                        relevance_score: number;
                        mode: string;
                        fallback_reason: string;
                        llm_error: string;
                    }>;
                };
                error: {
                    step: string;
                    type: string;
                    message: string;
                    diagnostics: {
                        threshold: number;
                        best_score: number;
                    };
                };
                trace: {
                    rerank_diagnostics: {
                        threshold: number;
                        best_score: number;
                        top_candidates: Array<{ llm_error: string }>;
                    };
                };
            };
        }>(stdout);

        expect(payload.result.engine_top_results).toHaveLength(3);
        expect(payload.result.error.step).toBe('rerank_sources');
        expect(payload.result.error.type).toBe('NO_RELEVANT_RESULT');
        expect(payload.result.error.message).toContain('Seuil=7');
        expect(payload.result.error.message).toContain('meilleur_score=6');
        expect(payload.result.error.message).toContain('LMStudio request timeout exceeded after 10000ms');
        expect(payload.result.rerank_diagnostics).toEqual(expect.objectContaining({
            threshold: 7,
            evaluation_count: 3,
            selected_count: 0,
            best_score: 6,
            fallback_count: 3,
        }));
        expect(payload.result.rerank_diagnostics.top_candidates[0]).toEqual(expect.objectContaining({
            rank: 1,
            relevance_score: 6,
            mode: 'fallback',
            fallback_reason: 'llm_error',
            llm_error: 'LMStudio request timeout exceeded after 10000ms',
        }));
        expect(payload.result.rerank_diagnostics.top_candidates.map((candidate) => candidate.title)).toEqual(expect.arrayContaining([
            'Météo-France Paris demain',
            'La Chaîne Météo Paris demain',
            'Weather.com Paris demain',
        ]));
        expect(payload.result.error.diagnostics).toEqual(expect.objectContaining({ threshold: 7, best_score: 6 }));
        expect(payload.result.trace.rerank_diagnostics).toEqual(payload.result.rerank_diagnostics);
    });

    it('executes the configured http_search_page engine and preserves the selected engine request in trace', async () => {
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

requested_urls = []

class FakeResponse:
    def __init__(self, payload, url):
        self._payload = payload.encode('utf-8')
        self._url = url
        self.headers = {'Content-Type': 'text/html; charset=utf-8'}
        self.status = 200

    def read(self, *_args, **_kwargs):
        return self._payload

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, **kwargs):
                raise AssertionError('DDGS should not be called for http_search_page engines')

def fake_urlopen(request, timeout=15):
        url = request.full_url if hasattr(request, 'full_url') else request.get_full_url()
        requested_urls.append({'url': url, 'timeout': timeout})
        return FakeResponse('''
<html>
    <body>
        <div id="search">
            <div class="g">
                <a href="/url?q=https://www.accorarena.com/fr/programmation/spectacles-bercy&sa=U&ved=1">
                    <h3>Accor Arena Paris Bercy - Programmation</h3>
                </a>
                <div>Concerts et spectacles cette semaine à Paris Bercy, dates et horaires.</div>
            </div>
        </div>
    </body>
</html>
''', url)

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

def fake_rerank(context, user_query, transformed_query, results, fetched_fragments, *, runtime_params):
    selected = []
    for result in results:
        selected.append({
            'title': result['title'],
            'url': result['url'],
            'source_kind': 'search_snippet',
            'relevance_score': 9,
            'reasoning': 'source moteur configuré',
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
presearch.urlopen = fake_urlopen
web_search_py.rerank_sources = fake_rerank

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

print(json.dumps({'result': result, 'requested_urls': requested_urls}, ensure_ascii=False))
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

        const payload = parseLastJsonLine<{
            result: {
                total_results: number;
                results: Array<{ url: string }>;
                trace: {
                    transformed_query_raw: string;
                    engine_query_plans: Array<{ engine: string; adapter_name: string; engine_query_url: string }>;
                    engine_execution_trace: Array<{
                        engine: string;
                        execution_kind: string;
                        query_engine: string;
                        requested_url: string;
                        final_url: string;
                        http_status: number;
                        status: string;
                    }>;
                    queries: Array<{
                        query: string;
                        engine: string;
                        backend: string;
                        engine_query_url: string;
                        status: string;
                    }>;
                    errors: Array<{ step: string; type: string; message: string }>;
                };
            };
            requested_urls: Array<{ url: string; timeout: number }>;
        }>(stdout);

        expect(payload.result.total_results).toBe(1);
        expect(payload.result.results[0]?.url).toBe('https://www.accorarena.com/fr/programmation/spectacles-bercy');
        expect(payload.requested_urls).toEqual([
            {
                url: 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires',
                timeout: 15,
            },
        ]);
        expect(payload.result.trace.transformed_query_raw).toBe('spectacles semaine Paris Bercy programmation dates horaires');
        expect(payload.result.trace.engine_query_plans).toEqual([
            expect.objectContaining({
                engine: 'google.com',
                adapter_name: 'GoogleSearchAdapter',
                engine_query_url: 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires',
            }),
        ]);
        expect(payload.result.trace.engine_execution_trace).toEqual([
            expect.objectContaining({
                engine: 'google.com',
                execution_kind: 'http_search_page',
                query_engine: 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires',
                requested_url: 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires',
                final_url: 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires',
                http_status: 200,
                status: 'completed',
            }),
        ]);
        expect(payload.result.trace.queries).toEqual([
            expect.objectContaining({
                query: 'spectacles semaine Paris Bercy programmation dates horaires',
                engine: 'google.com',
                backend: 'google.com',
                engine_query_url: 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires',
                status: 'completed',
            }),
        ]);
        expect(payload.result.trace.errors).toEqual([]);
    });

    it('uses a mocked transformed query to reach sandbox web execution and emits detailed debug progress', async () => {
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

class FakeResponse:
    def __init__(self, payload, url):
        self._payload = payload.encode('utf-8')
        self._url = url
        self.headers = {'Content-Type': 'text/html; charset=utf-8'}
        self.status = 200

    def read(self, size=-1):
        return self._payload if size is None or size < 0 else self._payload[:size]

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

class FakeDDGS:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, **kwargs):
        raise AssertionError('DDGS should not be called when mock_transformed_query targets google.com http_search_page')

def fake_urlopen(request, timeout=15):
    url = request.full_url if hasattr(request, 'full_url') else request.get_full_url()
    return FakeResponse('''
<html>
  <body>
    <div id="search">
      <div class="g">
        <a href="/url?q=https%3A%2F%2Fwww.accorarena.com%2Ffr%2Fprogrammation%2Fspectacles-bercy&sa=U&ved=1">
          <h3>Accor Arena Paris Bercy - Programmation</h3>
        </a>
        <div>Concerts et spectacles cette semaine à Paris Bercy, dates et horaires.</div>
      </div>
    </div>
  </body>
</html>
''', url)

def fake_rerank(context, user_query, transformed_query, results, fetched_fragments, *, runtime_params):
    selected = []
    for result in results:
        selected.append({
            'title': result['title'],
            'url': result['url'],
            'source_kind': 'search_snippet',
            'relevance_score': 9,
            'reasoning': 'source web mockée',
            'critical_fragment': result['snippet'],
            'mode': 'llm',
        })
    return {
        'evaluations': selected,
        'selected': selected,
    }

web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
presearch.urlopen = fake_urlopen
web_search_py.rerank_sources = fake_rerank

result = web_search_py.run(
    FunctionContext(
        workspace_dir='.',
        function_name='web_search_py',
        private_context={
            'web_search': {
                'params': {
                    'mock_transformed_query': 'spectacles semaine Paris Bercy programmation dates horaires',
                    'query_transformation': 'Q={{user_query}}',
                    'reranking_prompt': 'RERANK {{user_query}} {{source_content}}',
                    'web_engine_search': True,
                    'web_engine': 'google.com',
                    'web_engine_nb_result_select': 3,
                    'dig_snippet': False,
                },
                'llm_runtime': {
                    'provider': 'LLM local (on premise)',
                    'model': 'mock-local',
                    'endpoint': 'http://host.docker.internal:1234',
                }
            }
        }
    ),
    {
        'query': 'Quels sont les spectacles cette semaine à Paris dans la salle de Bercy ?',
        'num_results': 3,
        'language': 'fr',
        'safe_search': True,
    },
)

print(json.dumps({'result': result}, ensure_ascii=False))
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

        const lines = parseJsonLines(stdout) as Array<Record<string, unknown>>;
        const payload = lines[lines.length - 1] as {
            result: {
                total_results: number;
                results: Array<{ url: string; title: string }>;
                trace: {
                    transformed_query_raw: string;
                    engine_query_plans: Array<{ engine_query_url: string }>;
                    engine_execution_trace: Array<{
                        execution_kind: string;
                        requested_url: string;
                        final_url: string;
                        http_status: number;
                        status: string;
                    }>;
                    engine_top_results: Array<{ title: string; url: string }>;
                };
            };
        };
        const debugEvents = lines.slice(0, -1).filter((line) => typeof line.WEB_SEARCH_DEBUG === 'string');
        const googleUrl = 'https://www.google.com/search?q=spectacles+semaine+Paris+Bercy+programmation+dates+horaires';

        expect(payload.result.total_results).toBe(1);
        expect(payload.result.results[0]).toEqual(expect.objectContaining({
            title: 'Accor Arena Paris Bercy - Programmation',
            url: 'https://www.accorarena.com/fr/programmation/spectacles-bercy',
        }));
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
                status: 'completed',
            }),
        ]);
        expect(payload.result.trace.engine_top_results).toEqual([
            expect.objectContaining({
                title: 'Accor Arena Paris Bercy - Programmation',
                url: 'https://www.accorarena.com/fr/programmation/spectacles-bercy',
            }),
        ]);
        expect(debugEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({
                WEB_SEARCH_DEBUG: 'build_search_plan_start',
                has_mock_transformed_query: true,
                web_engine: 'google.com',
            }),
            expect.objectContaining({
                WEB_SEARCH_DEBUG: 'query_transformation_mock',
                transformed_query_raw: 'spectacles semaine Paris Bercy programmation dates horaires',
            }),
            expect.objectContaining({
                WEB_SEARCH_DEBUG: 'build_search_plan_ready',
                engine_query_plans: [
                    expect.objectContaining({ engine_query_url: googleUrl }),
                ],
            }),
            expect.objectContaining({
                WEB_SEARCH_DEBUG: 'engine_query_dispatch',
                engine_query_url: googleUrl,
                execution_kind: 'http_search_page',
            }),
            expect.objectContaining({
                WEB_SEARCH_DEBUG: 'engine_query_result',
                engine_query_url: googleUrl,
                status: 'completed',
                result_count: 1,
                top_results: [
                    expect.objectContaining({
                        title: 'Accor Arena Paris Bercy - Programmation',
                    }),
                ],
            }),
            expect.objectContaining({
                WEB_SEARCH_DEBUG: 'engine_execution',
                top_results: [
                    expect.objectContaining({
                        title: 'Accor Arena Paris Bercy - Programmation',
                    }),
                ],
            }),
        ]));
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

        const payload = parseLastJsonLine<{
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
        }>(stdout);

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