'use strict';

/**
 * Construit un rapport normalisé d'un run GitHub Actions à partir des réponses
 * API `jobs` et `artifacts` (paginées, éventuellement slurpées en tableau).
 * Utilisé par le job CI `report` (`.github/workflows/ci.yml`) et par le
 * collecteur `collect-ci-report.mjs` (US-J7-14).
 */

function unwrapPages(raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const pages = Array.isArray(parsed) ? parsed : [parsed];
    return pages.flatMap((page) => page?.jobs ?? page?.artifacts ?? page?.workflow_runs ?? []);
}

function normalizeJobs(jobsRaw) {
    return unwrapPages(jobsRaw)
        .filter((item) => item && typeof item === 'object' && 'name' in item)
        .map((job) => ({
            name: job.name,
            conclusion: job.conclusion ?? null,
            status: job.status ?? null,
            url: job.html_url ?? null,
        }));
}

function normalizeArtifacts(artifactsRaw) {
    return unwrapPages(artifactsRaw)
        .filter((item) => item && typeof item === 'object' && 'name' in item)
        .map((artifact) => ({
            name: artifact.name,
            size: artifact.size_in_bytes ?? null,
            expired: Boolean(artifact.expired),
            url: artifact.archive_download_url ?? null,
        }));
}

function buildRunReport({ repository, workflow, run, jobsRaw, artifactsRaw, generatedAt }) {
    const url = run?.html_url
        ?? (repository && run?.id
            ? `https://github.com/${repository}/actions/runs/${run.id}`
            : null);
    return {
        repository: repository ?? run?.repository ?? null,
        workflow: workflow ?? run?.name ?? null,
        run_id: run?.id ?? null,
        run_number: run?.run_number ?? null,
        sha: run?.head_sha ?? null,
        ref: run?.head_branch ?? null,
        event: run?.event ?? null,
        status: run?.status ?? null,
        conclusion: run?.conclusion ?? null,
        url,
        generated_at: generatedAt ?? new Date().toISOString(),
        jobs: normalizeJobs(jobsRaw),
        artifacts: normalizeArtifacts(artifactsRaw),
    };
}

/** Lignes markdown de synthèse d'un rapport (tableau jobs + artefacts). */
function summarizeReport(report) {
    const lines = [];
    lines.push(`### ${report.workflow ?? 'Workflow'} — run ${report.run_id ?? '?'} (${report.conclusion ?? report.status ?? '?'})`);
    lines.push('');
    lines.push(`- SHA: \`${report.sha ?? '?'}\` · ref: \`${report.ref ?? '?'}\` · event: ${report.event ?? '?'}`);
    lines.push(`- URL: ${report.url ?? 'n/a'}`);
    lines.push('');
    lines.push('| Job | Conclusion |');
    lines.push('|---|---|');
    for (const job of report.jobs) {
        lines.push(`| ${job.name} | ${job.conclusion ?? job.status ?? 'n/a'} |`);
    }
    if (report.artifacts.length > 0) {
        lines.push('');
        lines.push('| Artifact | Taille (o) | Expiré |');
        lines.push('|---|---|---|');
        for (const artifact of report.artifacts) {
            lines.push(`| ${artifact.name} | ${artifact.size ?? '?'} | ${artifact.expired ? 'oui' : 'non'} |`);
        }
    }
    return lines;
}

/** Un run est vert si tous ses jobs sont success ou skipped. */
function isRunGreen(report) {
    if (!report.jobs.length) return report.conclusion === 'success';
    return report.jobs.every((job) => job.conclusion === 'success' || job.conclusion === 'skipped');
}

// CLI : node scripts/ci/build-run-report.cjs <outFile> <jobsJsonFile> <artifactsJsonFile>
// (en CI, les métadonnées viennent des env GITHUB_*)
if (require.main === module) {
    const fs = require('node:fs');
    const [outFile, jobsFile, artifactsFile] = process.argv.slice(2);
    if (!outFile || !jobsFile || !artifactsFile) {
        console.error('usage: node build-run-report.cjs <outFile> <jobsJsonFile> <artifactsJsonFile>');
        process.exit(2);
    }
    const report = buildRunReport({
        repository: process.env.GITHUB_REPOSITORY ?? null,
        workflow: process.env.GITHUB_WORKFLOW ?? null,
        run: {
            id: process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null,
            run_number: process.env.GITHUB_RUN_NUMBER ? Number(process.env.GITHUB_RUN_NUMBER) : null,
            head_sha: process.env.GITHUB_SHA ?? null,
            head_branch: process.env.GITHUB_REF_NAME ?? null,
            event: process.env.GITHUB_EVENT_NAME ?? null,
            html_url: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
                ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
                : null,
        },
        jobsRaw: fs.readFileSync(jobsFile, 'utf8'),
        artifactsRaw: fs.readFileSync(artifactsFile, 'utf8'),
    });
    fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { buildRunReport, summarizeReport, isRunGreen, normalizeJobs, normalizeArtifacts };
