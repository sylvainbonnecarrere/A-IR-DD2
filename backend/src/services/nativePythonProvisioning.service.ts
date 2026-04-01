import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import config from '../config/environment';
import { UserTool, type IUserTool, type IUserToolVersion } from '../models/UserTool.model';
import { nativeFunctionsSeed } from '../seeds/nativeFunctions.seed';
import { BuildPreparationError } from './build.service';
import { ToolPreparationPolicyService } from './toolPreparationPolicy.service';

interface CommandExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    errorMessage?: string;
}

export interface NativePythonProvisioningCommandRunner {
    run(command: string, args: string[], timeoutMs?: number): Promise<CommandExecutionResult>;
}

interface NativePythonProvisioningServiceOptions {
    runner?: NativePythonProvisioningCommandRunner;
    backendPythonRoot?: string;
    dockerExecutable?: string;
    provisioningImage?: string;
    provisionTimeoutMs?: number;
    provisionOnStartup?: boolean;
}

export interface NativePythonProvisioningResult {
    toolId: string;
    toolName: string;
    toolVersionTag: string;
    status: 'ready' | 'failed';
    provisionedAt: string;
    dependencies: string[];
    criticalModules: string[];
    sitePackagesPath: string;
    reportPath: string;
    stdout?: string;
    stderr?: string;
    error?: string;
}

export interface NativePythonStartupProvisioningSummary {
    attempted: number;
    succeeded: number;
    failed: number;
    skipped: number;
    reports: NativePythonProvisioningResult[];
}

