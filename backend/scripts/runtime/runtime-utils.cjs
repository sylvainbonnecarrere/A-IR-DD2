const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const backendRoot = path.resolve(__dirname, '../..');

const runtimeArtifacts = [
    {
        key: 'node',
        category: 'runtime',
        label: 'Node.js runtime',
        image: process.env.RUNTIME_NODE_IMAGE || 'airdd2-runtime-node:bookworm-slim',
        dockerfile: path.resolve(backendRoot, 'docker/runtime/node/Dockerfile'),
        context: path.resolve(backendRoot, 'docker/runtime/node'),
        probeCommand: ['node', '--version'],
        purpose: 'Run-only sandbox image. Package installation is intentionally excluded from normal execution.'
    },
    {
        key: 'python',
        category: 'runtime',
        label: 'Python runtime',
        image: process.env.RUNTIME_PYTHON_IMAGE || 'airdd2-runtime-python:3.12-slim',
        dockerfile: path.resolve(backendRoot, 'docker/runtime/python/Dockerfile'),
        context: path.resolve(backendRoot, 'docker/runtime/python'),
        probeCommand: ['python', '--version'],
        purpose: 'Run-only sandbox image. Python dependencies must be provisioned before execution.'
    },
    {
        key: 'python-provisioning',
        category: 'provisioning',
        label: 'Python provisioning image',
        image: process.env.RUNTIME_PYTHON_PROVISIONING_IMAGE || 'airdd2-python-provisioning:3.12-slim',
        dockerfile: path.resolve(backendRoot, 'docker/runtime/python-provisioning/Dockerfile'),
        context: path.resolve(backendRoot, 'docker/runtime/python-provisioning'),
        probeCommand: ['sh', '-lc', 'python3 --version && pip3 --version'],
        purpose: 'Controlled preparation image. Keeps pip for author-build/platform-provision workflows outside the runtime sandbox.'
    }
];

const runtimeImages = runtimeArtifacts.filter((artifact) => artifact.category === 'runtime');

function parseArgs(argv) {
    return new Set(argv.slice(2));
}

function printOutput(payload, useJson = false) {
    if (useJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    if (Array.isArray(payload.lines)) {
        payload.lines.forEach((line) => console.log(line));
    } else {
        console.log(payload.summary || 'No output');
    }
}

function summarizeStatus(components) {
    if (components.some((component) => component.status === 'unhealthy')) {
        return 'unhealthy';
    }

    if (components.some((component) => component.status === 'degraded')) {
        return 'degraded';
    }

    return 'healthy';
}

function buildTextReport(title, status, components) {
    return {
        summary: `${title}: ${status}`,
        lines: [
            `${title}: ${status}`,
            ...components.map((component) => `- [${component.status}] ${component.label}: ${component.summary}`)
        ]
    };
}

function runCommand(command, args, options = {}) {
    const {
        cwd = backendRoot,
        timeoutMs = 120000,
        inheritStdout = false,
        inheritStderr = false
    } = options;

    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            windowsHide: true,
            stdio: [
                'ignore',
                inheritStdout ? 'inherit' : 'pipe',
                inheritStderr ? 'inherit' : 'pipe'
            ]
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);

        if (!inheritStdout) {
            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });
        }

        if (!inheritStderr) {
            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });
        }

        child.on('error', (error) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            resolve({
                exitCode: 1,
                stdout,
                stderr,
                timedOut,
                errorMessage: error.message
            });
        });

        child.on('close', (exitCode) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            resolve({
                exitCode: exitCode ?? 1,
                stdout,
                stderr,
                timedOut
            });
        });
    });
}

function describeFailure(result) {
    if (result.timedOut) {
        return 'Commande expirée';
    }

    return result.errorMessage || result.stderr.trim() || result.stdout.trim() || 'Commande indisponible';
}

