import { DockerGatewayOperationReconciler } from '../services/runtime/DockerGatewayOperationReconciler';
import type { DockerGatewayCommandRunner } from '../services/runtime/DockerGatewayProtocol';

// Fausse Docker minimale : ps/inspect/rm en mémoire, fidèle au contrat du runner.
class FakeDocker {
  private sequence = 0;
  readonly containers = new Map<string, { id: string; name: string; state: string; labels: Record<string, string> }>();
  readonly mutations: string[][] = [];
  failPs = false;
  corruptInspect = false;

  addContainer(name: string, state: string, labels: Record<string, string>) {
    this.sequence += 1;
    const id = `${this.sequence.toString(16).padStart(8, '0')}${'f'.repeat(56)}`.slice(0, 64);
    const container = { id, name, state, labels };
    this.containers.set(id, container);
    return container;
  }

  runner(): DockerGatewayCommandRunner {
    return {
      run: async (args: string[]) => {
        const [command] = args;
        if (command === 'ps') {
          if (this.failPs) return { exitCode: 1, stdout: '', stderr: 'daemon error', timedOut: false };
          const labelFilter = args.find((arg) => arg.startsWith('label='))?.slice('label='.length) ?? '';
          const [labelKey, labelValue] = labelFilter.split('=');
          const lines: string[] = [];
          for (const container of this.containers.values()) {
            if (labelValue === undefined || container.labels[labelKey] === labelValue) {
              lines.push(container.id);
            }
          }
          return { exitCode: 0, stdout: `${lines.join('\n')}${lines.length ? '\n' : ''}`, stderr: '', timedOut: false };
        }
        if (command === 'inspect') {
          if (this.corruptInspect) return { exitCode: 0, stdout: 'not-json', stderr: '', timedOut: false };
          const target = args[args.length - 1];
          const container = this.containers.get(target);
          if (!container) return { exitCode: 1, stdout: '', stderr: 'No such container', timedOut: false };
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                Id: container.id,
                Name: `/${container.name}`,
                Config: { Labels: container.labels },
                State: { Status: container.state },
              },
            ]),
            stderr: '',
            timedOut: false,
          };
        }
        if (command === 'rm') {
          this.mutations.push(args);
          const target = args[args.length - 1];
          this.containers.delete(target);
          return { exitCode: 0, stdout: target, stderr: '', timedOut: false };
        }
        return { exitCode: 1, stdout: '', stderr: `unexpected ${command}`, timedOut: false };
      },
    };
  }
}

const FENCE = 'airdd2.fence.op';
const OP_ACTIVE = 'd84ac9ed-5b79-457b-b234-605bf743dead';
const OP_ORPHAN = '11111111-4111-4111-8111-111111111111';
const OP_UNKNOWN = '22222222-4222-4222-8222-222222222222';

describe('DockerGatewayOperationReconciler.sweepOrphanReservations', () => {
  it('removes only terminal reservations whose operation is no longer active, by immutable ID', async () => {
    const docker = new FakeDocker();
    const orphan = docker.addContainer(`airdd2-j7-attempt-${OP_ORPHAN}`, 'created', { [FENCE]: OP_ORPHAN });
    const active = docker.addContainer(`airdd2-j7-attempt-${OP_ACTIVE}`, 'created', { [FENCE]: OP_ACTIVE });
    const running = docker.addContainer(`airdd2-j7-attempt-${OP_UNKNOWN}`, 'running', { [FENCE]: OP_UNKNOWN });
    const noLabel = docker.addContainer('airdd2-j7-attempt-33333333-4333-4333-8333-333333333333', 'created', {});

    const reconciler = new DockerGatewayOperationReconciler(docker.runner(), 'restart');
    const removed = await reconciler.sweepOrphanReservations(new Set([OP_ACTIVE]));

    expect(removed).toEqual([orphan.id]);
    expect(docker.mutations).toEqual([['rm', '--force', orphan.id]]); // jamais par nom
    expect(docker.containers.has(active.id)).toBe(true); // op active -> conservé
    expect(docker.containers.has(running.id)).toBe(true); // non terminal -> conservé
    expect(docker.containers.has(noLabel.id)).toBe(true); // label illisible -> conservé
  });

  it('keeps every exited reservation when its operation is still active', async () => {
    const docker = new FakeDocker();
    const exited = docker.addContainer(`airdd2-j7-attempt-${OP_ACTIVE}`, 'exited', { [FENCE]: OP_ACTIVE });

    const reconciler = new DockerGatewayOperationReconciler(docker.runner(), 'restart');
    const removed = await reconciler.sweepOrphanReservations(new Set([OP_ACTIVE]));

    expect(removed).toEqual([]);
    expect(docker.mutations).toEqual([]);
    expect(docker.containers.has(exited.id)).toBe(true);
  });

  it('fails closed: ps error or unreadable inspection removes nothing', async () => {
    const docker = new FakeDocker();
    const orphan = docker.addContainer(`airdd2-j7-attempt-${OP_ORPHAN}`, 'created', { [FENCE]: OP_ORPHAN });

    const reconciler = new DockerGatewayOperationReconciler(docker.runner(), 'restart');

    docker.failPs = true;
    expect(await reconciler.sweepOrphanReservations(new Set())).toEqual([]);
    docker.failPs = false;

    docker.corruptInspect = true;
    expect(await reconciler.sweepOrphanReservations(new Set())).toEqual([]);
    expect(docker.containers.has(orphan.id)).toBe(true);
    expect(docker.mutations).toEqual([]);
  });
});
