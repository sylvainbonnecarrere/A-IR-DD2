#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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

function writeReport(reportFile, payload) {
    if (!reportFile) {
        return;
    }

    const destination = path.resolve(reportFile);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main(argv = process.argv) {
    const flags = parseArgs(argv);
    const useJson = flags.has('--json');
    const dryRun = flags.has('--dry-run');
    const allowMissingScanner = flags.has('--allow-missing-scanner');
    const reportFlag = [...flags].find((flag) => flag.startsWith('--report-file='));
    const reportFile = reportFlag && reportFlag.slice('--report-file='.length);
    if (reportFlag && !reportFile) {
        throw new Error('--report-file nécessite un chemin de fichier.');
    }
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
        const payload = { status, dryRun, severities, docker: dockerState, scanner, images: [] };
        writeReport(reportFile, payload);
        printOutput(useJson ? payload : buildTextReport('Runtime scan', status, components), useJson);
        return 1;
    }

    const imageResults = [];
    for (const spec of runtimeArtifacts) {
        const exists = await imageExists(spec.image);
        if (!exists) {
            imageResults.push({
                label: spec.label,
                image: spec.image,
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
            image: spec.image,
            status: effectiveStatus,
            summary: effectiveStatus === 'unhealthy' && scan.status === 'degraded'
                ? `${scan.summary} Activez docker login ou installez Trivy.`
                : scan.summary,
            detail: scan.detail,
            scanned: scan.scanned,
            command: scan.command,
            scanner: scan.scanner,
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
    writeReport(reportFile, payload);
    printOutput(useJson ? payload : buildTextReport('Runtime scan', status, allComponents), useJson);

    const hasFatalError = !dockerState.available
        || (!scanner && !allowMissingScanner)
        || imageResults.some((result) => result.status === 'unhealthy');
    return hasFatalError ? 1 : 0;
}

if (require.main === module) {
    main().then((exitCode) => {
        process.exitCode = exitCode;
    }).catch((error) => {
        console.error(`Runtime scan: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { main };