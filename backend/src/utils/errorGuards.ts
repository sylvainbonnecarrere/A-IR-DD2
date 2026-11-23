/**
 * Type-guards sur les erreurs `unknown` des blocs catch (US-RC-03) :
 * aucun `catch (error: any)`, aucun `as any` sur une erreur.
 */

export interface ErrorShape {
  message?: string;
  name?: string;
  stack?: string;
  code?: unknown;
  errors?: Record<string, { message: string; value?: unknown }>;
}

export function asErrorShape(error: unknown): ErrorShape {
  return typeof error === 'object' && error !== null ? (error as ErrorShape) : {};
}

export function errorMessageOf(error: unknown, fallback = 'Unknown error'): string {
  const message = asErrorShape(error).message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

/** Erreur Mongo de clé dupliquée (code 11000). */
export function isDuplicateKeyError(error: unknown): boolean {
  return asErrorShape(error).code === 11000;
}
