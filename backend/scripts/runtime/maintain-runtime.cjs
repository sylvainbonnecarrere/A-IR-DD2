#!/usr/bin/env node

const {
    runtimeArtifacts,
    parseArgs,
    printOutput,
    summarizeStatus,
    buildTextReport,
    inspectDockerState,
    resolveScanner,
    buildRuntimeImage,
    verifyRuntimeImage,
    scanRuntimeImage
} = require('./runtime-utils.cjs');
const { syncRuntimeBaseDigests } = require('./sync-runtime-base-digests.cjs');

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
    const noCache = flags.has('--no-cache');
    const allowMissingScanner = flags.has('--allow-missing-scanner');
    const skipDigestRefresh = flags.has('--skip-digest-refresh');
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
                : 'Docker Scout ou Trivy requis pour la maintenance locale'
        }
    ];

    if (!dockerState.available) {
        const status = summarizeStatus(components);
        printOutput(useJson ? { status, docker: dockerState, scanner, images: [] } : buildTextReport('Runtime maintenance', status, components), useJson);
        process.exit(1);
    }

    const digestSync = skipDigestRefresh
        ? {
            status: 'degraded',
            summary: 'Synchronisation des digests ignorée (--skip-digest-refresh).',
            components: [
                {
                    label: 'Digests Docker de base',
                    status: 'degraded',
                    summary: 'Synchronisation ignorée sur demande.'
                }
            ]
        }
        : await syncRuntimeBaseDigests({ dryRun, checkOnly: false });

    components.push({
        label: 'Digests Docker de base',
        status: digestSync.status,
        summary: digestSync.summary
    });

    if (digestSync.status === 'unhealthy') {
        const status = summarizeStatus(components);
        printOutput(useJson ? { status, docker: dockerState, scanner, digestSync, images: [] } : buildTextReport('Runtime maintenance', status, components), useJson);
        process.exit(1);
    }

    const imageResults = [];
    for (const spec of runtimeArtifacts) {
        const buildResult = await buildRuntimeImage(spec, {
            pull: true,
            noCache,
            dryRun
        });

        if (dryRun) {
            imageResults.push({
                label: spec.label,
                status: 'degraded',
                summary: `Maintenance planifiée pour ${spec.image}`,
                detail: buildResult.command,
                purpose: spec.purpose
            });
            continue;
        }

        if (!buildResult.built) {
            imageResults.push({
                label: spec.label,
                status: 'unhealthy',
                summary: `Échec du rebuild pour ${spec.image}`,
                detail: buildResult.detail,
                purpose: spec.purpose
            });
            continue;
        }

        const verification = await verifyRuntimeImage(spec);
        const scan = await scanRuntimeImage(spec, { scanner, severities, dryRun: false });
        const effectiveScanStatus = scan.status === 'degraded' && !allowMissingScanner
            ? 'unhealthy'
            : scan.status;
        const status = verification.verified && (effectiveScanStatus === 'healthy' || (effectiveScanStatus === 'degraded' && allowMissingScanner))
            ? 'healthy'
            : effectiveScanStatus === 'unhealthy' || !verification.verified
                ? 'unhealthy'
                : 'degraded';
        const summaryParts = [];
        if (verification.verified) {
            summaryParts.push('vérifiée');
        } else {
            summaryParts.push('non vérifiée');
        }

        if (effectiveScanStatus === 'healthy') {
            summaryParts.push('scannée sans CVE bloquante');
        } else if (effectiveScanStatus === 'degraded') {
            summaryParts.push('scan dégradé');
        } else {
            summaryParts.push('scan bloquant');
        }

        imageResults.push({
            label: spec.label,
            status,
            summary: `${spec.image} rebuildée, ${summaryParts.join(', ')}`,
            detail: [verification.output, scan.detail].filter(Boolean).join('\n\n'),
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
        images: imageResults,
        contract: {
            runtime: 'Run-only images exclude package managers from normal sandbox execution.',
            provisioning: 'Python dependency installation belongs to the dedicated provisioning image, not the runtime image.'
        }
    };
    printOutput(useJson ? payload : buildTextReport('Runtime maintenance', status, allComponents), useJson);

    const hasFatalError = !dockerState.available
        || (!scanner && !allowMissingScanner)
        || imageResults.some((result) => result.status === 'unhealthy');
    process.exit(hasFatalError ? 1 : 0);
}

void main();