import { promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ts from 'typescript';
import { UserFunction, type IUserFunction } from '../models/UserFunction.model';
import { UserTool, type IUserTool, type IUserToolVersion } from '../models/UserTool.model';
import { ToolPreparationPolicyService, type PreparationPolicyErrorCode } from './toolPreparationPolicy.service';
import { createWorkspaceManager } from './workspace/WorkspaceManager';
import type { WorkspaceProvisioningResult } from './workspace/types';
import { buildGlobalLegacyFunctionClauses, buildGlobalToolClauses, buildOwnedLegacyFunctionClause, buildOwnedToolClause } from '../utils/sharedExampleAccess';

export type BuildPreparationStatus = 'ready' | 'failed';

export interface BuildPreparationResult {
    toolId?: string;
    toolVersionTag?: string;
    functionId: string;
    functionName: string;
    language: 'python' | 'typescript';
    workspaceId: string;
    workflowId: string;
    buildRoot: string;
    sourcePath: string;
    status: BuildPreparationStatus;
    builtAt: string;
    manifestPaths: string[];
    artifactPaths: string[];
    warnings: string[];
    error?: string;
}

interface BuildContext {
    fn: IUserFunction;
    workspace: WorkspaceProvisioningResult;
    sourcePath: string;
    toolKey: string;
    sourceCode: string;
}

interface BuildStrategy {
    prepare(context: BuildContext): Promise<BuildPreparationResult>;
}

export class BuildPreparationError extends Error {
    constructor(message: string, public readonly code: PreparationPolicyErrorCode | 'BUILD_PREPARATION_ERROR' = 'BUILD_PREPARATION_ERROR') {
        super(message);
        this.name = 'BuildPreparationError';
    }
}

function sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

class TypescriptBuildStrategy implements BuildStrategy {
    async prepare(context: BuildContext): Promise<BuildPreparationResult> {
        const manifestDir = path.join(context.workspace.runtimeRoots.manifestsRoot, 'tools', context.toolKey);
        const artifactDir = path.join(context.workspace.runtimeRoots.buildRoot, 'tools', context.toolKey);
        const packageJsonPath = path.join(manifestDir, 'package.json');
        const tsconfigPath = path.join(manifestDir, 'tsconfig.json');
        const artifactPath = path.join(artifactDir, 'index.js');

        await Promise.all([
            fs.mkdir(manifestDir, { recursive: true }),
            fs.mkdir(artifactDir, { recursive: true })
        ]);

        const npmDependencies = context.fn.dependencies?.npm ?? [];
        const packageJson = {
            name: `workspace-tool-${context.toolKey}`,
            private: true,
            version: `0.0.${context.fn.version ?? 1}`,
            type: 'commonjs',
            dependencies: Object.fromEntries(
                npmDependencies.map((dependency) => {
                    const lastAt = dependency.lastIndexOf('@');
                    if (lastAt > 0) {
                        return [dependency.slice(0, lastAt), dependency.slice(lastAt + 1)];
                    }

                    return [dependency, 'latest'];
                })
            )
        };

        const tsconfig = {
            compilerOptions: {
                target: 'ES2020',
                module: 'commonjs',
                esModuleInterop: true,
                strict: false,
                skipLibCheck: true
            },
            include: [context.sourcePath]
        };

        const transpiled = ts.transpileModule(context.sourceCode, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                esModuleInterop: true
            },
            fileName: path.basename(context.sourcePath),
            reportDiagnostics: true
        });

        const warnings = (transpiled.diagnostics ?? [])
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

        await Promise.all([
            fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8'),
            fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf-8'),
            fs.writeFile(artifactPath, transpiled.outputText, 'utf-8')
        ]);

        return {
            functionId: context.fn._id.toString(),
            functionName: context.fn.name,
            language: 'typescript',
            workspaceId: context.workspace.workspaceId,
            workflowId: context.fn.workflowId!.toString(),
            buildRoot: artifactDir,
            sourcePath: context.sourcePath,
            status: 'ready',
            builtAt: new Date().toISOString(),
            manifestPaths: [packageJsonPath, tsconfigPath],
            artifactPaths: [artifactPath],
            warnings
        };
    }
}

