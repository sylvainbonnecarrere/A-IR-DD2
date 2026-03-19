#!/usr/bin/env node

const {
    runtimeImages,
    parseArgs,
    printOutput,
    summarizeStatus,
    buildTextReport,
    inspectDockerState,
    buildRuntimeImage,
    verifyRuntimeImage
} = require('./runtime-utils.cjs');

async function main() {
    const flags = parseArgs(process.argv);
    const useJson = flags.has('--json');
    const dryRun = flags.has('--dry-run');

    const dockerState = await inspectDockerState();
    const runtimeWarnings = [];
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
            status: dockerState.available && dockerState.rootless ? 'healthy' : 'degraded',
            summary: dockerState.available && dockerState.rootless
                ? 'Mode rootless confirmé'
                : dockerState.warning || dockerState.detail || 'Mode rootless non confirmé'
        }
    ];

    if (dockerState.available && !dockerState.rootless) {
        runtimeWarnings.push(dockerState.warning || dockerState.detail || 'Mode rootless non confirmé');
    }

    if (!dockerState.available) {
        const status = summarizeStatus(components);
        const payload = { status, docker: dockerState, images: [], dryRun };
        printOutput(useJson ? payload : buildTextReport('Runtime rebuild', status, components), useJson);
        process.exit(1);
    }

    const imageResults = [];
    for (const spec of runtimeImages) {
        const buildResult = await buildRuntimeImage(spec, {
            pull: true,
            noCache: true,
            dryRun
        });

        if (dryRun) {
            imageResults.push({
                label: spec.label,
                status: 'degraded',
                summary: `Rebuild planifié pour ${spec.image}`,
                command: buildResult.command,
                verified: false
            });
            continue;
        }

        if (!buildResult.built) {
            imageResults.push({
                label: spec.label,
                status: 'unhealthy',
                summary: `Échec du rebuild pour ${spec.image}`,
                detail: buildResult.detail,
                verified: false
            });
            continue;
        }

        const verification = await verifyRuntimeImage(spec);
        imageResults.push({
            label: spec.label,
            status: verification.verified ? 'healthy' : 'unhealthy',
            summary: verification.verified
                ? `${spec.image} rebuildé et vérifié`
                : `${spec.image} rebuildé mais non vérifié`,
            detail: verification.verified ? verification.output : verification.detail,
            verified: verification.verified
        });
    }

    const allComponents = [...components, ...imageResults.map((result) => ({
        label: result.label,
        status: result.status,
        summary: result.summary
    }))];
    const rebuildStatus = summarizeStatus(allComponents);
    const runtimeReady = dockerState.available
        && dockerState.executionReady
        && imageResults.every((result) => result.verified || dryRun);
    const payload = {
        status: rebuildStatus,
        runtimeReady,
        docker: dockerState,
        images: imageResults,
        warnings: runtimeWarnings,
        dryRun
    };
    printOutput(useJson ? payload : buildTextReport('Runtime rebuild', rebuildStatus, allComponents), useJson);

    const hasFatalError = !dockerState.available || imageResults.some((result) => result.status === 'unhealthy');
    process.exit(hasFatalError ? 1 : 0);
}

void main();