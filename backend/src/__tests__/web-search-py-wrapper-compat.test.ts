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

describe('web_search_py wrapper compatibility', () => {
    it('keeps the historical import path bound to the preserved baseline module contract', async () => {
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
                "title": "METEO PARIS par Météo-France - Prévisions météo gratuites",
                "href": "https://meteofrance.com/previsions-meteo-france/paris/75000",
                "body": "Retrouvez les prévisions météo Paris demain avec températures minimales et maximales."
            }
        ]

web_search_py.date = FakeDate
web_search_py.DDGS = FakeDDGS
web_search_py._DEPS_OK = True
web_search_py._SEARCH_BACKENDS = ("duckduckgo",)

intent = web_search_py._analyze_query_intent('En allant sur internet, donne moi la météo sur Paris pour demain.')
result = web_search_py.run(
    FunctionContext(workspace_dir='.', function_name='web_search_py'),
    {
        "query": "Cherche sur le web la météo et les températures minimales et maximales demain à Paris",
        "num_results": 5,
        "language": "fr",
        "safe_search": True,
    },
)

print(json.dumps({
    "helperAvailable": callable(getattr(web_search_py, '_analyze_query_intent', None)),
    "helperCodePath": web_search_py._analyze_query_intent.__code__.co_filename,
    "runCodePath": web_search_py.run.__code__.co_filename,
    "intent": intent,
    "normalizedQuery": result["normalized_query"],
    "selectedUrl": result["results"][0]["url"],
    "seenQueries": seen_queries,
}, ensure_ascii=False))
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
            helperAvailable: boolean;
            helperCodePath: string;
            runCodePath: string;
            intent: {
                kind: string;
                location: string;
                target_date_phrase: string;
            };
            normalizedQuery: string;
            selectedUrl: string;
            seenQueries: string[];
        }>(stdout);

        expect(payload.helperAvailable).toBe(true);
        expect(payload.helperCodePath.replace(/\\/g, '/')).toContain('/web_search_py_old.py');
        expect(payload.runCodePath.replace(/\\/g, '/')).toContain('/web_search_py_old.py');
        expect(payload.intent).toEqual(expect.objectContaining({
            kind: 'weather',
            location: 'Paris',
            target_date_phrase: '29/04/2026',
        }));
        expect(payload.normalizedQuery).toBe('météo et températures minimales et maximales à Paris le 29/04/2026');
        expect(payload.selectedUrl).toContain('meteofrance.com/previsions-meteo-france/paris/75000');
        expect(payload.seenQueries).toContain('site:meteofrance.com météo "Paris" le 29/04/2026');
    });
});