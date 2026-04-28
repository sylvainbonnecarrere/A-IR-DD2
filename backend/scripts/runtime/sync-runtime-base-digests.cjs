#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
    backendRoot,
    parseArgs,
    printOutput,
    summarizeStatus,
    buildTextReport,
    runCommand
} = require('./runtime-utils.cjs');

const baseImageSpecs = [
    {
        image: 'debian:bookworm-slim',
        files: [
            path.resolve(backendRoot, 'docker/runtime/node/Dockerfile'),
            path.resolve(backendRoot, 'docker/runtime/python/Dockerfile')
        ]
    },
    {
        image: 'python:3.12-slim-bookworm',
        files: [
            path.resolve(backendRoot, 'docker/runtime/python/Dockerfile'),
            path.resolve(backendRoot, 'docker/runtime/python-provisioning/Dockerfile')
        ]
    }
];

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveRemoteDigest(image) {
    const result = await runCommand('docker', ['buildx', 'imagetools', 'inspect', image], {
        timeoutMs: 60000
    });

    if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(result.errorMessage || result.stderr.trim() || result.stdout.trim() || `Impossible d'inspecter ${image}`);
    }

    const match = (result.stdout || '').match(/^Digest:\s+(sha256:[a-f0-9]{64})$/m);
    if (!match) {
        throw new Error(`Digest introuvable pour ${image}`);
    }

    return match[1];
}

function syncSpecInFiles(spec, digest, options = {}) {
    const dryRun = options.dryRun === true;
    const checkOnly = options.checkOnly === true;
    const pattern = new RegExp(`${escapeRegExp(spec.image)}@sha256:[a-f0-9]{64}`, 'g');
    let replacements = 0;
    let outdatedFiles = 0;

    for (const filePath of spec.files) {
        const currentContent = fs.readFileSync(filePath, 'utf8');
        const matches = currentContent.match(pattern) || [];
        if (matches.length === 0) {
            throw new Error(`Référence ${spec.image}@sha256:<digest> introuvable dans ${path.relative(backendRoot, filePath)}`);
        }

        const expectedReference = `${spec.image}@${digest}`;
        const nextContent = currentContent.replace(pattern, expectedReference);

        if (nextContent !== currentContent) {
            outdatedFiles += 1;
            replacements += matches.length;
            if (!dryRun && !checkOnly) {
                fs.writeFileSync(filePath, nextContent, 'utf8');
            }
        }
    }

    return {
        image: spec.image,
        digest,
        replacements,
        outdatedFiles
    };
}

async function syncRuntimeBaseDigests(options = {}) {
    const dryRun = options.dryRun === true;
    const checkOnly = options.checkOnly === true;
    const results = [];

    for (const spec of baseImageSpecs) {
        const digest = await resolveRemoteDigest(spec.image);
        const update = syncSpecInFiles(spec, digest, { dryRun, checkOnly });
        results.push(update);
    }

    const components = results.map((result) => ({
        label: result.image,
        status: result.outdatedFiles === 0 ? 'healthy' : checkOnly ? 'unhealthy' : dryRun ? 'degraded' : 'healthy',
        summary: result.outdatedFiles === 0
            ? `Digest à jour (${result.digest})`
            : checkOnly
                ? `${result.outdatedFiles} fichier(s) à resynchroniser vers ${result.digest}`
                : dryRun
                    ? `${result.outdatedFiles} fichier(s) seraient mis à jour vers ${result.digest}`
                    : `${result.outdatedFiles} fichier(s) resynchronisé(s) vers ${result.digest}`
    }));
    const status = summarizeStatus(components);

    return {
        status,
        dryRun,
        checkOnly,
        results,
        summary: components.every((component) => component.status === 'healthy')
            ? 'Tous les digests de base sont à jour.'
            : checkOnly
                ? 'Des digests de base sont obsolètes.'
                : dryRun
                    ? 'Des digests de base doivent être resynchronisés.'
                    : 'Les digests de base ont été resynchronisés.',
        components
    };
}

async function main() {
    const flags = parseArgs(process.argv);
    const useJson = flags.has('--json');
    const dryRun = flags.has('--dry-run');
    const checkOnly = flags.has('--check');

    try {
        const payload = await syncRuntimeBaseDigests({ dryRun, checkOnly });
        printOutput(
            useJson
                ? payload
                : buildTextReport('Runtime base digest sync', payload.status, payload.components),
            useJson
        );
        process.exit(payload.status === 'unhealthy' ? 1 : 0);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const payload = {
            status: 'unhealthy',
            dryRun,
            checkOnly,
            results: [],
            components: [
                {
                    label: 'Digest sync',
                    status: 'unhealthy',
                    summary: message
                }
            ]
        };
        printOutput(
            useJson
                ? payload
                : buildTextReport('Runtime base digest sync', payload.status, payload.components),
            useJson
        );
        process.exit(1);
    }
}

if (require.main === module) {
    void main();
}

module.exports = {
    syncRuntimeBaseDigests
};