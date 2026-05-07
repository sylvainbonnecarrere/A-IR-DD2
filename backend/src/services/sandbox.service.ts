import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { UserFunction, IUserFunction } from '../models/UserFunction.model';
import { UserTool } from '../models/UserTool.model';
import { syncUserToolMirrorFromLegacyFunction } from './userToolMirror.service';
import { BuildPreparationError, BuildService } from './build.service';
import { NativePythonProvisioningService } from './nativePythonProvisioning.service';
import { RuntimeHealthService } from './runtimeHealth.service';
import { ExecutionOrchestrator } from './runtime/ExecutionOrchestrator';
import type { SandboxExecutionMetadata, SandboxExecutionResourceUsage } from './runtime/execution.types';
import { getSandboxErrorDetailsFromExecutionResult, RuntimeNotReadyError, type SandboxErrorDetails } from './runtime/errors';
import type { IUserToolPolicy } from '../models/UserTool.model';
import { buildGlobalLegacyFunctionClauses, buildGlobalToolClauses, buildOwnedLegacyFunctionClause, buildOwnedToolClause } from '../utils/sharedExampleAccess';

export interface SandboxResult {
    success: boolean;
    output: unknown;
    stdout?: string;
    stderr?: string;
    durationMs: number;
    timedOut?: boolean;
    executionId?: string;
    runner?: string;
    exitCode?: number;
    metadata?: SandboxExecutionMetadata;
    resourceUsage?: SandboxExecutionResourceUsage;
    errorDetails?: SandboxErrorDetails;
}

export interface SyntaxCheckResult {
    valid: boolean;
    errors: Array<{ line?: number; message: string }>;
}

interface SandboxToolSelection {
    toolId: string;
    versionRef?: {
        versionTag?: string;
        versionNumber?: number;
        workspaceId?: string | null;
    };
}

interface VersionedExecutionTarget extends IUserFunction {
    toolVersionTag?: string;
    toolContentHash?: string;
    toolBuildStatus?: 'not_built' | 'building' | 'built' | 'failed';
    policySnapshot?: IUserToolPolicy;
}

export class SandboxService {
    // C9.1: Exécutable Python détecté dynamiquement (python3 ou python selon l'OS)
    private pythonExecutable: string = 'python3';
    private pythonDetected: boolean = false;
    private readonly buildService = new BuildService();
    private readonly nativePythonProvisioningService = new NativePythonProvisioningService();
    private readonly runtimeHealthService = new RuntimeHealthService();
    private readonly executionOrchestrator = new ExecutionOrchestrator();

    /**
     * Vérifie la disponibilité du sandbox Python.
     * Détecte l'exécutable python3 ou python disponible sur l'OS courant.
     * Windows utilise souvent 'python', Linux/Mac 'python3'.
     */
    async checkHealth() {
        return this.runtimeHealthService.getHealthReport();
    }

