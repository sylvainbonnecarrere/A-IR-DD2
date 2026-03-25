#!/usr/bin/env node

const {
    runtimeImages,
    parseArgs,
    printOutput,
    summarizeStatus,
    buildTextReport,
    inspectDockerState,
    imageExists,
    verifyRuntimeImage
} = require('./runtime-utils.cjs');

async function main() {
    const flags = parseArgs(process.argv);
    const useJson = flags.has('--json');

    const dockerState = await inspectDockerState();
    const imageResults = [];

    for (const spec of runtimeImages) {
        const exists = dockerState.available ? await imageExists(spec.image) : false;
        if (!exists) {
            imageResults.push({
                label: spec.label,
                status: 'unhealthy',
                summary: `${spec.image} absente`,
                verified: false
            });
            continue;
        }

        const verification = dockerState.available ? await verifyRuntimeImage(spec) : { verified: false, detail: 'Docker indisponible' };
        imageResults.push({
            label: spec.label,
            status: verification.verified ? 'healthy' : 'unhealthy',
            summary: verification.verified
                ? `${spec.image} vérifiée`
                : `${spec.image} non vérifiée`,
            detail: verification.verified ? verification.output : verification.detail,
            verified: verification.verified
        });
    }

    const components = [
        {
            label: 'Docker CLI',
            status: dockerState.available ? 'healthy' : 'unhealthy',
            summary: dockerState.available
                ? `Docker disponible (${dockerState.version || 'version inconnue'})`
                : dockerState.detail
        },
        {
            label: 'Isolation Docker',
            status: !dockerState.available
                ? 'unhealthy'
                : dockerState.rootless
                    ? 'healthy'
                    : dockerState.executionReady
                        ? 'degraded'
                        : 'unhealthy',
            summary: dockerState.rootless
                ? 'Mode rootless confirmé'
                : dockerState.warning || dockerState.detail || 'Mode rootless non confirmé'
        },
        ...imageResults.map((result) => ({
            label: result.label,
            status: result.status,
            summary: result.summary
        }))
    ];

    const status = summarizeStatus(components);
    const payload = {
        status,
        docker: dockerState,
        images: imageResults
    };
    printOutput(useJson ? payload : buildTextReport('Runtime check', status, components), useJson);

    const runtimeReady = dockerState.available
        && dockerState.executionReady
        && imageResults.every((result) => result.verified);
    process.exit(runtimeReady ? 0 : 1);
}

void main();