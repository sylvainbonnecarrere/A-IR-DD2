import { spawn } from 'child_process';
import path from 'path';
import { stat } from 'fs/promises';
import config from '../config/environment';
import { nativeFunctionsSeed } from '../seeds/nativeFunctions.seed';
import type {
    RuntimeBinaryHealth,
    RuntimeCapabilities,
    RuntimeDockerHealth,
    RuntimeDockerMode,
    RuntimeHealthComponent,
    RuntimeHealthReport,
    RuntimeHealthStatus,
    RuntimeImageHealth,
    RuntimeNativePythonDependencyProbe,
    RuntimeNativePythonHealth,
    RuntimeRunnerHealth,
    RuntimeSecurityLevel
} from '../types/runtimeHealth.types';

interface NativePythonImportTarget {
    toolName: string;
    dependencies: Array<{
        dependency: string;
        module: string;
    }>;
}

function resolveCriticalPythonImportDependency(
    entry: string | { module: string; dependency?: string },
    availableDependencies: string[],
    fallbackDependency?: string
): { module: string; dependency: string } {
    const normalizeDependencyKey = (value: string) => value.toLowerCase().replace(/[-_.]+/g, '');

    if (typeof entry === 'string') {
        const exactDependency = availableDependencies.find((dependency) => dependency === entry);
        const normalizedDependency = availableDependencies.find(
            (dependency) => normalizeDependencyKey(dependency) === normalizeDependencyKey(entry)
        );

        return {
            module: entry,
            dependency: exactDependency ?? normalizedDependency ?? fallbackDependency ?? entry
        };
    }

    return {
        module: entry.module,
        dependency: entry.dependency ?? fallbackDependency ?? entry.module
    };
}

const nativePythonImportTargets: NativePythonImportTarget[] = nativeFunctionsSeed
    .filter((fn) => fn.origin === 'native' && fn.language === 'python' && (fn.healthCheck?.criticalPythonImports?.length ?? 0) > 0)
    .map((fn) => ({
        toolName: fn.name,
        dependencies: (fn.healthCheck?.criticalPythonImports ?? []).map((entry, index) => (
            resolveCriticalPythonImportDependency(entry, fn.dependencies, fn.dependencies[index])
        ))
    }));

interface CommandExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    errorMessage?: string;
}

export interface CommandRunner {
    run(command: string, args: string[], timeoutMs?: number): Promise<CommandExecutionResult>;
}

interface RuntimeHealthConfig {
    nodeExecutable: string;
    pythonExecutables: string[];
    dockerExecutable: string;
    nodeRuntimeImage: string;
    pythonRuntimeImage: string;
    backendPythonRoot: string;
    probeTimeoutMs: number;
}

interface RuntimeHealthServiceOptions {
    runner?: CommandRunner;
    now?: () => Date;
    runtimeConfig?: Partial<RuntimeHealthConfig>;
    socketExists?: (socketPath: string) => Promise<boolean>;
    kvmAvailable?: () => Promise<boolean>;
}

interface DockerExecutionProfile {
    mode: RuntimeDockerMode;
    securityLevel: RuntimeSecurityLevel;
    executionReady: boolean;
    warning?: string;
    detail?: string;
    contextName?: string;
    endpointHost?: string;
}