class PythonBuildStrategy implements BuildStrategy {
    async prepare(context: BuildContext): Promise<BuildPreparationResult> {
        const manifestDir = path.join(context.workspace.runtimeRoots.manifestsRoot, 'tools', context.toolKey);
        const artifactDir = path.join(context.workspace.runtimeRoots.buildRoot, 'tools', context.toolKey);
        const requirementsPath = path.join(manifestDir, 'requirements.txt');
        const artifactPath = path.join(artifactDir, `${context.fn.name}.py`);

        await Promise.all([
            fs.mkdir(manifestDir, { recursive: true }),
            fs.mkdir(artifactDir, { recursive: true })
        ]);

        const pythonDependencies = context.fn.dependencies?.python ?? [];

        await Promise.all([
            fs.writeFile(requirementsPath, pythonDependencies.join('\n'), 'utf-8'),
            fs.writeFile(artifactPath, context.sourceCode, 'utf-8')
        ]);

        return {
            functionId: context.fn._id.toString(),
            functionName: context.fn.name,
            language: 'python',
            workspaceId: context.workspace.workspaceId,
            workflowId: context.fn.workflowId!.toString(),
            buildRoot: artifactDir,
            sourcePath: context.sourcePath,
            status: 'ready',
            builtAt: new Date().toISOString(),
            manifestPaths: [requirementsPath],
            artifactPaths: [artifactPath],
            warnings: pythonDependencies.length === 0 ? ['No Python dependencies declared; build only snapshotted the source file.'] : []
        };
    }
}

export class BuildService {
    private readonly workspaceManager = createWorkspaceManager();
    private readonly preparationPolicy = new ToolPreparationPolicyService();
    private readonly backendPythonRoot = path.resolve(__dirname, '../../python');

    async prepareToolVersion(toolId: string, userId: string, versionTag?: string): Promise<BuildPreparationResult> {
        const { tool, version } = await this.loadBuildableTool(toolId, userId, versionTag);

        if (!tool.workflowId) {
            throw new BuildPreparationError('Only workflow-scoped custom tools can be prepared during J10.');
        }

        const workspace = await this.workspaceManager.ensureWorkflowWorkspace(userId, tool.workflowId.toString());
        const toolKey = this.buildVersionedToolKey(tool.name, version.versionTag);
        const sourcePath = await this.ensureToolVersionSourceMaterialized(tool, version, workspace, toolKey);
        const sourceCode = await this.loadToolVersionSourceCode(version, sourcePath);
        const strategy = this.resolveStrategy(tool.runtime);
        const result = await strategy.prepare({
            fn: this.mapToolVersionToLegacyFunction(tool, version),
            workspace,
            sourcePath,
            toolKey,
            sourceCode
        });

        result.toolId = tool._id.toString();
        result.toolVersionTag = version.versionTag;
        result.functionId = tool._id.toString();

        const reportPath = this.resolveBuildReportPath(workspace, toolKey);
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify(result, null, 2), 'utf-8');

        await this.markToolVersionBuilt(tool, version.versionTag);

