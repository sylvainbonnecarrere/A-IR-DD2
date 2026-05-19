import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { MediaCatalogService } from '../services/mediaCatalog.service';

describe('MediaCatalogService', () => {
    it('normalizes runtime output artifacts before upserting them into the media catalog', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-media-catalog-'));
        const outputRoot = path.join(tempRoot, 'output');
        const nestedDir = path.join(outputRoot, 'reports');
        await fs.mkdir(nestedDir, { recursive: true });

        const absolutePath = path.join(nestedDir, 'artifact.json');
        await fs.writeFile(absolutePath, '{"ok":true}', 'utf-8');

        const upsertRuntimeArtifact = jest.fn().mockResolvedValue({ _id: 'media-1' });
        const service = new MediaCatalogService({
            createFromJournalMedia: jest.fn(),
            upsertRuntimeArtifact,
        } as any);

        await service.registerRuntimeOutputArtifacts({
            userId: '66b111111111111111111111',
            workflowId: '66b222222222222222222222',
            agentInstanceId: '66b333333333333333333333',
            executionId: 'utr-runtime-catalog-1',
            workspaceOutputRoot: outputRoot,
            artifacts: [
                { path: 'output/reports/artifact.json', kind: 'json' },
                { path: '../outside.txt', kind: 'file' },
            ],
        });

        expect(upsertRuntimeArtifact).toHaveBeenCalledTimes(1);
        expect(upsertRuntimeArtifact).toHaveBeenCalledWith({
            userId: '66b111111111111111111111',
            workflowId: '66b222222222222222222222',
            agentInstanceId: '66b333333333333333333333',
            executionId: 'utr-runtime-catalog-1',
            localPath: 'output/reports/artifact.json',
            fileName: 'artifact.json',
            originalName: 'artifact.json',
            mimeType: 'application/json',
            size: 11,
            agentName: undefined,
        });

        await fs.rm(tempRoot, { recursive: true, force: true });
    });
});