class SpawnCommandRunner implements NativePythonProvisioningCommandRunner {
    async run(command: string, args: string[], timeoutMs: number = 120_000): Promise<CommandExecutionResult> {
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

function sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizePythonModuleName(dependency: string): string {
    return dependency
        .trim()
        .replace(/[<>=!~].*$/, '')
        .replace(/\[.*\]$/, '')
        .replace(/-/g, '_');
}

function buildProvisioningScript(): string {
    return [
        'import importlib',
        'import json',
        'import pathlib',
        'import subprocess',
        'import sys',
        'payload = json.loads(sys.argv[1])',
        'target = payload["target"]',
        'dependencies = payload.get("dependencies") or []',
        'modules = payload.get("modules") or []',
        'pathlib.Path(target).mkdir(parents=True, exist_ok=True)',
        'pip_cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir", "--target", target, *dependencies]',
        'install_result = subprocess.run(pip_cmd, capture_output=True, text=True)',
        'if install_result.returncode != 0:',
        '    print(json.dumps({"success": False, "stage": "pip_install", "stdout": install_result.stdout, "stderr": install_result.stderr, "returncode": install_result.returncode}))',
        '    sys.exit(install_result.returncode or 1)',
        'sys.path.insert(0, target)',
        'missing = []',
        'for module in modules:',
        '    try:',
        '        importlib.import_module(module)',
        '    except Exception as exc:',
        '        missing.append({"module": module, "error": f"{type(exc).__name__}: {exc}"})',
        'if missing:',
        '    print(json.dumps({"success": False, "stage": "import_validation", "stdout": install_result.stdout, "stderr": install_result.stderr, "missing": missing}))',
        '    sys.exit(2)',
        'print(json.dumps({"success": True, "stdout": install_result.stdout, "stderr": install_result.stderr, "target": target, "modules": modules, "dependencies": dependencies}))'
    ].join('\n');
}

export class NativePythonProvisioningService {
    private readonly preparationPolicy = new ToolPreparationPolicyService();
    private readonly runner: NativePythonProvisioningCommandRunner;
    private readonly backendPythonRoot: string;
    private readonly dockerExecutable: string;
    private readonly provisioningImage: string;
    private readonly provisionTimeoutMs: number;
    private readonly provisionOnStartup: boolean;

    constructor(options: NativePythonProvisioningServiceOptions = {}) {
        this.runner = options.runner ?? new SpawnCommandRunner();
        this.backendPythonRoot = options.backendPythonRoot ?? path.resolve(__dirname, '../../python');
        this.dockerExecutable = options.dockerExecutable ?? config.runtime.dockerExecutable;
        this.provisioningImage = options.provisioningImage ?? config.runtime.pythonProvisioningImage;
        this.provisionTimeoutMs = options.provisionTimeoutMs ?? config.runtime.provisionTimeoutMs;
        this.provisionOnStartup = options.provisionOnStartup ?? config.runtime.nativePythonProvisionOnStartup;
    }

    async provisionToolVersion(toolId: string, userId: string, versionTag?: string): Promise<NativePythonProvisioningResult> {
        const tool = await this.loadOwnedOrNativeTool(toolId, userId);
        if (!tool) {
            throw new BuildPreparationError('Tool not found or access denied.', 'TOOL_NOT_FOUND');
        }

        return this.provisionResolvedTool(tool, versionTag);
    }

    async provisionPendingNativeToolsOnStartup(): Promise<NativePythonStartupProvisioningSummary> {
        if (!this.provisionOnStartup) {
            return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, reports: [] };
        }

        const tools = await UserTool.find({
            ownerUserId: null,
            scopeType: 'native',
            runtime: 'python',
            isReadonly: true,
            isEnabled: true,
            'dependencies.python.0': { $exists: true }
        }).exec();

        const reports: NativePythonProvisioningResult[] = [];
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;

        for (const tool of tools) {
            const policy = this.preparationPolicy.evaluateToolExecution(tool);
            if (policy.requirement !== 'platform_provision') {
                skipped += 1;
                continue;
            }

            if (tool.currentVersion.buildStatus === 'built') {
                skipped += 1;
                continue;
            }

            try {
                const report = await this.provisionResolvedTool(tool, tool.currentVersion.versionTag);
                reports.push(report);
                succeeded += 1;
            } catch (error) {
                failed += 1;
                const fallback = await this.readProvisioningReport(tool.name, tool.currentVersion.versionTag);
                if (fallback) {
                    reports.push(fallback);
                }
                console.warn(
                    `[NativePythonProvisioning] startup provisioning failed for ${tool.name}@${tool.currentVersion.versionTag}:`,
                    error instanceof Error ? error.message : String(error)
                );
            }
        }

        return {
            attempted: tools.length,
            succeeded,
            failed,
            skipped,
            reports
        };
    }

    private async provisionResolvedTool(tool: IUserTool, versionTag?: string): Promise<NativePythonProvisioningResult> {
        const version = this.resolveToolVersion(tool, versionTag);
        const policy = this.preparationPolicy.evaluateToolExecution(tool);
        if (policy.requirement !== 'platform_provision') {
            throw new BuildPreparationError(
                policy.missingPreparationMessage ?? 'This tool does not require platform provisioning.',
                policy.errorCode ?? 'BUILD_PREPARATION_ERROR'
            );
        }

        if (tool.runtime !== 'python' || tool.scopeType !== 'native' || !tool.isReadonly) {
            throw new BuildPreparationError('Only native readonly Python tools can be provisioned by the platform workflow.');
        }

        const hostVersionRoot = this.resolveProvisionedVersionRoot(tool.name, version.versionTag);
        const hostSitePackagesPath = path.join(hostVersionRoot, 'site-packages');
        const reportPath = path.join(hostVersionRoot, 'provision-report.json');
        const containerSitePackagesPath = this.resolveContainerSitePackagesPath(tool.name, version.versionTag);
        const criticalModules = this.resolveCriticalModules(tool);
        const dependencies = Array.isArray(tool.dependencies?.python) ? tool.dependencies.python : [];

        await fs.rm(hostVersionRoot, { recursive: true, force: true });
        await fs.mkdir(hostSitePackagesPath, { recursive: true });
        await this.updateToolVersionStatus(tool, version.versionTag, 'building', 'unknown');

        const args = [
            'run',
            '--rm',
            '--mount',
            `type=bind,src=${this.backendPythonRoot},dst=/opt/airdd2/backend-python`,
            '--workdir',
            '/opt/airdd2/backend-python',
            this.provisioningImage,
            'python3',
            '-c',
            buildProvisioningScript(),
            JSON.stringify({
                target: containerSitePackagesPath,
                dependencies,
                modules: criticalModules
            })
        ];

        const commandResult = await this.runner.run(this.dockerExecutable, args, this.provisionTimeoutMs);
        const parsed = this.parseProvisioningOutput(commandResult.stdout);
        const provisionedAt = new Date().toISOString();

        if (commandResult.exitCode === 0 && !commandResult.timedOut && parsed?.success) {
            const report: NativePythonProvisioningResult = {
                toolId: tool._id.toString(),
                toolName: tool.name,
                toolVersionTag: version.versionTag,
                status: 'ready',
                provisionedAt,
                dependencies,
                criticalModules,
                sitePackagesPath: hostSitePackagesPath,
                reportPath,
                stdout: parsed.stdout,
                stderr: parsed.stderr
            };

            await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
            await this.updateToolVersionStatus(tool, version.versionTag, 'built', 'valid');
            return report;
        }

        const failureMessage = this.buildProvisioningFailureMessage(commandResult, parsed);
        const report: NativePythonProvisioningResult = {
            toolId: tool._id.toString(),
            toolName: tool.name,
            toolVersionTag: version.versionTag,
            status: 'failed',
            provisionedAt,
            dependencies,
            criticalModules,
            sitePackagesPath: hostSitePackagesPath,
            reportPath,
            stdout: parsed?.stdout ?? commandResult.stdout,
            stderr: parsed?.stderr ?? commandResult.stderr,
            error: failureMessage
        };

        await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
        await this.updateToolVersionStatus(tool, version.versionTag, 'failed', 'invalid');
        throw new BuildPreparationError(failureMessage, 'PLATFORM_PROVISION_REQUIRED');
    }

    private async loadOwnedOrNativeTool(toolId: string, userId: string): Promise<IUserTool | null> {
        if (!mongoose.Types.ObjectId.isValid(toolId)) {
            return null;
        }

        return UserTool.findOne({
            _id: toolId,
            $or: [
                { ownerUserId: null },
                { ownerUserId: new mongoose.Types.ObjectId(userId) }
            ]
        }).exec();
    }

    private resolveToolVersion(tool: IUserTool, versionTag?: string): IUserToolVersion {
        if (!versionTag || tool.currentVersion.versionTag === versionTag) {
            return tool.currentVersion;
        }

        const matchedVersion = tool.versions.find((candidate) => candidate.versionTag === versionTag);
        if (!matchedVersion) {
            throw new BuildPreparationError(`Tool version '${versionTag}' not found.`);
        }

        return matchedVersion;
    }

    private resolveCriticalModules(tool: IUserTool): string[] {
        const nativeSeed = nativeFunctionsSeed.find((candidate) => candidate.name === tool.name);
        const seededModules = nativeSeed?.healthCheck?.criticalPythonImports ?? [];
        if (seededModules.length > 0) {
            return seededModules;
        }

        return (tool.dependencies?.python ?? []).map(normalizePythonModuleName);
    }

    private resolveProvisionedVersionRoot(toolName: string, versionTag: string): string {
        return path.join(
            this.backendPythonRoot,
            '.provisioned',
            'native-tools',
            sanitizeSegment(toolName),
            sanitizeSegment(versionTag || 'current')
        );
    }

    private resolveContainerSitePackagesPath(toolName: string, versionTag: string): string {
        return [
            '/opt/airdd2/backend-python',
            '.provisioned',
            'native-tools',
            sanitizeSegment(toolName),
            sanitizeSegment(versionTag || 'current'),
            'site-packages'
        ].join('/');
    }

    private parseProvisioningOutput(stdout: string): null | {
        success?: boolean;
        stdout?: string;
        stderr?: string;
        missing?: Array<{ module?: string; error?: string }>;
        stage?: string;
    } {
        const normalized = stdout.trim();
        if (!normalized) {
            return null;
        }

        try {
            return JSON.parse(normalized) as {
                success?: boolean;
                stdout?: string;
                stderr?: string;
                missing?: Array<{ module?: string; error?: string }>;
                stage?: string;
            };
        } catch {
            return null;
        }
    }

    private buildProvisioningFailureMessage(
        commandResult: CommandExecutionResult,
        parsed: null | {
            stderr?: string;
            missing?: Array<{ module?: string; error?: string }>;
            stage?: string;
        }
    ): string {
        if (commandResult.timedOut) {
            return 'Native Python platform provisioning timed out before completion.';
        }

        if (parsed?.stage === 'import_validation' && Array.isArray(parsed.missing) && parsed.missing.length > 0) {
            const modules = parsed.missing
                .map((entry) => entry.module)
                .filter((entry): entry is string => typeof entry === 'string');
            return `Native Python platform provisioning completed but critical imports are still missing: ${modules.join(', ')}`;
        }

        return parsed?.stderr?.trim()
            || commandResult.stderr.trim()
            || commandResult.errorMessage
            || 'Native Python platform provisioning failed.';
    }

    private async updateToolVersionStatus(
        tool: IUserTool,
        versionTag: string,
        buildStatus: IUserToolVersion['buildStatus'],
        validationStatus: IUserToolVersion['validationStatus']
    ): Promise<void> {
        if (tool.currentVersion.versionTag === versionTag) {
            tool.currentVersion.buildStatus = buildStatus;
            tool.currentVersion.validationStatus = validationStatus;
        }

        for (const candidate of tool.versions) {
            if (candidate.versionTag === versionTag) {
                candidate.buildStatus = buildStatus;
                candidate.validationStatus = validationStatus;
            }
        }

        await tool.save();
    }

    private async readProvisioningReport(toolName: string, versionTag: string): Promise<NativePythonProvisioningResult | null> {
        const reportPath = path.join(this.resolveProvisionedVersionRoot(toolName, versionTag), 'provision-report.json');
        try {
            const raw = await fs.readFile(reportPath, 'utf-8');
            return JSON.parse(raw) as NativePythonProvisioningResult;
        } catch {
            return null;
        }
    }
}