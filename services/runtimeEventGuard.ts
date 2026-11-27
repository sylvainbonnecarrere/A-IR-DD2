import type { RuntimeEventEnvelope } from '../types/runtimeEvent.generated';

/**
 * US-RC-10 — garde-fou fail-closed à la frontière socket pour `runtime:event`.
 *
 * Le contrat Zod backend (`backend/src/domain/execution/runtimeEvent.contract.ts`)
 * reste la source de vérité ; son miroir front est généré dans
 * `types/runtimeEvent.generated.ts` (vérifié en parité en CI par
 * `scripts/ci/sync-runtime-contract.mjs --check`). Ce guard n'en duplique aucun
 * littéral d'enum : il valide la structure de l'enveloppe reçue du réseau (données
 * non sûres par définition) ; la validité sémantique de `type`/`aggregateType` est
 * garantie côté front par le typage (union de littéraux) et détectée en CI par le
 * test de parité.
 */
export function isRuntimeEventEnvelope(value: unknown): value is RuntimeEventEnvelope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    v.id.length <= 120 &&
    typeof v.type === 'string' &&
    v.version === 1 &&
    typeof v.aggregateType === 'string' &&
    typeof v.aggregateId === 'string' &&
    v.aggregateId.length > 0 &&
    v.aggregateId.length <= 160 &&
    typeof v.workspaceId === 'string' &&
    /^[a-f\d]{24}$/i.test(v.workspaceId) &&
    (v.correlationId === undefined || (typeof v.correlationId === 'string' && v.correlationId.length <= 160)) &&
    typeof v.occurredAt === 'string' &&
    v.payload !== null &&
    typeof v.payload === 'object' &&
    !Array.isArray(v.payload)
  );
}
