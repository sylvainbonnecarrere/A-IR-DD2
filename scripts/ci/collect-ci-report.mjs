#!/usr/bin/env node
/**
 * US-J7-14 — collecte les rapports CI GitHub après chaque push de la branche de
 * release et produit un rapport markdown/JSON consignable dans
 * `Guides/Features/feature/suivi/j6-validation-report.md`.
 *
 * Le push et l'authentification `gh` sont faits par le responsable projet
 * (aucun hôte de production n'est accessible aux agents) :
 *
 *   gh auth login                      # une fois, sur la machine du responsable
 *   git push origin main               # push de la branche de release
 *   npm run ci:report -- --branch main --sha <sha> --out ci-report-<sha>.md
 *
 * Options :
 *   --repo <owner/repo>     (défaut : déduit de `git remote get-url origin`)
 *   --branch <name>         (défaut : main)
 *   --sha <sha>             ne garder que les runs de ce commit
 *   --workflows <liste>     (défaut : ci.yml,runtime.yml,security.yml,deploy.yml,release-artifacts.yml)
 *   --limit <n>             runs max par workflow (défaut : 10)
 *   --out <file.md>         écrit le rapport markdown dans un fichier
 *   --json <file.json>      écrit aussi le JSON brut
 *   --require-green         exit 1 si un run trouvé n'est pas vert (gate US-J7-15)
 *   --self-test             test hors ligne des fonctions de rapportage
 */

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildRunReport, summarizeReport, isRunGreen } = require('./build-run-report.cjs');

const execFileAsync = promisify(execFile);

const DEFAULT_WORKFLOWS = ['ci.yml', 'runtime.yml', 'security.yml', 'deploy.yml', 'release-artifacts.yml'];

function parseArgs(argv) {
    const args = { branch: 'main', workflows: DEFAULT_WORKFLOWS, limit: 10, requireGreen: false, selfTest: false };
    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        const next = () => argv[++i];
        switch (flag) {
            case '--repo': args.repo = next(); break;
            case '--branch': args.branch = next(); break;
            case '--sha': args.sha = next(); break;
            case '--workflows': args.workflows = next().split(',').map((w) => w.trim()).filter(Boolean); break;
            case '--limit': args.limit = Number(next()); break;
            case '--out': args.out = next(); break;
            case '--json': args.json = next(); break;
            case '--require-green': args.requireGreen = true; break;
            case '--self-test': args.selfTest = true; break;
            case '--help': args.help = true; break;
            default: throw new Error(`Option inconnue: ${flag}`);
        }
    }
    return args;
}

async function ghJson(args, apiPath, extra = []) {
    // Appel gh api simple (1 page) : --paginate --slurp peut renvoyer une
    // sortie vide selon la version de gh (vu sur un runner ubuntu-latest).
    const { stdout } = await execFileAsync('gh', ['api', apiPath, ...extra], {
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env },
    });
    if (!stdout.trim()) throw new Error(`gh api a renvoye un corps vide pour ${apiPath}`);
    return JSON.parse(stdout);
}

async function resolveRepo(args) {
    if (args.repo) return args.repo;
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin']);
    const url = stdout.trim();
    const match = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
    if (!match) throw new Error(`Impossible de déduire owner/repo depuis ${url}`);
    return match[1];
}

