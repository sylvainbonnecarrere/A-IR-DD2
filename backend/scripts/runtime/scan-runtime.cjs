#!/usr/bin/env node

const {
    runtimeArtifacts,
    parseArgs,
    printOutput,
    summarizeStatus,
    buildTextReport,
    inspectDockerState,
    imageExists,
    resolveScanner,
    scanRuntimeImage
} = require('./runtime-utils.cjs');

function parseSeverity(flags) {
    for (const flag of flags) {
        if (flag.startsWith('--fail-on-severity=')) {
            const value = flag.split('=')[1] || 'high';
            if (value === 'critical') {
                return ['critical'];
            }

            return ['critical', 'high'];
        }
    }

    return ['critical', 'high'];
}

async function main() {
    const flags = parseArgs(process.argv);
    const useJson = flags.has('--json');
    const dryRun = flags.has('--dry-run');
    const allowMissingScanner = flags.has('--allow-missing-scanner');
    const severities = parseSeverity(flags);

    const dockerState = await inspectDockerState();
    const scanner = dockerState.available ? await resolveScanner() : null;
    const components = [
        {
            label: 'Docker CLI',
            status: dockerState.available ? 'healthy' : 'unhealthy',
            summary: dockerState.available
                ? `Docker disponible (${dockerState.version || 'version inconnue'})`
                : dockerState.detail
        },
        {
            label: 'Scanner local',
            status: scanner ? 'healthy' : allowMissingScanner ? 'degraded' : 'unhealthy',
            summary: scanner
                ? `${scanner.label} détecté`
                : 'Docker Scout ou Trivy requis pour le scan local'
        }
    ];

    if (!dockerState.available) {
        const status = summarizeStatus(components);
        printOutput(useJson ? { status, docker: dockerState, scanner, images: [] } : buildTextReport('Runtime scan', status, components), useJson);
        process.exit(1);
    }

    const imageResults = [];
    for (const spec of runtimeArtifacts) {
        const exists = await imageExists(spec.image);
        if (!exists) {
            imageResults.push({
                label: spec.label,
                status: 'unhealthy',
                summary: `${spec.image} absente`,
                purpose: spec.purpose
            });
            continue;
        }

        const scan = await scanRuntimeImage(spec, { scanner, severities, dryRun });
        const effectiveStatus = scan.status === 'degraded' && !allowMissingScanner
            ? 'unhealthy'
            : scan.status;
        imageResults.push({
            label: spec.label,
            status: effectiveStatus,
            summary: effectiveStatus === 'unhealthy' && scan.status === 'degraded'
                ? `${scan.summary} Activez docker login ou installez Trivy.`
                : scan.summary,
            detail: scan.detail,
            purpose: spec.purpose
        });
    }

    const allComponents = [...components, ...imageResults.map((result) => ({
        label: result.label,
        status: result.status,
        summary: result.summary
    }))];
    const status = summarizeStatus(allComponents);
    const payload = {
        status,
        dryRun,
        severities,
        docker: dockerState,
        scanner,
        images: imageResults
    };
    printOutput(useJson ? payload : buildTextReport('Runtime scan', status, allComponents), useJson);

    const hasFatalError = !dockerState.available
        || (!scanner && !allowMissingScanner)
        || imageResults.some((result) => result.status === 'unhealthy');
    process.exit(hasFatalError ? 1 : 0);
}

void main();