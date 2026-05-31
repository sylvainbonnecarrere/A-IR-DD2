import { spawn } from 'child_process';
import { IRunner, RunResult, RunnerOptions } from '../types/webFetchTypes';

/**
 * NativeRunner: executes a whitelisted python tool in a sandboxed fashion.
 * For now this is a safe skeleton that spawns a process and collects output with timeouts.
 */
export class NativeRunner implements IRunner {
  private pythonExecutable: string;

  constructor(pythonExecutable = 'python3') {
    this.pythonExecutable = pythonExecutable;
  }

  async run(commandArgs: string[], input?: unknown, options?: RunnerOptions): Promise<RunResult> {
    const timeoutMs = options?.timeoutMs ?? 60_000;
    return new Promise<RunResult>((resolve) => {
      const child = spawn(this.pythonExecutable, commandArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      let finished = false;

      const timer = setTimeout(() => {
        if (!finished) {
          try { child.kill('SIGKILL'); } catch (e) {}
          finished = true;
          resolve({ success: false, exitCode: null as any, stdout, stderr: stderr + '\nTimeout' });
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ success: false, stderr: String(err), stdout });
      });

      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ success: code === 0, exitCode: code ?? undefined, stdout, stderr });
      });

      // Send input as JSON on stdin when provided (privateContext or args)
      if (input !== undefined) {
        try {
          const payload = typeof input === 'string' ? input : JSON.stringify(input);
          child.stdin.write(payload);
        } catch (e) {
          // ignore
        }
      }
      try { child.stdin.end(); } catch (e) {}
    });
  }
}

export default NativeRunner;
