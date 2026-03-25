export type RuntimeHealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type RuntimeDockerMode = 'rootless' | 'docker-desktop' | 'rootful-linux' | 'unknown';
export type RuntimeSecurityLevel = 'production-ready' | 'dev-only' | 'unavailable';
export type RuntimeRunnerId = 'docker_sandbox' | 'firecracker';

export type RuntimeHealthComponentKey =
    | 'node_runtime'
    | 'python_runtime'
    | 'docker_cli'
    | 'docker_rootless'
    | 'node_runtime_image'
    | 'python_runtime_image';

export interface RuntimeHealthComponent {
    key: RuntimeHealthComponentKey;
    label: string;
    status: RuntimeHealthStatus;
    required: boolean;
    summary: string;
    checkedAt: string;
    command?: string;
    version?: string;
    detail?: string;
    metadata?: Record<string, unknown>;
}

export interface RuntimeBinaryHealth {
    available: boolean;
    status: RuntimeHealthStatus;
    executable: string;
    version?: string;
}

export interface RuntimeImageHealth {
    available: boolean;
    status: RuntimeHealthStatus;
    image: string;
    detail?: string;
}

export interface RuntimeDockerHealth extends RuntimeBinaryHealth {
    rootless: boolean;
    mode: RuntimeDockerMode;
    securityLevel: RuntimeSecurityLevel;
    executionReady: boolean;
    warning?: string;
}

export interface RuntimeRunnerHealth {
    runner: RuntimeRunnerId;
    available: boolean;
    status: RuntimeHealthStatus;
    detail?: string;
}

export interface RuntimeCapabilities {
    build: {
        typescript: boolean;
        python: boolean;
    };
    run: {
        typescript: boolean;
        python: boolean;
        dockerRootless: boolean;
    };
}

export interface RuntimeHealthReport {
    status: RuntimeHealthStatus;
    checkedAt: string;
    summary: string;
    components: RuntimeHealthComponent[];
    runtime: {
        node: RuntimeBinaryHealth;
        python: RuntimeBinaryHealth;
        docker: RuntimeDockerHealth;
        images: {
            node: RuntimeImageHealth;
            python: RuntimeImageHealth;
        };
        runners: {
            preferred: RuntimeRunnerId;
            dockerSandbox: RuntimeRunnerHealth;
            firecracker: RuntimeRunnerHealth;
        };
        typescript: {
            available: boolean;
            status: RuntimeHealthStatus;
            engine: 'node-subprocess';
        };
    };
    capabilities: RuntimeCapabilities;
    python: {
        available: boolean;
        version?: string;
        executable: string;
    };
    typescript: {
        available: boolean;
        engine: 'node-subprocess';
    };
}