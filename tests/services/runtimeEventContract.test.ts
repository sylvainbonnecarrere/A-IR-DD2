import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isRuntimeEventEnvelope } from '../../services/runtimeEventGuard';
import type { RuntimeEventEnvelope, RuntimeEventType } from '../../types/runtimeEvent.generated';

const validEnvelope = (): RuntimeEventEnvelope => ({
  id: 'evt-1700000000000-a1b2c3d4',
  type: 'run:started',
  version: 1,
  aggregateType: 'run',
  aggregateId: 'run-42',
  workspaceId: '507f1f77bcf86cd799439011',
  correlationId: 'corr-1700000000000-e5f6a7b8',
  occurredAt: '2026-01-01T00:00:00.000Z',
  payload: { status: 'running', stage: 'dispatch', progress: 12 },
});

describe('US-RC-10 — contrat partagé des événements runtime (front)', () => {
  it('couvre les 3 types de quarantaine US-J7-09 dans l’union de littéraux', () => {
    // Compile-time : si un littéral sortait du contrat, tsc échouerait ici.
    const quarantineTypes: RuntimeEventType[] = ['run:quarantined', 'run:fenced', 'run:recovery_relaunched'];
    for (const t of quarantineTypes) {
      const event: RuntimeEventEnvelope = { ...validEnvelope(), type: t };
      expect(isRuntimeEventEnvelope(event)).toBe(true);
    }
  });

  it('round-trip de sérialisation : stringify -> parse -> guard -> type narrowé', () => {
    const event = validEnvelope();
    const wire = JSON.stringify(event);
    const parsed: unknown = JSON.parse(wire);
    expect(isRuntimeEventEnvelope(parsed)).toBe(true);
    if (isRuntimeEventEnvelope(parsed)) {
      expect(parsed.type).toBe('run:started');
      // narrowing par l’union : comparaison sur un littéral du contrat
      if (parsed.type === 'run:fenced') {
        expect(parsed.aggregateType).toBe('run');
      }
      expect(parsed.payload).toEqual(event.payload);
    }
  });

  it('le guard rejette les enveloppes malformées (fail-closed)', () => {
    const base = validEnvelope();
    expect(isRuntimeEventEnvelope(null)).toBe(false);
    expect(isRuntimeEventEnvelope('run:started')).toBe(false);
    expect(isRuntimeEventEnvelope([])).toBe(false);
    expect(isRuntimeEventEnvelope({ ...base, version: 2 })).toBe(false);
    expect(isRuntimeEventEnvelope({ ...base, workspaceId: 'not-an-objectid' })).toBe(false);
    expect(isRuntimeEventEnvelope({ ...base, payload: [] })).toBe(false);
    expect(isRuntimeEventEnvelope({ ...base, id: '' })).toBe(false);
    expect(isRuntimeEventEnvelope({ ...base, occurredAt: 42 })).toBe(false);
    // correlationId optionnel mais typé quand présent
    expect(isRuntimeEventEnvelope({ ...base, correlationId: undefined })).toBe(true);
    expect(isRuntimeEventEnvelope({ ...base, correlationId: 7 })).toBe(false);
  });

  it('le self-test de parité du script passe (npm run contract:check:self-test)', () => {
    const root = path.resolve(__dirname, '..', '..');
    const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'ci', 'sync-runtime-contract.mjs'), '--self-test'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('self-test OK');
  });

  it('contract:check passe sur l’arbre courant (parité hash + contenu)', () => {
    const root = path.resolve(__dirname, '..', '..');
    const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'ci', 'sync-runtime-contract.mjs'), '--check'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('parité OK');
  });
});
