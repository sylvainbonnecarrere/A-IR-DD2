import { IWebFetchService, RunResult } from '../types/webFetchTypes';
import RunnerFactory from '../runners/runnerFactory';
import { validateUrl } from './urlValidator';
import ArtifactRepository from '../repositories/artifactRepository';

export class WebFetchService implements IWebFetchService {
  private artifactRepo: ArtifactRepository;

  constructor() {
    this.artifactRepo = new ArtifactRepository();
  }

  async runFetch(url: string, options: { privateContext?: Record<string, unknown>; workflowId?: string; instanceId?: string }): Promise<RunResult> {
    // 1. validate URL (initial)
    validateUrl(url);

    // 2. choose runner
    const runner = RunnerFactory.create('native');

    // 3. prepare args - this is a convention: python -m web_fetch_tool --url '<url>'
    const args = ['-m', 'web_fetch_tool', '--url', url];

    // 4. run safely (do not log privateContext)
    const result = await runner.run(args, { privateContext: options.privateContext });

    // 5. persist artifacts if any (skeleton)
    if (result.artifacts && result.artifacts.length > 0) {
      for (const a of result.artifacts) {
        await this.artifactRepo.saveArtifact({ workflowId: options.workflowId, instanceId: options.instanceId, path: a.path, kind: a.kind, metadata: a.metadata });
      }
    }

    return result;
  }
}

export default WebFetchService;