    /**
     * Détecte l'exécutable Python disponible (python3 > python).
     * Met en cache le résultat dans this.pythonExecutable.
     */
    private async _detectPython(): Promise<{ available: boolean; version?: string; executable: string }> {
        for (const exe of ['python3', 'python']) {
            try {
                const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
                    const proc = spawn(exe, ['--version']);
                    let stdout = '';
                    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
                    proc.stderr.on('data', (d: Buffer) => { stdout += d.toString(); }); // python --version écrit sur stderr
                    proc.on('close', (code) => resolve({ code: code ?? 1, stdout }));
                    proc.on('error', () => resolve({ code: 1, stdout: '' }));
                });
                if (result.code === 0) {
                    this.pythonExecutable = exe;
                    this.pythonDetected = true;
                    return { available: true, version: result.stdout.trim(), executable: exe };
                }
            } catch { /* essayer le suivant */ }
        }
        return { available: false, executable: 'python3' };
    }

    /**
     * S'assure que l'exécutable Python est détecté avant utilisation.
     */
    private async _ensurePythonDetected(): Promise<void> {
        if (!this.pythonDetected) {
            await this._detectPython();
        }
    }

    /**
     *
     * @throws Error si la fonction est introuvable, désactivée, ou si le timeout est dépassé
     */
    async runFunction(
        functionId: string | undefined,
        userId: string,
        testArgs: Record<string, unknown> = {},
        toolSelection?: SandboxToolSelection,
        privateContext?: Record<string, unknown>,
        authHeader?: string
    ): Promise<SandboxResult> {
        // 1. Charger la fonction depuis la BDD
        // C9.1 FIX: S'assurer que Python est détecté avant execution
        await this._ensurePythonDetected();

        const fn = toolSelection
            ? await this.resolveVersionedExecutionTarget(toolSelection, userId)
            : functionId
                ? await UserFunction.findOne({
                    _id: functionId,
                    $or: [
                        ...buildGlobalLegacyFunctionClauses(),
                        buildOwnedLegacyFunctionClause(userId)
                    ]
                }).lean<IUserFunction>()
                : null;

        if (!fn) {
            const targetIdentity = toolSelection?.toolId ?? functionId ?? 'unknown';
            throw new Error(`Fonction introuvable ou accès non autorisé (id: ${targetIdentity})`);
        }

        if (!fn.isEnabled) {
            throw new Error(
                `La fonction '${fn.name}' est désactivée. Activez-la dans la bibliothèque avant d'exécuter.`
            );
        }

        const resolvedVersionTag = toolSelection
            ? (fn as VersionedExecutionTarget).toolVersionTag
            : undefined;

        try {
            if (toolSelection) {
                await this.buildService.ensureBuildReadyForTool(
                    toolSelection.toolId,
                    userId,
                    resolvedVersionTag
                );
            } else if (functionId) {
                await this.buildService.ensureBuildReadyForRun(functionId, userId);
            }
        } catch (error) {
            if (
                error instanceof BuildPreparationError
                && error.code === 'PLATFORM_PROVISION_REQUIRED'
                && toolSelection
            ) {
                await this.nativePythonProvisioningService.provisionToolVersion(
                    toolSelection.toolId,
                    userId,
                    resolvedVersionTag
                );

                await this.buildService.ensureBuildReadyForTool(
                    toolSelection.toolId,
                    userId,
                    resolvedVersionTag
                );
            } else if (error instanceof BuildPreparationError) {
                throw error;
            }
            else {
                throw error;
            }
        }

        await this.ensureRuntimeReadyForRun(fn.language);

        await syncUserToolMirrorFromLegacyFunction(fn).catch((error) => {
            console.warn('[SandboxService] user_tools mirror sync warning:', error instanceof Error ? error.message : String(error));
        });

        const executionResult = await this.executionOrchestrator.execute({
            fn,
            userId,
            args: testArgs,
            privateContext,
            launchContext: 'editor_test'
        });

        const errorDetails = getSandboxErrorDetailsFromExecutionResult(executionResult);
        return errorDetails
            ? {
                ...executionResult,
                errorDetails
            }
            : executionResult;
    }

    private async resolveVersionedExecutionTarget(
        toolSelection: SandboxToolSelection,
        userId: string
    ): Promise<VersionedExecutionTarget | null> {
        if (!mongoose.Types.ObjectId.isValid(toolSelection.toolId)) {
            return null;
        }

        const tool = await UserTool.findOne({
            _id: toolSelection.toolId,
            $or: [
                ...buildGlobalToolClauses(),
                buildOwnedToolClause(userId)
            ]
        }).lean();

        if (!tool) {
            return null;
        }

        const requestedVersionTag = toolSelection.versionRef?.versionTag;
        const resolvedVersion = requestedVersionTag
            ? this.findMatchingToolVersion(tool.versions, requestedVersionTag, toolSelection.versionRef?.versionNumber) || null
            : tool.currentVersion;

        if (!resolvedVersion) {
            throw new Error(`Version de tool introuvable pour '${tool.name}' (${requestedVersionTag})`);
        }

        const versionNumber = toolSelection.versionRef?.versionNumber
            ?? this.parseVersionNumber(resolvedVersion.versionTag);

        return {
            _id: tool._id,
            name: tool.name,
            displayName: tool.displayName,
            description: tool.description,
            language: tool.runtime,
            origin: tool.scopeType === 'native' ? 'native' : 'custom',
            tags: tool.tags,
            userId: tool.ownerUserId,
            workflowId: tool.workflowId,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            codePath: resolvedVersion.sourcePath ?? undefined,
            codeInline: resolvedVersion.sourceInline ?? undefined,
            dependencies: tool.dependencies,
            isEnabled: tool.isEnabled,
            isReadonly: tool.isReadonly,
            version: versionNumber,
            toolVersionTag: resolvedVersion.versionTag,
            toolContentHash: resolvedVersion.contentHash,
            toolBuildStatus: resolvedVersion.buildStatus,
            policySnapshot: tool.policy,
            createdAt: tool.createdAt,
            updatedAt: tool.updatedAt,
        } as VersionedExecutionTarget;
    }

    private parseVersionNumber(versionTag?: string): number {
        if (!versionTag) {
            return 1;
        }

        const match = versionTag.match(/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : 1;
    }

    private normalizeVersionAlias(versionTag?: string): string | null {
        if (typeof versionTag !== 'string') {
            return null;
        }

        const normalized = versionTag.trim().toLowerCase();
        if (!normalized) {
            return null;
        }

        const withoutPrefix = normalized.startsWith('v') ? normalized.slice(1) : normalized;
        const simpleMajor = withoutPrefix.match(/^(\d+)(?:\.0+)*$/);
        if (simpleMajor) {
            return simpleMajor[1];
        }

        return withoutPrefix;
    }

    private findMatchingToolVersion(
        versions: Array<{ versionTag: string }>,
        requestedVersionTag?: string,
        requestedVersionNumber?: number
    ) {
        if (!requestedVersionTag && !requestedVersionNumber) {
            return null;
        }

        const exactMatch = requestedVersionTag
            ? versions.find((version) => version.versionTag === requestedVersionTag)
            : undefined;
        if (exactMatch) {
            return exactMatch;
        }

        const normalizedRequestedTag = this.normalizeVersionAlias(requestedVersionTag);
        if (normalizedRequestedTag) {
            const aliasMatch = versions.find((version) => this.normalizeVersionAlias(version.versionTag) === normalizedRequestedTag);
            if (aliasMatch) {
                return aliasMatch;
            }
        }

        if (Number.isFinite(requestedVersionNumber)) {
            return versions.find((version) => this.parseVersionNumber(version.versionTag) === requestedVersionNumber);
        }

        return null;
    }

    private async ensureRuntimeReadyForRun(language: 'python' | 'typescript'): Promise<void> {
        const { report, readiness } = await this.executionOrchestrator.getPreferredRunnerReadiness(language);

        if (!readiness.ready) {
            throw new RuntimeNotReadyError(readiness.reason ?? report.summary);
        }
    }

    /**
     * Vérifie la syntaxe d'un snippet de code sans l'exécuter.
     */
    async checkSyntax(
        language: 'python' | 'typescript',
        code: string
    ): Promise<SyntaxCheckResult> {
        if (language === 'python') {
            return this._checkPythonSyntax(code);
        }
        // TypeScript syntax check stub — à implémenter avec un parser TS en V2
        return { valid: true, errors: [] };
    }

    /**
     * Vérification syntaxique Python via `python3 -m py_compile`
     */
    private _checkPythonSyntax(code: string): Promise<SyntaxCheckResult> {
        return new Promise((resolve) => {
            // Écrire le code sur stdin de py_compile
            // C9.1 FIX: utiliser l'exécutable détecté
            const proc = spawn(this.pythonExecutable, ['-c', `
import ast, sys, json
try:
    ast.parse(sys.stdin.read())
    print(json.dumps({"valid": True, "errors": []}))
except SyntaxError as e:
    print(json.dumps({"valid": False, "errors": [{"line": e.lineno, "message": str(e.msg)}]}))
`]);

            let output = '';
            proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
            proc.stdin.write(code);
            proc.stdin.end();

            proc.on('close', () => {
                try {
                    resolve(JSON.parse(output));
                } catch {
                    resolve({ valid: false, errors: [{ message: 'Erreur interne de vérification syntaxique' }] });
                }
            });

            proc.on('error', () => {
                resolve({ valid: false, errors: [{ message: 'Python3 non disponible' }] });
            });
        });
    }

}