async function inspectDockerState() {
    const version = await runCommand('docker', ['version', '--format', '{{json .Server.Version}}'], { timeoutMs: 10000 });
    const available = version.exitCode === 0 && !version.timedOut;
    const dockerVersion = available
        ? (version.stdout || version.stderr).trim().replace(/^"|"$/g, '')
        : undefined;

    let rootless = false;
    let rootlessDetail = undefined;
    let mode = 'unknown';
    let securityLevel = 'unavailable';
    let executionReady = false;
    let warning = undefined;

    if (available) {
        const context = await runCommand('docker', ['context', 'show'], { timeoutMs: 10000 });
        const contextName = context.exitCode === 0 && !context.timedOut ? context.stdout.trim() : '';
        const endpoint = contextName
            ? await runCommand('docker', ['context', 'inspect', contextName, '--format', '{{.Endpoints.docker.Host}}'], { timeoutMs: 10000 })
            : { exitCode: 1, stdout: '', timedOut: false };
        const endpointHost = endpoint.exitCode === 0 && !endpoint.timedOut ? endpoint.stdout.trim() : '';

        if (isDockerDesktopContext(contextName, endpointHost)) {
            mode = 'docker-desktop';
            securityLevel = 'dev-only';
            executionReady = true;
            warning = 'Docker Desktop détecté : mode dev-only explicite. Acceptable en développement/test, sans sécurité de production.';
            rootlessDetail = 'Docker Desktop utilise un daemon Linux géré dans une VM interne et non un daemon rootless utilisateur.';
        }

        const securityOptions = await runCommand('docker', ['info', '--format', '{{json .SecurityOptions}}'], { timeoutMs: 10000 });
        if (securityOptions.exitCode === 0 && !securityOptions.timedOut) {
            try {
                const options = JSON.parse(securityOptions.stdout);
                rootless = Array.isArray(options)
                    && options.some((option) => String(option).toLowerCase().includes('rootless'));
                if (rootless) {
                    mode = 'rootless';
                    securityLevel = 'production-ready';
                    executionReady = true;
                    warning = undefined;
                    rootlessDetail = undefined;
                }
            } catch {
                rootless = false;
            }
        }

        if (!rootless) {
            const info = await runCommand('docker', ['info', '--format', '{{json .Rootless}}'], { timeoutMs: 10000 });
            if (info.exitCode === 0 && !info.timedOut) {
                rootless = info.stdout.trim() === 'true';
                if (rootless) {
                    mode = 'rootless';
                    securityLevel = 'production-ready';
                    executionReady = true;
                    warning = undefined;
                    rootlessDetail = undefined;
                }
            }
        }

        if (!rootless) {
            const socketPath = resolveDockerRootlessSocketPath();
            rootless = socketExists(socketPath);
            if (rootless) {
                mode = 'rootless';
                securityLevel = 'production-ready';
                executionReady = true;
                warning = undefined;
                rootlessDetail = `Mode rootless déduit du socket utilisateur ${socketPath}.`;
            }
        }

        if (!rootless) {
            if ((contextName || '').toLowerCase().includes('rootless')) {
                rootless = true;
                mode = 'rootless';
                securityLevel = 'production-ready';
                executionReady = true;
                warning = undefined;
                rootlessDetail = undefined;
            }
        }

        if (!executionReady) {
            mode = 'rootful-linux';
            securityLevel = 'dev-only';
            executionReady = true;
            warning = 'Daemon Docker rootful détecté. Mode dev-only acceptable pour tests locaux, sans sécurité de production.';
            rootlessDetail = 'Docker détecté sans indicateur rootless. Le runtime reste exécutable mais sans durcissement rootless.';
        }
    }

    return {
        available,
        version: dockerVersion,
        rootless,
        mode,
        securityLevel,
        executionReady,
        warning,
        detail: available ? rootlessDetail : describeFailure(version)
    };
}

function isDockerDesktopContext(contextName, endpointHost) {
    const normalizedContext = String(contextName || '').toLowerCase();
    const normalizedEndpoint = String(endpointHost || '').toLowerCase();

    return normalizedContext.includes('desktop-linux')
        || normalizedEndpoint.includes('npipe://')
        || normalizedEndpoint.includes('dockerdesktoplinuxengine');
}

function resolveDockerRootlessSocketPath() {
    if (process.env.XDG_RUNTIME_DIR) {
        return path.join(process.env.XDG_RUNTIME_DIR, 'docker.sock');
    }

    return '/run/user/1000/docker.sock';
}

function socketExists(socketPath) {
    try {
        return fs.statSync(socketPath).isSocket();
    } catch {
        return false;
    }
}

async function imageExists(image) {
    const result = await runCommand('docker', ['image', 'inspect', image, '--format', '{{json .Id}}'], { timeoutMs: 15000 });
    return result.exitCode === 0 && !result.timedOut;
}

async function buildRuntimeImage(spec, options = {}) {
    const args = ['build', '-f', spec.dockerfile, '-t', spec.image];
    if (options.pull) {
        args.push('--pull');
    }
    if (options.noCache) {
        args.push('--no-cache');
    }
    args.push(spec.context);

    if (options.dryRun) {
        return {
            image: spec.image,
            built: false,
            skipped: false,
            dryRun: true,
            command: ['docker', ...args].join(' ')
        };
    }

    const result = await runCommand('docker', args, {
        cwd: backendRoot,
        timeoutMs: 20 * 60 * 1000,
        inheritStdout: true,
        inheritStderr: true
    });

    return {
        image: spec.image,
        built: result.exitCode === 0 && !result.timedOut,
        skipped: false,
        dryRun: false,
        command: ['docker', ...args].join(' '),
        detail: result.exitCode === 0 && !result.timedOut ? undefined : describeFailure(result)
    };
}

