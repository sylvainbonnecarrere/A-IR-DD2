import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../../scripts/runtime/runtime-utils.cjs', () => ({
    runtimeArtifacts: [
        { label: 'Node.js runtime', image: 'node:test', purpose: 'runtime' },
        { label: 'Python runtime', image: 'python:test', purpose: 'runtime' },
        { label: 'Python provisioning image', image: 'provisioning:test', purpose: 'provisioning' },
    ],
    parseArgs: (argv: string[]) => new Set(argv.slice(2)),
    printOutput: jest.fn(),
    summarizeStatus: (components: Array<{ status: string }>) =>
        components.some((component) => component.status === 'unhealthy') ? 'unhealthy' : 'healthy',
    buildTextReport: jest.fn(),
    inspectDockerState: jest.fn(),
    imageExists: jest.fn(),
    resolveScanner: jest.fn(),
    scanRuntimeImage: jest.fn(),
}));

const utils = require('../../scripts/runtime/runtime-utils.cjs');
const { main } = require('../../scripts/runtime/scan-runtime.cjs');

describe('runtime scan report', () => {
    let tempDir: string;
    let report: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-scan-report-'));
        report = path.join(tempDir, 'reports', 'scan.json');
        utils.inspectDockerState.mockResolvedValue({ available: true, version: 'test' });
        utils.resolveScanner.mockResolvedValue({ key: 'trivy', label: 'Trivy' });
        utils.imageExists.mockResolvedValue(true);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('preserves the failing threshold and captures image identities and findings', async () => {
        utils.scanRuntimeImage
            .mockResolvedValueOnce({
                status: 'unhealthy',
                summary: 'CVE detected',
                detail: 'CVE-2026-1234 package 1.0 fixed 1.1',
                scanned: true,
                command: ['trivy', 'image', '--severity', 'CRITICAL,HIGH', '--exit-code', '2', 'node:test'],
                scanner: { key: 'trivy', label: 'Trivy' },
            })
            .mockResolvedValue({ status: 'healthy', summary: 'No CVE', detail: 'clean' });

        const exitCode = await main(['node', 'scan', '--fail-on-severity=high', `--report-file=${report}`]);
        const payload = JSON.parse(fs.readFileSync(report, 'utf8'));

        expect(exitCode).toBe(1);
        expect(payload.severities).toEqual(['critical', 'high']);
        expect(payload.images).toHaveLength(3);
        expect(payload.images[0]).toMatchObject({
            image: 'node:test',
            status: 'unhealthy',
            detail: 'CVE-2026-1234 package 1.0 fixed 1.1',
            scanned: true,
            command: ['trivy', 'image', '--severity', 'CRITICAL,HIGH', '--exit-code', '2', 'node:test'],
            scanner: { key: 'trivy' },
        });
        expect(utils.scanRuntimeImage).toHaveBeenCalledWith(
            expect.objectContaining({ image: 'node:test' }),
            expect.objectContaining({ severities: ['critical', 'high'] }),
        );
    });

    it('records a Docker failure without reporting success', async () => {
        utils.inspectDockerState.mockResolvedValue({ available: false, detail: 'Docker unavailable' });

        expect(await main(['node', 'scan', `--report-file=${report}`])).toBe(1);
        expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({
            status: 'unhealthy',
            docker: { available: false },
            images: [],
        });
        expect(utils.scanRuntimeImage).not.toHaveBeenCalled();
    });

    it('fails explicitly when the report cannot be written', async () => {
        utils.scanRuntimeImage.mockResolvedValue({ status: 'healthy', summary: 'No CVE' });
        await expect(main(['node', 'scan', `--report-file=${tempDir}`])).rejects.toThrow();
    });

    it('records the actual Trivy command and severity gate', async () => {
        const actualUtils = jest.requireActual('../../scripts/runtime/runtime-utils.cjs');
        const result = await actualUtils.scanRuntimeImage(
            { image: 'node:test' },
            { scanner: { key: 'trivy', label: 'Trivy' }, severities: ['critical', 'high'], dryRun: true },
        );
        expect(result.command).toEqual([
            'trivy', 'image', '--severity', 'CRITICAL,HIGH', '--exit-code', '2', 'node:test',
        ]);
    });
});
