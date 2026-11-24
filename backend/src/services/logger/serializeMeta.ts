/**
 * Sérialisation sûre du contexte structuré des logs (US-RC-06) :
 * Error -> { name, message, stack }, ObjectId -> string, circulaires tronqués.
 */
import { Types } from 'mongoose';

export function serializeMetaValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Types.ObjectId) {
    return value.toString();
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => serializeMetaValue(item, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeMetaValue(entry, seen);
    }
    return out;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

export function serializeMeta(meta: unknown[]): unknown[] {
  return meta.map((item) => serializeMetaValue(item));
}
