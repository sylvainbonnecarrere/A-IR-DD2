import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { User } from '../models/User.model';
import { UserTool } from '../models/UserTool.model';
import { BuildPreparationError } from '../services/build.service';
import {
    NativePythonProvisioningService,
    type NativePythonProvisioningCommandRunner
} from '../services/nativePythonProvisioning.service';

class FakeProvisioningRunner implements NativePythonProvisioningCommandRunner {
    public readonly calls: Array<{ command: string; args: string[]; timeoutMs?: number }> = [];

    constructor(private readonly result: { exitCode: number; stdout?: string; stderr?: string; timedOut?: boolean; errorMessage?: string }) {}

    async run(command: string, args: string[], timeoutMs?: number) {
        this.calls.push({ command, args, timeoutMs });
        return {
            exitCode: this.result.exitCode,
            stdout: this.result.stdout ?? '',
            stderr: this.result.stderr ?? '',
            timedOut: this.result.timedOut ?? false,
            errorMessage: this.result.errorMessage
        };
    }
}

describe('NativePythonProvisioningService', () => {
    let backendPythonRoot: string;

    beforeEach(async () => {
        backendPythonRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-native-provision-'));
    });

    afterEach(async () => {
        await fs.rm(backendPythonRoot, { recursive: true, force: true });
        await UserTool.deleteMany({ name: /web_search_py/i });
        await User.deleteMany({ email: /native-provision/i });
    });

    it('provisions a native Python tool into a versioned site-packages root and marks it built', async () => {
        const user = await User.create({
            email: `native-provision-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `nativeprovision${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'web_search_py',
            description: 'Recherche web native',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v-ready',
                contentHash: 'hash-ready',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_search_py.py',
                sourceInline: null,
                entrypoint: 'backend/python/native/web_search_py.py',
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v-ready',
                contentHash: 'hash-ready',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_search_py.py',
                sourceInline: null,
                entrypoint: 'backend/python/native/web_search_py.py',
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['search'],
            dependencies: { npm: [], python: ['ddgs==9.6.1', 'duckduckgo-search==6.1.0'] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: true,
            isEnabled: true
        });

        const runner = new FakeProvisioningRunner({
            exitCode: 0,
            stdout: JSON.stringify({
                success: true,
                stdout: 'pip ok',
                stderr: '',
                target: '/opt/airdd2/backend-python/.provisioned/native-tools/web_search_py/v-ready/site-packages'
            })
        });
        const service = new NativePythonProvisioningService({
            runner,
            backendPythonRoot,
            dockerExecutable: 'docker',
            provisioningImage: 'airdd2-python-provisioning:3.12-ubuntu-noble',
            provisionTimeoutMs: 5000
        });

        const result = await service.provisionToolVersion(tool.id, user.id, 'v-ready');

        expect(result.status).toBe('ready');
        expect(result.toolName).toBe('web_search_py');
        expect(result.sitePackagesPath).toContain(path.join('web_search_py', 'v-ready', 'site-packages'));
        await expect(fs.readFile(result.reportPath, 'utf-8')).resolves.toContain('"status": "ready"');
        expect(result.criticalModules).toEqual(['duckduckgo_search']);

        expect(runner.calls).toHaveLength(1);
        expect(runner.calls[0]?.command).toBe('docker');
        expect(runner.calls[0]?.args).toEqual(expect.arrayContaining([
            'run',
            '--rm',
            'airdd2-python-provisioning:3.12-ubuntu-noble',
            'python3'
        ]));

        const refreshed = await UserTool.findById(tool._id).lean();
        expect(refreshed?.currentVersion.buildStatus).toBe('built');
        expect(refreshed?.currentVersion.validationStatus).toBe('valid');
    });

    it('marks the native tool version failed when provisioning cannot validate imports', async () => {
        const user = await User.create({
            email: `native-provision-fail-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `nativeprovisionfail${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'web_search_py',
            description: 'Recherche web native',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v-fail',
                contentHash: 'hash-fail',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_search_py.py',
                sourceInline: null,
                entrypoint: 'backend/python/native/web_search_py.py',
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v-fail',
                contentHash: 'hash-fail',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_search_py.py',
                sourceInline: null,
                entrypoint: 'backend/python/native/web_search_py.py',
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['search'],
            dependencies: { npm: [], python: ['ddgs==9.6.1', 'duckduckgo-search==6.1.0'] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: true,
            isEnabled: true
        });

        const runner = new FakeProvisioningRunner({
            exitCode: 2,
            stdout: JSON.stringify({
                success: false,
                stage: 'import_validation',
                stdout: 'pip ok',
                stderr: '',
                missing: [{ module: 'duckduckgo_search', error: 'ModuleNotFoundError: missing' }]
            })
        });
        const service = new NativePythonProvisioningService({
            runner,
            backendPythonRoot,
            dockerExecutable: 'docker',
            provisioningImage: 'airdd2-python-provisioning:3.12-ubuntu-noble',
            provisionTimeoutMs: 5000
        });

        await expect(service.provisionToolVersion(tool.id, user.id, 'v-fail'))
            .rejects
            .toThrow(BuildPreparationError);

        const refreshed = await UserTool.findById(tool._id).lean();
        expect(refreshed?.currentVersion.buildStatus).toBe('failed');
        expect(refreshed?.currentVersion.validationStatus).toBe('invalid');

        const reportPath = path.join(backendPythonRoot, '.provisioned', 'native-tools', 'web_search_py', 'v-fail', 'provision-report.json');
        await expect(fs.readFile(reportPath, 'utf-8')).resolves.toContain('duckduckgo_search');
    });

    it('accepts provisioning for web_search_py when duckduckgo_search is available even if ddgs is absent', async () => {
        const user = await User.create({
            email: `native-provision-fallback-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `nativeprovisionfallback${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'web_search_py',
            description: 'Recherche web native',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v-fallback-ok',
                contentHash: 'hash-fallback-ok',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_search_py.py',
                sourceInline: null,
                entrypoint: 'backend/python/native/web_search_py.py',
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v-fallback-ok',
                contentHash: 'hash-fallback-ok',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_search_py.py',
                sourceInline: null,
                entrypoint: 'backend/python/native/web_search_py.py',
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['search'],
            dependencies: { npm: [], python: ['duckduckgo-search==8.1.1'] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: true,
            isEnabled: true
        });

        const runner = new FakeProvisioningRunner({
            exitCode: 0,
            stdout: JSON.stringify({
                success: true,
                stdout: 'pip ok',
                stderr: '',
                target: '/opt/airdd2/backend-python/.provisioned/native-tools/web_search_py/v-fallback-ok/site-packages',
                modules: ['duckduckgo_search']
            })
        });
        const service = new NativePythonProvisioningService({
            runner,
            backendPythonRoot,
            dockerExecutable: 'docker',
            provisioningImage: 'airdd2-python-provisioning:3.12-ubuntu-noble',
            provisionTimeoutMs: 5000
        });

        const result = await service.provisionToolVersion(tool.id, user.id, 'v-fallback-ok');

        expect(result.status).toBe('ready');
        expect(result.criticalModules).toEqual(['duckduckgo_search']);

        const refreshed = await UserTool.findById(tool._id).lean();
        expect(refreshed?.currentVersion.buildStatus).toBe('built');
        expect(refreshed?.currentVersion.validationStatus).toBe('valid');
    });
});