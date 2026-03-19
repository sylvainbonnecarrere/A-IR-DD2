#!/usr/bin/env node

const {
    runtimeImages,
    parseArgs,
    printOutput,
    summarizeStatus,
    buildTextReport,
    inspectDockerState,
    imageExists,
    buildRuntimeImage,
    verifyRuntimeImage
} = require('./runtime-utils.cjs');

async function main() {
    const flags = parseArgs(process.argv);
    const useJson = flags.has('--json');
    const dryRun = flags.has('--dry-run');
    const force = flags.has('--force');
    const noCache = flags.has('--no-cache');

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
        const payload = {
            status,
            docker: dockerState,
            images: [],
            dryRun
        };
        printOutput(useJson ? payload : buildTextReport('Runtime setup', status, components), useJson);
        process.exit(1);
    }

    const imageResults = [];
    for (const spec of runtimeImages) {
        const exists = await imageExists(spec.image);
        if (exists && !force) {
            imageResults.push({
                label: spec.label,
                status: 'healthy',
                summary: `${spec.image} déjà présent`,
                built: false,
                skipped: true,
                verified: false
            });
            continue;
        }

        const buildResult = await buildRuntimeImage(spec, {
            pull: true,
            noCache,
            dryRun
        });

        if (dryRun) {
            imageResults.push({
                label: spec.label,
                status: 'healthy',
                summary: `Build planifié pour ${spec.image}`,
                command: buildResult.command,
                built: false,
                skipped: false,
                verified: false
            });
            continue;
        }

        if (!buildResult.built) {
            imageResults.push({
                label: spec.label,
                status: 'unhealthy',
                summary: `Échec du build pour ${spec.image}`,
                detail: buildResult.detail,
                built: false,
                skipped: false,
                verified: false
            });
            continue;
        }

        const verification = await verifyRuntimeImage(spec);
        imageResults.push({
            label: spec.label,
            status: verification.verified ? 'healthy' : 'unhealthy',
            summary: verification.verified
                ? `${spec.image} construit et vérifié`
                : `${spec.image} construit mais non vérifié`,
            detail: verification.verified ? verification.output : verification.detail,
            built: true,
            skipped: false,
            verified: verification.verified
        });
    }

    const allComponents = [...components, ...imageResults.map((result) => ({
        label: result.label,
        status: result.status,
        summary: result.summary
    }))];
    const installStatus = summarizeStatus(allComponents);
    const runtimeReady = dockerState.available
        && dockerState.executionReady
        && imageResults.every((result) => result.verified || result.skipped || dryRun);

    const payload = {
        status: installStatus,
        runtimeReady,
        docker: dockerState,
        images: imageResults,
        warnings: runtimeWarnings,
        dryRun
    };
    printOutput(useJson ? payload : buildTextReport('Runtime setup', installStatus, allComponents), useJson);

    const hasFatalError = !dockerState.available || imageResults.some((result) => result.status === 'unhealthy');
    process.exit(hasFatalError ? 1 : 0);
}

void main();