async function verifyRuntimeImage(spec) {
    const args = [
        'run',
        '--rm',
        '--network', 'none',
        '--read-only',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
        spec.image,
        ...spec.probeCommand
    ];

    const result = await runCommand('docker', args, { timeoutMs: 30000 });
    return {
        image: spec.image,
        verified: result.exitCode === 0 && !result.timedOut,
        command: ['docker', ...args].join(' '),
        output: (result.stdout || result.stderr).trim(),
        detail: result.exitCode === 0 && !result.timedOut ? undefined : describeFailure(result)
    };
}

async function resolveScanner() {
    const dockerScout = await runCommand('docker', ['scout', 'version'], { timeoutMs: 15000 });
    if (dockerScout.exitCode === 0 && !dockerScout.timedOut) {
        return {
            key: 'docker-scout',
            label: 'Docker Scout'
        };
    }

    const trivy = await runCommand('trivy', ['--version'], { timeoutMs: 15000 });
    if (trivy.exitCode === 0 && !trivy.timedOut) {
        return {
            key: 'trivy',
            label: 'Trivy'
        };
    }

    return null;
}

async function scanRuntimeImage(spec, options = {}) {
    const severityList = options.severities || ['critical', 'high'];
    const scanner = options.scanner || await resolveScanner();

    if (!scanner) {
        return {
            image: spec.image,
            scanned: false,
            status: 'degraded',
            summary: 'Aucun scanner local disponible (Docker Scout ou Trivy requis).',
            detail: 'Installez Docker Scout ou Trivy pour verrouiller le scan local des images runtime.',
            scanner: null
        };
    }

    if (options.dryRun) {
        const command = scanner.key === 'docker-scout'
            ? ['docker', 'scout', 'cves', '--only-severity', severityList.join(','), '--exit-code', `local://${spec.image}`].join(' ')
            : ['trivy', 'image', '--severity', severityList.map((severity) => severity.toUpperCase()).join(','), '--exit-code', '2', spec.image].join(' ');
        return {
            image: spec.image,
            scanned: false,
            status: 'degraded',
            summary: `Scan planifié via ${scanner.label}`,
            detail: command,
            scanner
        };
    }

    const result = scanner.key === 'docker-scout'
        ? await runCommand('docker', ['scout', 'cves', '--only-severity', severityList.join(','), '--exit-code', `local://${spec.image}`], { timeoutMs: 10 * 60 * 1000 })
        : await runCommand('trivy', ['image', '--severity', severityList.map((severity) => severity.toUpperCase()).join(','), '--exit-code', '2', spec.image], { timeoutMs: 10 * 60 * 1000 });

    const scanOutput = (result.stdout || result.stderr).trim();
    const dockerScoutNeedsLogin = scanner.key === 'docker-scout'
        && /log in with your docker id|docker login/i.test(scanOutput);

    if (dockerScoutNeedsLogin) {
        const trivy = await runCommand('trivy', ['--version'], { timeoutMs: 15000 });
        if (trivy.exitCode === 0 && !trivy.timedOut) {
            return scanRuntimeImage(spec, {
                ...options,
                scanner: {
                    key: 'trivy',
                    label: 'Trivy'
                }
            });
        }

        return {
            image: spec.image,
            scanned: false,
            status: 'degraded',
            summary: 'Docker Scout détecté mais non authentifié; aucun scanner de fallback disponible.',
            detail: 'Exécutez docker login pour activer Docker Scout, ou installez Trivy pour le scan local sans compte Docker.',
            scanner
        };
    }

    if (result.exitCode === 0 && !result.timedOut) {
        return {
            image: spec.image,
            scanned: true,
            status: 'healthy',
            summary: `Aucune CVE ${severityList.join('/')} détectée via ${scanner.label}.`,
            detail: scanOutput,
            scanner
        };
    }

    if (result.exitCode === 2 && !result.timedOut) {
        return {
            image: spec.image,
            scanned: true,
            status: 'unhealthy',
            summary: `CVE ${severityList.join('/')} détectées via ${scanner.label}.`,
            detail: scanOutput,
            scanner
        };
    }

    return {
        image: spec.image,
        scanned: false,
        status: 'unhealthy',
        summary: `Échec du scan ${scanner.label}.`,
        detail: describeFailure(result),
        scanner
    };
}

module.exports = {
    backendRoot,
    runtimeArtifacts,
    runtimeImages,
    parseArgs,
    printOutput,
    summarizeStatus,
    buildTextReport,
    runCommand,
    inspectDockerState,
    imageExists,
    buildRuntimeImage,
    verifyRuntimeImage,
    resolveScanner,
    scanRuntimeImage
};