async function collectRunReport(repo, workflowId, run, generatedAt) {
    const jobs = await ghJson(null, `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
    const artifacts = await ghJson(null, `repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`);
    return buildRunReport({
        repository: repo,
        workflow: run.name ?? workflowId,
        run,
        jobsRaw: jobs,
        artifactsRaw: artifacts,
        generatedAt,
    });
}

async function collect(args) {
    const repo = await resolveRepo(args);
    const generatedAt = new Date().toISOString();
    const reports = [];
    const absent = [];
    for (const workflowId of args.workflows) {
        let runs;
        try {
            runs = await ghJson(null, `repos/${repo}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(args.branch)}&per_page=${args.limit}`);
        } catch (error) {
            absent.push({ workflow: workflowId, reason: `workflow introuvable ou sans run sur ${args.branch}: ${error.message}` });
            continue;
        }
        const pages = Array.isArray(runs) ? runs : [runs];
        const list = pages.flatMap((page) => page?.workflow_runs ?? []);
        const filtered = args.sha ? list.filter((run) => run.head_sha?.startsWith(args.sha)) : list;
        if (!filtered.length) {
            absent.push({ workflow: workflowId, reason: args.sha ? `aucun run pour le sha ${args.sha}` : `aucun run récent sur ${args.branch}` });
            continue;
        }
        for (const run of filtered) {
            reports.push(await collectRunReport(repo, workflowId, run, generatedAt));
        }
    }
    return { repo, branch: args.branch, sha: args.sha ?? null, generatedAt, reports, absent };
}

function renderMarkdown(collection) {
    const lines = [];
    lines.push(`## Rapport CI GitHub — ${collection.repo} — branche \`${collection.branch}\`${collection.sha ? ` — sha \`${collection.sha}\`` : ''}`);
    lines.push('');
    lines.push(`Généré le ${collection.generatedAt}.`);
    lines.push('');
    lines.push('Distinction des preuves : **labo Linux isolé** = preuve opérationnelle locale (US-J7-10, 5/5 PASS) ; **CI GitHub** = preuve de déploiement tracée (ce rapport + artefacts) ; **production** = déploiements GitHub (environnements staging/production, bundle sha256) exécutés par le responsable.');
    lines.push('');
    lines.push('| Workflow | Run | SHA court | Conclusion | Jobs verts |');
    lines.push('|---|---|---|---|---|');
    for (const report of collection.reports) {
        const green = report.jobs.filter((job) => job.conclusion === 'success' || job.conclusion === 'skipped').length;
        lines.push(`| ${report.workflow ?? '?'} | [#${report.run_id ?? '?'}](${report.url ?? '#'}) | \`${(report.sha ?? '?').slice(0, 7)}\` | ${report.conclusion ?? report.status ?? '?'} | ${green}/${report.jobs.length} |`);
    }
    for (const item of collection.absent) {
        lines.push(`| ${item.workflow} | — | — | absent | ${item.reason} |`);
    }
    lines.push('');
    for (const report of collection.reports) {
        lines.push(...summarizeReport(report));
        lines.push('');
    }
    return lines.join('\n');
}

function selfTest() {
    const assert = require('node:assert/strict');
    const run = { id: 42, run_number: 7, head_sha: 'abc123', head_branch: 'main', event: 'push', name: 'CI', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/42' };
    const jobs = [{ workflow_runs: [], jobs: [
        { name: 'backend-build', conclusion: 'success', status: 'completed', html_url: 'u1' },
        { name: 'backend-tests-mongo', conclusion: 'failure', status: 'completed', html_url: 'u2' },
    ] }];
    const artifacts = [{ artifacts: [{ name: 'backend-dist-abc', size_in_bytes: 10, expired: false, archive_download_url: 'a' }] }];
    const report = buildRunReport({ repository: 'o/r', workflow: 'CI', run, jobsRaw: jobs, artifactsRaw: artifacts, generatedAt: '2026-11-19T00:00:00Z' });
    assert.equal(report.jobs.length, 2);
    assert.equal(report.artifacts.length, 1);
    assert.equal(isRunGreen(report), false);
    report.jobs[1].conclusion = 'success';
    assert.equal(isRunGreen(report), true);
    const md = summarizeReport(report).join('\n');
    assert.ok(md.includes('| backend-build | success |'));
    assert.ok(md.includes('backend-dist-abc'));
    // slurp à plat (tableau de pages) aussi supporté
    const flat = buildRunReport({ repository: 'o/r', run, jobsRaw: [{ jobs: [{ name: 'j', conclusion: 'success' }] }], artifactsRaw: [] });
    assert.equal(flat.jobs.length, 1);
    console.log('[collect-ci-report] self-test OK');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log('usage: node scripts/ci/collect-ci-report.mjs [--repo o/r] [--branch main] [--sha <sha>] [--workflows a.yml,b.yml] [--limit n] [--out f.md] [--json f.json] [--require-green] [--self-test]');
        return;
    }
    if (args.selfTest) {
        selfTest();
        return;
    }
    const collection = await collect(args);
    const markdown = renderMarkdown(collection);
    console.log(markdown);
    if (args.out) writeFileSync(args.out, `${markdown}\n`);
    if (args.json) writeFileSync(args.json, `${JSON.stringify(collection, null, 2)}\n`);
    if (args.requireGreen) {
        const red = collection.reports.filter((report) => !isRunGreen(report));
        if (red.length > 0) {
            console.error(`[collect-ci-report] ${red.length} run(s) non vert(s): ${red.map((r) => `${r.workflow}#${r.run_id}`).join(', ')}`);
            process.exitCode = 1;
        }
    }
}

main().catch((error) => {
    console.error('[collect-ci-report] échec:', error.message);
    process.exitCode = 1;
});
