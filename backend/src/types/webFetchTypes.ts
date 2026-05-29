export interface RunnerOptions {
  timeoutMs?: number;
  maxOutputSize?: number;
}

export interface RunResult {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  artifacts?: Array<{ path: string; kind: string; metadata?: Record<string, unknown> }>;
}

export interface IRunner {
  run(commandArgs: string[], input?: unknown, options?: RunnerOptions): Promise<RunResult>;
}

export interface IWebFetchService {
  runFetch(url: string, options: { privateContext?: Record<string, unknown>; workflowId?: string; instanceId?: string }): Promise<RunResult>;
}

export interface IArtifactRepository {
  saveArtifact(params: { workflowId?: string; instanceId?: string; path: string; kind: string; metadata?: Record<string, unknown> }): Promise<void>;
}
