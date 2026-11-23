// ⭐ US-RC-02 lot 4 : contrat commun des visionneuses JSON (components/com/*).
// Toute valeur JSON arbitraire est manipulée en `unknown` côté frontières,
// et classifiée ici par un type-guard (sans type flottant).
export type JsonValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export const jsonTypeOf = (value: unknown): JsonValueType => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  // undefined, function, symbol, bigint -> affiché comme null
  return 'null';
};

/** Record sûr pour Object.keys/entries sur une valeur JSON object/array. */
export const asJsonRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
