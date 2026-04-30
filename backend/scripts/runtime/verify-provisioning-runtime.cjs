#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const {
    backendRoot,
    printOutput,
    buildTextReport,
    runCommand,
    inspectDockerState,
    buildRuntimeImage,
    verifyRuntimeImage
} = require('./runtime-utils.cjs');

dotenv.config({ path: path.resolve(backendRoot, '.env') });

async function main() {
    const dockerState = await inspectDockerState();
    const provisioningSpec = {
        label: 'Python provisioning image',
        image: process.env.RUNTIME_PYTHON_PROVISIONING_IMAGE || 'airdd2-python-provisioning:3.12-ubuntu-noble',
        dockerfile: path.resolve(backendRoot, 'docker/runtime/python-provisioning/Dockerfile'),
        context: path.resolve(backendRoot, 'docker/runtime/python-provisioning'),
        probeCommand: ['pip3', '--version']
    };

    if (!dockerState.available) {
        printOutput(buildTextReport('Provisioning runtime check', 'unhealthy', [{
            label: 'Docker CLI',
            status: 'unhealthy',
            summary: dockerState.detail || 'Docker indisponible'
        }]));
        process.exit(1);
    }

    const buildResult = await buildRuntimeImage(provisioningSpec, {
        pull: true,
        noCache: true,
        dryRun: false
    });

    if (!buildResult.built) {
        printOutput(buildTextReport('Provisioning runtime check', 'unhealthy', [{
            label: provisioningSpec.label,
            status: 'unhealthy',
            summary: buildResult.detail || `Échec du build de ${provisioningSpec.image}`
        }]));
        process.exit(1);
    }

    const verification = await verifyRuntimeImage(provisioningSpec);
    const status = verification.verified ? 'healthy' : 'unhealthy';

    printOutput(buildTextReport('Provisioning runtime check', status, [{
        label: provisioningSpec.label,
        status,
        summary: verification.verified
            ? `${provisioningSpec.image} rebuildée et vérifiée (${verification.output})`
            : verification.detail || `${provisioningSpec.image} non vérifiée`
    }]));

    process.exit(verification.verified ? 0 : 1);
}

void main();