class SpawnCommandRunner implements CommandRunner {
    async run(command: string, args: string[], timeoutMs: number = 8_000): Promise<CommandExecutionResult> {
        return new Promise((resolve) => {
            const child = spawn(command, args, {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let settled = false;
            let timedOut = false;

            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, timeoutMs);

            child.stdout.on('data', (chunk: Buffer) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
            });

            child.on('error', (error: Error) => {
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
}

function parseJsonScalar(rawValue: string): unknown {
    const normalized = rawValue.trim();
    if (!normalized) {
        return undefined;
    }

    try {
        return JSON.parse(normalized);
    } catch {
        return normalized.replace(/^"|"$/g, '');
    }
}

function inferStatus(available: boolean, required: boolean): RuntimeHealthStatus {
    if (available) {
        return 'healthy';
    }

    return required ? 'unhealthy' : 'degraded';
}

function buildCommandLabel(command: string, args: string[]): string {
    return [command, ...args].join(' ');
}

export class RuntimeHealthService {
    private readonly runner: CommandRunner;
    private readonly now: () => Date;
    private readonly runtimeConfig: RuntimeHealthConfig;
    private readonly socketExists: (socketPath: string) => Promise<boolean>;
    private readonly kvmAvailable: () => Promise<boolean>;

    constructor(options: RuntimeHealthServiceOptions = {}) {
        this.runner = options.runner ?? new SpawnCommandRunner();
        this.now = options.now ?? (() => new Date());
        this.socketExists = options.socketExists ?? defaultSocketExists;
        this.kvmAvailable = options.kvmAvailable ?? defaultKvmAvailable;
        this.runtimeConfig = {
            nodeExecutable: config.runtime.nodeExecutable,
            pythonExecutables: config.runtime.pythonExecutables,
            dockerExecutable: config.runtime.dockerExecutable,
            nodeRuntimeImage: config.runtime.nodeRuntimeImage,
            pythonRuntimeImage: config.runtime.pythonRuntimeImage,
            backendPythonRoot: path.resolve(__dirname, '../../python'),
            probeTimeoutMs: config.runtime.probeTimeoutMs,
            ...options.runtimeConfig
        };
    }

    async getHealthReport(): Promise<RuntimeHealthReport> {
        const checkedAt = this.now().toISOString();
        const node = await this.probeNode(checkedAt);
        const python = await this.probePython(checkedAt);
        const docker = await this.probeDocker(checkedAt);
        const nodeImage = await this.probeRuntimeImage(this.runtimeConfig.nodeRuntimeImage, 'Node.js runtime image', 'node_runtime_image', checkedAt, docker.available);
        const pythonImage = await this.probeRuntimeImage(this.runtimeConfig.pythonRuntimeImage, 'Python runtime image', 'python_runtime_image', checkedAt, docker.available);
        const nativePython = await this.probeNativePythonImports(
            checkedAt,
            python.available,
            docker.available,
            docker.runtime.executionReady,
            pythonImage.runtime.available
        );
        const firecrackerRunner = await this.probeFirecrackerRunner();
        const dockerSandboxRunner: RuntimeRunnerHealth = {
            runner: 'docker_sandbox',
            available: docker.runtime.executionReady,
            status: docker.runtime.executionReady
                ? docker.runtime.mode === 'rootless' ? 'healthy' : 'degraded'
                : 'unhealthy',
            detail: docker.runtime.warning
        };
        const preferredRunner = firecrackerRunner.available ? 'firecracker' : 'docker_sandbox';

        const components: RuntimeHealthComponent[] = [
            node.component,
            python.component,
            docker.dockerComponent,
            docker.rootlessComponent,
            nodeImage.component,
            pythonImage.component,
            nativePython.component
        ];

        const overallStatus = this.computeOverallStatus(components);
        const capabilities: RuntimeCapabilities = {
            build: {
                typescript: node.available,
                python: python.available
            },
            run: {
                typescript: node.available && docker.available && docker.runtime.executionReady && nodeImage.runtime.available,
                python: python.available && docker.available && docker.runtime.executionReady && pythonImage.runtime.available,
                dockerRootless: docker.available && docker.runtime.rootless
            }
        };

        return {
            status: overallStatus,
            checkedAt,
            summary: this.buildSummary(overallStatus, components),
            components,
            nativePython: nativePython.runtime,
            runtime: {
                node: node.runtime,
                python: python.runtime,
                docker: docker.runtime,
                images: {
                    node: nodeImage.runtime,
                    python: pythonImage.runtime
                },
                runners: {
                    preferred: preferredRunner,
                    dockerSandbox: dockerSandboxRunner,
                    firecracker: firecrackerRunner
                },
                typescript: {
                    available: node.available,
                    status: node.runtime.status,
                    engine: 'node-subprocess'
                }
            },
            capabilities,
            python: {
                available: python.available,
                version: python.runtime.version,
                executable: python.runtime.executable
            },
            typescript: {
                available: node.available,
                engine: 'node-subprocess'
            }
        };
    }

    private async probeNativePythonImports(
        checkedAt: string,
        pythonAvailable: boolean,
        dockerAvailable: boolean,
        executionReady: boolean,
        pythonImageAvailable: boolean
    ): Promise<{ runtime: RuntimeNativePythonHealth; component: RuntimeHealthComponent }> {
        if (nativePythonImportTargets.length === 0) {
            const runtime: RuntimeNativePythonHealth = {
                available: true,
                status: 'healthy',
                summary: 'Aucun import critique declare pour les natives Python produit.',
                probes: []
            };

            return {
                runtime,
                component: {
                    key: 'python_native_imports',
                    label: 'Imports critiques Python natifs',
                    status: 'healthy',
                    required: false,
                    summary: runtime.summary,
                    checkedAt,
                    metadata: {
                        probeCount: 0,
                        available: true
                    }
                }
            };
        }

        if (!pythonAvailable || !dockerAvailable || !executionReady || !pythonImageAvailable) {
            const summary = !pythonAvailable
                ? 'Probe imports natifs Python non execute: runtime Python indisponible.'
                : !dockerAvailable
                    ? 'Probe imports natifs Python non execute: Docker indisponible.'
                    : !executionReady
                        ? 'Probe imports natifs Python non execute: runtime Docker non pret.'
                        : 'Probe imports natifs Python non execute: image Python runtime indisponible.';
            const runtime: RuntimeNativePythonHealth = {
                available: false,
                status: 'degraded',
                summary,
                probes: []
            };

            return {
                runtime,
                component: {
                    key: 'python_native_imports',
                    label: 'Imports critiques Python natifs',
                    status: 'degraded',
                    required: false,
                    summary,
                    checkedAt,
                    metadata: {
                        probeCount: nativePythonImportTargets.length,
                        available: false
                    }
                }
            };
        }

        const probes = await Promise.all(nativePythonImportTargets.map((target) => this.runNativePythonImportProbe(target, checkedAt)));
        const missingTools = probes.filter((probe) => probe.status !== 'healthy').map((probe) => probe.toolName);
        const status: RuntimeHealthStatus = missingTools.length > 0 ? 'degraded' : 'healthy';
        const summary = missingTools.length > 0
            ? `Imports critiques manquants ou cassés pour: ${missingTools.join(', ')}`
            : 'Imports critiques declares pour les natives Python verifies avec succes dans l\'image runtime.';
        const runtime: RuntimeNativePythonHealth = {
            available: missingTools.length === 0,
            status,
            summary,
            probes
        };

        return {
            runtime,
            component: {
                key: 'python_native_imports',
                label: 'Imports critiques Python natifs',
                status,
                required: false,
                summary,
                checkedAt,
                metadata: {
                    probeCount: probes.length,
                    failingTools: missingTools,
                    available: runtime.available
                }
            }
        };
    }

    private computeOverallStatus(components: RuntimeHealthComponent[]): RuntimeHealthStatus {
        if (components.some((component) => component.required && component.status === 'unhealthy')) {
            return 'unhealthy';
        }

        if (components.some((component) => component.status === 'degraded')) {
            return 'degraded';
        }

        return 'healthy';
    }

    private buildSummary(status: RuntimeHealthStatus, components: RuntimeHealthComponent[]): string {
        const unhealthy = components.filter((component) => component.status === 'unhealthy').map((component) => component.label);
        const degraded = components.filter((component) => component.status === 'degraded').map((component) => component.label);

        if (status === 'healthy') {
            return 'Runtime MVP prêt: Docker durci rootless, images runtime disponibles et trajectoire Firecracker préparable.';
        }

        const dockerIsolation = components.find((component) => component.key === 'docker_rootless');
        if (status === 'degraded' && dockerIsolation?.metadata?.executionReady === true) {
            return 'Runtime MVP disponible en mode dev-only: exécution possible via Docker durci, sans sécurité de production.';
        }

        const issues = [...unhealthy, ...degraded];
        return `Runtime MVP incomplet: ${issues.join(', ')}`;
    }

    private async probeNode(checkedAt: string): Promise<{ available: boolean; runtime: RuntimeBinaryHealth; component: RuntimeHealthComponent }> {
        const args = ['--version'];
        const result = await this.runner.run(this.runtimeConfig.nodeExecutable, args, this.runtimeConfig.probeTimeoutMs);
        const available = result.exitCode === 0 && !result.timedOut;
        const version = available ? result.stdout.trim() || result.stderr.trim() : undefined;
        const runtime: RuntimeBinaryHealth = {
            available,
            status: inferStatus(available, true),
            executable: this.runtimeConfig.nodeExecutable,
            version
        };

        return {
            available,
            runtime,
            component: {
                key: 'node_runtime',
                label: 'Node.js runtime',
                status: runtime.status,
                required: true,
                summary: available ? `Node.js disponible (${version})` : 'Node.js indisponible',
                checkedAt,
                command: buildCommandLabel(this.runtimeConfig.nodeExecutable, args),
                version,
                detail: available ? undefined : this.describeFailure(result)
            }
        };
    }

    private async probePython(checkedAt: string): Promise<{ available: boolean; runtime: RuntimeBinaryHealth; component: RuntimeHealthComponent }> {
        for (const executable of this.runtimeConfig.pythonExecutables) {
            const args = ['--version'];
            const result = await this.runner.run(executable, args, this.runtimeConfig.probeTimeoutMs);
            const available = result.exitCode === 0 && !result.timedOut;
            if (available) {
                const version = result.stdout.trim() || result.stderr.trim();
                const runtime: RuntimeBinaryHealth = {
                    available: true,
                    status: 'healthy',
                    executable,
                    version
                };

                return {
                    available: true,
                    runtime,
                    component: {
                        key: 'python_runtime',
                        label: 'Python runtime',
                        status: 'healthy',
                        required: true,
                        summary: `Python disponible (${version})`,
                        checkedAt,
                        command: buildCommandLabel(executable, args),
                        version
                    }
                };
            }
        }

        const runtime: RuntimeBinaryHealth = {
            available: false,
            status: 'unhealthy',
            executable: this.runtimeConfig.pythonExecutables[0] ?? 'python3'
        };

        return {
            available: false,
            runtime,
            component: {
                key: 'python_runtime',
                label: 'Python runtime',
                status: 'unhealthy',
                required: true,
                summary: 'Python indisponible',
                checkedAt,
                command: this.runtimeConfig.pythonExecutables.map((executable) => buildCommandLabel(executable, ['--version'])).join(' | '),
                detail: `Aucun exécutable valide détecté parmi: ${this.runtimeConfig.pythonExecutables.join(', ')}`
            }
        };
    }

    private async probeDocker(checkedAt: string): Promise<{
        available: boolean;
        runtime: RuntimeDockerHealth;
        dockerComponent: RuntimeHealthComponent;
        rootlessComponent: RuntimeHealthComponent;
    }> {
        const versionArgs = ['version', '--format', '{{json .Server.Version}}'];
        const versionResult = await this.runner.run(this.runtimeConfig.dockerExecutable, versionArgs, this.runtimeConfig.probeTimeoutMs);
        const available = versionResult.exitCode === 0 && !versionResult.timedOut;
        const version = available ? String(parseJsonScalar(versionResult.stdout) ?? '').trim() : undefined;

        const dockerProfile = available
            ? await this.detectDockerExecutionProfile()
            : {
                mode: 'unknown' as const,
                securityLevel: 'unavailable' as const,
                executionReady: false,
                detail: this.describeFailure(versionResult)
            };

        const dockerStatus = inferStatus(available, true);
        const rootlessStatus: RuntimeHealthStatus = !available
            ? 'unhealthy'
            : dockerProfile.mode === 'rootless'
                ? 'healthy'
                : dockerProfile.executionReady
                    ? 'degraded'
                    : 'unhealthy';
        const runtime: RuntimeDockerHealth = {
            available,
            status: available
                ? dockerProfile.executionReady
                    ? dockerProfile.mode === 'rootless' ? 'healthy' : 'degraded'
                    : 'unhealthy'
                : dockerStatus,
            executable: this.runtimeConfig.dockerExecutable,
            version,
            rootless: dockerProfile.mode === 'rootless',
            mode: dockerProfile.mode,
            securityLevel: dockerProfile.securityLevel,
            executionReady: dockerProfile.executionReady,
            warning: dockerProfile.warning
        };

        return {
            available,
            runtime,
            dockerComponent: {
                key: 'docker_cli',
                label: 'Docker CLI',
                status: dockerStatus,
                required: true,
                summary: available ? `Docker disponible (${version ?? 'version inconnue'})` : 'Docker indisponible',
                checkedAt,
                command: buildCommandLabel(this.runtimeConfig.dockerExecutable, versionArgs),
                version,
                detail: available ? undefined : this.describeFailure(versionResult)
            },
            rootlessComponent: {
                key: 'docker_rootless',
                label: 'Isolation Docker',
                status: rootlessStatus,
                required: false,
                summary: this.buildDockerModeSummary(available, dockerProfile),
                checkedAt,
                command: buildCommandLabel(this.runtimeConfig.dockerExecutable, ['context', 'show']),
                detail: dockerProfile.detail,
                metadata: {
                    rootless: runtime.rootless,
                    mode: runtime.mode,
                    securityLevel: runtime.securityLevel,
                    executionReady: runtime.executionReady,
                    contextName: dockerProfile.contextName,
                    endpointHost: dockerProfile.endpointHost
                }
            }
        };
    }

    private buildDockerModeSummary(available: boolean, profile: DockerExecutionProfile): string {
        if (!available) {
            return 'Mode Docker non détecté';
        }

        switch (profile.mode) {
            case 'rootless':
                return 'Mode rootless confirmé';
            case 'docker-desktop':
                return 'Docker Desktop détecté (mode dev-only via VM, pas de rootless natif)';
            case 'rootful-linux':
                return 'Daemon Docker rootful Linux détecté (mode dev-only)';
            default:
                return 'Mode Docker non confirmé';
        }
    }

    private async probeFirecrackerRunner(): Promise<RuntimeRunnerHealth> {
        const available = await this.kvmAvailable();

        return {
            runner: 'firecracker',
            available,
            status: available ? 'healthy' : 'degraded',
            detail: available
                ? 'KVM disponible: le branchement Firecracker peut être préparé sur cet hôte Linux.'
                : 'Firecracker indisponible sur cet hôte (Linux/KVM requis). Le runtime reste en trajectoire Docker durci pour dev/test.'
        };
    }

    private async probeRuntimeImage(
        image: string,
        label: string,
        key: RuntimeHealthComponent['key'],
        checkedAt: string,
        dockerAvailable: boolean
    ): Promise<{ runtime: RuntimeImageHealth; component: RuntimeHealthComponent }> {
        if (!dockerAvailable) {
            const runtime: RuntimeImageHealth = {
                available: false,
                status: 'unhealthy',
                image,
                detail: 'Image non vérifiée car Docker est indisponible.'
            };

            return {
                runtime,
                component: {
                    key,
                    label,
                    status: 'unhealthy',
                    required: true,
                    summary: `${label} indisponible`,
                    checkedAt,
                    detail: runtime.detail,
                    metadata: { image }
                }
            };
        }

        const args = ['image', 'inspect', image, '--format', '{{json .Id}}'];
        const result = await this.runner.run(this.runtimeConfig.dockerExecutable, args, this.runtimeConfig.probeTimeoutMs);
        const available = result.exitCode === 0 && !result.timedOut;
        const runtime: RuntimeImageHealth = {
            available,
            status: inferStatus(available, true),
            image,
            detail: available ? undefined : this.describeFailure(result)
        };

        return {
            runtime,
            component: {
                key,
                label,
                status: runtime.status,
                required: true,
                summary: available ? `${label} disponible` : `${label} absente`,
                checkedAt,
                command: buildCommandLabel(this.runtimeConfig.dockerExecutable, args),
                detail: runtime.detail,
                metadata: { image }
            }
        };
    }

    private async runNativePythonImportProbe(target: NativePythonImportTarget, checkedAt: string): Promise<RuntimeNativePythonDependencyProbe> {
        const script = buildNativePythonImportProbeScript(target.toolName, target.dependencies.map((dependency) => dependency.module));
        const args = [
            'run',
            '--rm',
            '--network',
            'none',
            '--mount',
            `type=bind,src=${this.runtimeConfig.backendPythonRoot},dst=/opt/airdd2/backend-python,readonly`,
            '--env',
            'AIRDD2_NATIVE_ROOT=/opt/airdd2/backend-python',
            '--entrypoint',
            'python3',
            this.runtimeConfig.pythonRuntimeImage,
            '-c',
            script
        ];
        const result = await this.runner.run(this.runtimeConfig.dockerExecutable, args, this.runtimeConfig.probeTimeoutMs);
        const parsed = this.parseNativePythonImportProbeResult(result.stdout);
        const errorsByModule = new Map<string, string>();

        for (const entry of parsed.missing) {
            if (typeof entry.module === 'string') {
                errorsByModule.set(entry.module, typeof entry.error === 'string' ? entry.error : 'Import critique indisponible');
            }
        }

        const imports = target.dependencies.map((dependency) => {
            const detail = errorsByModule.get(dependency.module);
            return {
                dependency: dependency.dependency,
                module: dependency.module,
                available: !detail,
                detail
            };
        });

        if (result.exitCode === 0 && !result.timedOut && imports.every((entry) => entry.available)) {
            return {
                toolName: target.toolName,
                status: 'healthy',
                summary: `Imports critiques verifies pour ${target.toolName}.`,
                checkedAt,
                imports
            };
        }

        const failureDetail = this.describeFailure(result);
        const normalizedImports = imports.map((entry) => entry.available ? entry : entry).map((entry) => ({
            ...entry,
            detail: entry.detail ?? failureDetail
        }));
        const missingModules = normalizedImports.filter((entry) => !entry.available).map((entry) => entry.module);

        return {
            toolName: target.toolName,
            status: 'degraded',
            summary: missingModules.length > 0
                ? `Imports critiques indisponibles pour ${target.toolName}: ${missingModules.join(', ')}`
                : `Probe imports critiques echouee pour ${target.toolName}: ${failureDetail}`,
            checkedAt,
            imports: normalizedImports
        };
    }

    private parseNativePythonImportProbeResult(stdout: string): { missing: Array<{ module?: unknown; error?: unknown }> } {
        const normalized = stdout.trim();
        if (!normalized) {
            return { missing: [] };
        }

        try {
            const parsed = JSON.parse(normalized) as { missing?: Array<{ module?: unknown; error?: unknown }> };
            return {
                missing: Array.isArray(parsed.missing) ? parsed.missing : []
            };
        } catch {
            return { missing: [] };
        }
    }

    private async detectDockerExecutionProfile(): Promise<DockerExecutionProfile> {
        const contextNameResult = await this.runner.run(
            this.runtimeConfig.dockerExecutable,
            ['context', 'show'],
            this.runtimeConfig.probeTimeoutMs
        );
        const contextName = contextNameResult.exitCode === 0 && !contextNameResult.timedOut
            ? contextNameResult.stdout.trim()
            : undefined;

        const endpointHost = contextName
            ? await this.readDockerEndpointHost(contextName)
            : undefined;

        if (isDockerDesktopContext(contextName, endpointHost)) {
            return {
                mode: 'docker-desktop',
                securityLevel: 'dev-only',
                executionReady: true,
                warning: 'Docker Desktop détecté : mode dev-only explicite. Acceptable en développement/test, sans sécurité de production.',
                detail: 'Docker Desktop utilise un daemon Linux géré dans une VM interne et non un daemon rootless utilisateur.',
                contextName,
                endpointHost
            };
        }

        const securityOptionsResult = await this.runner.run(
            this.runtimeConfig.dockerExecutable,
            ['info', '--format', '{{json .SecurityOptions}}'],
            this.runtimeConfig.probeTimeoutMs
        );
        if (securityOptionsResult.exitCode === 0 && !securityOptionsResult.timedOut) {
            try {
                const options = JSON.parse(securityOptionsResult.stdout) as string[];
                if (options.some((option) => option.toLowerCase().includes('rootless'))) {
                    return {
                        mode: 'rootless',
                        securityLevel: 'production-ready',
                        executionReady: true,
                        contextName,
                        endpointHost
                    };
                }
            } catch {
                // Ignore JSON parse failure and continue with fallbacks.
            }
        }

        const rootlessArgs = ['info', '--format', '{{json .Rootless}}'];
        const rootlessResult = await this.runner.run(this.runtimeConfig.dockerExecutable, rootlessArgs, this.runtimeConfig.probeTimeoutMs);
        if (rootlessResult.exitCode === 0 && !rootlessResult.timedOut) {
            const parsed = parseJsonScalar(rootlessResult.stdout);
            const rootless = parsed === true || parsed === 'true';
            if (rootless) {
                return {
                    mode: 'rootless',
                    securityLevel: 'production-ready',
                    executionReady: true,
                    contextName,
                    endpointHost
                };
            }
        }

        const socketPath = resolveDockerRootlessSocketPath();
        if (await this.socketExists(socketPath)) {
            return {
                mode: 'rootless',
                securityLevel: 'production-ready',
                executionReady: true,
                detail: `Mode rootless déduit du socket utilisateur ${socketPath}.`,
                contextName,
                endpointHost
            };
        }

        if (contextName?.toLowerCase().includes('rootless')) {
            return {
                mode: 'rootless',
                securityLevel: 'production-ready',
                executionReady: true,
                contextName,
                endpointHost
            };
        }

        return {
            mode: 'rootful-linux',
            securityLevel: 'dev-only',
            executionReady: true,
            warning: 'Daemon Docker rootful détecté. Mode dev-only acceptable pour tests locaux, sans sécurité de production.',
            detail: 'Docker détecté sans indicateur rootless. Le runtime reste exécutable mais sans durcissement rootless.',
            contextName,
            endpointHost
        };
    }

    private async readDockerEndpointHost(contextName: string): Promise<string | undefined> {
        const endpointResult = await this.runner.run(
            this.runtimeConfig.dockerExecutable,
            ['context', 'inspect', contextName, '--format', '{{.Endpoints.docker.Host}}'],
            this.runtimeConfig.probeTimeoutMs
        );

        if (endpointResult.exitCode !== 0 || endpointResult.timedOut) {
            return undefined;
        }

        return endpointResult.stdout.trim();
    }

    private describeFailure(result: CommandExecutionResult): string {
        if (result.timedOut) {
            return 'Probe expirée';
        }

        return result.errorMessage || result.stderr.trim() || result.stdout.trim() || 'Commande indisponible';
    }
}

function resolveDockerRootlessSocketPath(): string {
    const runtimeDir = process.env.XDG_RUNTIME_DIR;
    if (runtimeDir) {
        return `${runtimeDir}/docker.sock`;
    }

    const uid = process.getuid?.() ?? 1000;
    return `/run/user/${uid}/docker.sock`;
}

async function defaultSocketExists(socketPath: string): Promise<boolean> {
    try {
        const entry = await stat(socketPath);
        return entry.isSocket();
    } catch {
        return false;
    }
}

function isDockerDesktopContext(contextName?: string, endpointHost?: string): boolean {
    const normalizedContext = contextName?.toLowerCase() ?? '';
    const normalizedEndpoint = endpointHost?.toLowerCase() ?? '';

    return normalizedContext.includes('desktop-linux')
        || normalizedEndpoint.includes('npipe://')
        || normalizedEndpoint.includes('dockerdesktoplinuxengine');
}

async function defaultKvmAvailable(): Promise<boolean> {
    if (process.platform !== 'linux') {
        return false;
    }

    try {
        const entry = await stat('/dev/kvm');
        return entry.isCharacterDevice();
    } catch {
        return false;
    }
}

function buildNativePythonImportProbeScript(toolName: string, modules: string[]): string {
    const encodedModules = JSON.stringify(modules);
    const encodedToolName = JSON.stringify(toolName);
    return [
        'import os, pathlib',
        'import importlib, json, sys',
        `tool_name = ${encodedToolName}`,
        `modules = ${encodedModules}`,
        'def sanitize_segment(value):',
        '    return "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in str(value or ""))',
        'native_root = pathlib.Path(os.environ.get("AIRDD2_NATIVE_ROOT", "/opt/airdd2/backend-python"))',
        'provisioned_root = native_root / ".provisioned" / "native-tools" / sanitize_segment(tool_name)',
        'if provisioned_root.exists():',
        '    for site_packages in sorted(provisioned_root.glob("*/site-packages")):',
        '        if site_packages.is_dir():',
        '            sys.path.insert(0, str(site_packages))',
        'missing = []',
        'for module in modules:',
        '    try:',
        '        importlib.import_module(module)',
        '    except Exception as exc:',
        '        missing.append({"module": module, "error": f"{type(exc).__name__}: {exc}"})',
        'print(json.dumps({"missing": missing}))',
        'sys.exit(0 if not missing else 2)'
    ].join('\n');
}