        return result;
    }

    async getToolBuildStatus(toolId: string, userId: string, versionTag?: string): Promise<BuildPreparationResult | null> {
        const tool = await this.loadOwnedOrNativeTool(toolId, userId);
        if (!tool || !tool.workflowId) {
            return null;
        }

        const version = this.resolveToolVersion(tool, versionTag);
        const workspace = await this.workspaceManager.getWorkspace({
            ownerUserId: userId,
            scopeType: 'workflow',
            scopeId: tool.workflowId.toString()
        });

        if (!workspace) {
            return null;
        }

        const reportPath = this.resolveBuildReportPath(workspace, this.buildVersionedToolKey(tool.name, version.versionTag));
        if (!(await pathExists(reportPath))) {
            return null;
        }

        const rawReport = await fs.readFile(reportPath, 'utf-8');
        return JSON.parse(rawReport) as BuildPreparationResult;
    }

    async ensureBuildReadyForTool(toolId: string, userId: string, versionTag?: string): Promise<void> {
        const tool = await this.loadOwnedOrNativeTool(toolId, userId);
        if (!tool) {
            throw new BuildPreparationError('Tool not found or access denied.', 'TOOL_NOT_FOUND');
        }

        const version = this.resolveToolVersion(tool, versionTag);
        const policy = this.preparationPolicy.evaluateToolExecution(tool);
        if (policy.requirement === 'none') {
            return;
        }

        if (policy.requirement === 'platform_provision') {
            await this.reconcileNativeProvisionedToolVersion(tool, version.versionTag);
            const reconciledVersion = this.resolveToolVersion(tool, version.versionTag);
            if (reconciledVersion.buildStatus !== 'built') {
                throw new BuildPreparationError(policy.missingPreparationMessage ?? 'Platform provisioning is required before sandbox execution.', policy.errorCode);
            }
            return;
        }

        const buildStatus = await this.getToolBuildStatus(toolId, userId, version.versionTag);
        if (!buildStatus || buildStatus.status !== 'ready') {
            throw new BuildPreparationError(policy.missingPreparationMessage ?? 'This tool version must be prepared before sandbox execution.', policy.errorCode);
        }
    }

    async prepareFunction(functionId: string, userId: string): Promise<BuildPreparationResult> {
        const fn = await this.loadBuildableFunction(functionId, userId);

        if (!fn.workflowId) {
            throw new BuildPreparationError('Only workflow-scoped custom functions can be prepared during J5.');
        }

        const workspace = await this.workspaceManager.ensureWorkflowWorkspace(userId, fn.workflowId.toString());
        const toolKey = sanitizeSegment(fn.name);
        const sourcePath = await this.ensureSourceMaterialized(fn, workspace, toolKey, userId);
        const sourceCode = await this.loadSourceCode(fn, sourcePath);
        const strategy = this.resolveStrategy(fn.language);
        const result = await strategy.prepare({ fn, workspace, sourcePath, toolKey, sourceCode });

        const reportPath = this.resolveBuildReportPath(workspace, toolKey);
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify(result, null, 2), 'utf-8');

        await this.workspaceManager.ensureWorkflowWorkspace(userId, fn.workflowId.toString());

        return result;
    }

    async getBuildStatus(functionId: string, userId: string): Promise<BuildPreparationResult | null> {
        const fn = await this.loadBuildableFunction(functionId, userId);
        if (!fn.workflowId) {
            return null;
        }

        const workspace = await this.workspaceManager.getWorkspace({
            ownerUserId: userId,
            scopeType: 'workflow',
            scopeId: fn.workflowId.toString()
        });

        if (!workspace) {
            return null;
        }

        const reportPath = this.resolveBuildReportPath(workspace, sanitizeSegment(fn.name));
        if (!(await pathExists(reportPath))) {
            return null;
        }

        const rawReport = await fs.readFile(reportPath, 'utf-8');
        return JSON.parse(rawReport) as BuildPreparationResult;
    }

    async ensureBuildReadyForRun(functionId: string, userId: string): Promise<void> {
        const fn = await this.loadOwnedOrNativeFunction(functionId, userId);
        if (!fn) {
            return;
        }

        const policy = this.preparationPolicy.evaluateFunctionExecution(fn);
        if (policy.requirement === 'none') {
            return;
        }

        if (policy.requirement === 'platform_provision') {
            const mirroredTool = await this.loadOwnedOrNativeTool(functionId, userId);
            if (!mirroredTool || mirroredTool.currentVersion.buildStatus !== 'built') {
                throw new BuildPreparationError(policy.missingPreparationMessage ?? 'Platform provisioning is required before sandbox execution.', policy.errorCode);
            }
            return;
        }

        const buildStatus = await this.getBuildStatus(functionId, userId);
        if (!buildStatus || buildStatus.status !== 'ready') {
            throw new BuildPreparationError(policy.missingPreparationMessage ?? 'This function must be prepared before sandbox execution.', policy.errorCode);
        }
    }

    private resolveStrategy(language: IUserFunction['language']): BuildStrategy {
        if (language === 'typescript') {
            return new TypescriptBuildStrategy();
        }

        return new PythonBuildStrategy();
    }

    private async loadBuildableTool(toolId: string, userId: string, versionTag?: string): Promise<{ tool: IUserTool; version: IUserToolVersion }> {
        const tool = await this.loadOwnedOrNativeTool(toolId, userId);
        if (!tool) {
            throw new BuildPreparationError('Tool not found or access denied.', 'TOOL_NOT_FOUND');
        }

        const policy = this.preparationPolicy.evaluateToolAuthorBuild(tool);
        if (!policy.allowed) {
            throw new BuildPreparationError(policy.reason ?? 'Tool cannot be prepared by the author build workflow.', policy.errorCode);
        }

        return {
            tool,
            version: this.resolveToolVersion(tool, versionTag)
        };
    }

    private async loadBuildableFunction(functionId: string, userId: string): Promise<IUserFunction> {
        const fn = await this.loadOwnedOrNativeFunction(functionId, userId);
        if (!fn) {
            throw new BuildPreparationError('Function not found or access denied.', 'FUNCTION_NOT_FOUND');
        }

        const policy = this.preparationPolicy.evaluateFunctionAuthorBuild(fn);
        if (!policy.allowed) {
            throw new BuildPreparationError(policy.reason ?? 'Function cannot be prepared by the author build workflow.', policy.errorCode);
        }

        return fn;
    }

    private async loadOwnedOrNativeFunction(functionId: string, userId: string): Promise<IUserFunction | null> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) {
            return null;
        }

        return UserFunction.findOne({
            _id: functionId,
            $or: [
                ...buildGlobalLegacyFunctionClauses(),
                buildOwnedLegacyFunctionClause(userId)
            ]
        }).exec();
    }

    private async loadOwnedOrNativeTool(toolId: string, userId: string): Promise<IUserTool | null> {
        if (!mongoose.Types.ObjectId.isValid(toolId)) {
            return null;
        }

        return UserTool.findOne({
            _id: toolId,
            $or: [
                ...buildGlobalToolClauses(),
                buildOwnedToolClause(userId)
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

    private mapToolVersionToLegacyFunction(tool: IUserTool, version: IUserToolVersion): IUserFunction {
        return {
            _id: tool._id,
            name: tool.name,
            description: tool.description,
            language: tool.runtime,
            origin: tool.scopeType === 'native' ? 'native' : 'custom',
            tags: tool.tags,
            userId: tool.ownerUserId,
            workflowId: tool.workflowId,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            codePath: version.sourcePath ?? undefined,
            codeInline: version.sourceInline ?? undefined,
            dependencies: tool.dependencies,
            isEnabled: tool.isEnabled,
            isReadonly: tool.isReadonly,
            version: this.parseVersionNumber(version.versionTag),
            createdAt: tool.createdAt,
            updatedAt: tool.updatedAt,
        } as IUserFunction;
    }

    private buildVersionedToolKey(name: string, versionTag: string): string {
        return `${sanitizeSegment(name)}_${sanitizeSegment(versionTag || 'current')}`;
    }

    private async ensureSourceMaterialized(
        fn: IUserFunction,
        workspace: WorkspaceProvisioningResult,
        toolKey: string,
        userId: string
    ): Promise<string> {
        const extension = fn.language === 'python' ? 'py' : 'ts';
        const relativePath = fn.codePath && !path.isAbsolute(fn.codePath)
            ? fn.codePath
            : path.join('tools', `${toolKey}.${extension}`);
        const sourcePath = path.resolve(workspace.runtimeRoots.sourceRoot, relativePath);

        await fs.mkdir(path.dirname(sourcePath), { recursive: true });

        if (typeof fn.codeInline === 'string') {
            await fs.writeFile(sourcePath, fn.codeInline, 'utf-8');
        } else if (!(await pathExists(sourcePath))) {
            throw new BuildPreparationError('No inline code or existing source file available to prepare this function.');
        }

        if (fn.codePath !== relativePath) {
            await UserFunction.updateOne(
                { _id: fn._id, userId: new mongoose.Types.ObjectId(userId) },
                { $set: { codePath: relativePath } }
            );
            fn.codePath = relativePath;
        }

        return sourcePath;
    }

    private async ensureToolVersionSourceMaterialized(
        tool: IUserTool,
        version: IUserToolVersion,
        workspace: WorkspaceProvisioningResult,
        toolKey: string
    ): Promise<string> {
        const extension = tool.runtime === 'python' ? 'py' : 'ts';
        const relativePath = version.sourcePath && !path.isAbsolute(version.sourcePath)
            ? version.sourcePath
            : path.join('tools', `${toolKey}.${extension}`);
        const sourcePath = path.resolve(workspace.runtimeRoots.sourceRoot, relativePath);

        await fs.mkdir(path.dirname(sourcePath), { recursive: true });

        if (typeof version.sourceInline === 'string') {
            await fs.writeFile(sourcePath, version.sourceInline, 'utf-8');
        } else if (!(await pathExists(sourcePath))) {
            throw new BuildPreparationError('No inline code or existing source file available to prepare this tool version.');
        }

        return sourcePath;
    }

    private async loadSourceCode(fn: IUserFunction, sourcePath: string): Promise<string> {
        if (typeof fn.codeInline === 'string') {
            return fn.codeInline;
        }

        if (!(await pathExists(sourcePath))) {
            throw new BuildPreparationError('Source file missing from workspace.');
        }

        return fs.readFile(sourcePath, 'utf-8');
    }

    private async loadToolVersionSourceCode(version: IUserToolVersion, sourcePath: string): Promise<string> {
        if (typeof version.sourceInline === 'string') {
            return version.sourceInline;
        }

        if (!(await pathExists(sourcePath))) {
            throw new BuildPreparationError('Source file missing from workspace.');
        }

        return fs.readFile(sourcePath, 'utf-8');
    }

    private resolveBuildReportPath(workspace: WorkspaceProvisioningResult, toolKey: string): string {
        return path.join(workspace.runtimeRoots.buildRoot, 'tools', toolKey, 'build-report.json');
    }

    private resolveNativeProvisionReportPath(toolName: string, versionTag: string): string {
        return path.join(
            this.backendPythonRoot,
            '.provisioned',
            'native-tools',
            sanitizeSegment(toolName),
            sanitizeSegment(versionTag || 'current'),
            'provision-report.json'
        );
    }

    private async reconcileNativeProvisionedToolVersion(tool: IUserTool, versionTag: string): Promise<void> {
        const resolvedVersion = this.resolveToolVersion(tool, versionTag);
        if (resolvedVersion.buildStatus === 'built') {
            return;
        }

        const reportPath = this.resolveNativeProvisionReportPath(tool.name, versionTag);
        if (!(await pathExists(reportPath))) {
            return;
        }

        try {
            const rawReport = await fs.readFile(reportPath, 'utf-8');
            const report = JSON.parse(rawReport) as {
                status?: string;
                toolVersionTag?: string;
            };

            if (report.status !== 'ready') {
                return;
            }

            tool.versions = tool.versions.map((candidate) => (
                candidate.versionTag === versionTag
                    ? { ...candidate, buildStatus: 'built', validationStatus: 'valid' }
                    : candidate
            ));

            if (tool.currentVersion.versionTag === versionTag) {
                tool.currentVersion = {
                    ...tool.currentVersion,
                    buildStatus: 'built',
                    validationStatus: 'valid'
                };
            }

            await tool.save();
        } catch {
            return;
        }
    }

    private async markToolVersionBuilt(tool: IUserTool, versionTag: string): Promise<void> {
        tool.versions = tool.versions.map((candidate) => (
            candidate.versionTag === versionTag
                ? { ...candidate, buildStatus: 'built' }
                : candidate
        ));

        if (tool.currentVersion.versionTag === versionTag) {
            tool.currentVersion = {
                ...tool.currentVersion,
                buildStatus: 'built'
            };
        }

        await tool.save();
    }

    private parseVersionNumber(versionTag?: string | null): number {
        if (!versionTag) {
            return 1;
        }

        const match = versionTag.match(/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : 1;
    }
}
