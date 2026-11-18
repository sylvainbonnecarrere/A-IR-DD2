import { z } from 'zod';

/**
 * Contrat `recoveryPolicy` (US-J7-08, conception §4.5/§4.6) : politique de
 * récupération automatique d'un run `quarantined`/`worker_lost`, persistée sur
 * le prototype d'agent et snapshotée sur l'instance.
 *
 * Défaut off : `{ autoFenceAndRetry: false, maxAttempts: 0 }`.
 * L'auto-recovery n'est active que si la policy l'autorise ET si la variable
 * d'environnement `AGENT_AUTO_RECOVERY=true` est positionnée (double garde-fou).
 */
export const MAX_RECOVERY_ATTEMPTS_LIMIT = 10;

export const RecoveryPolicySchema = z.object({
    autoFenceAndRetry: z.boolean(),
    maxAttempts: z.number().int().min(0).max(MAX_RECOVERY_ATTEMPTS_LIMIT),
}).strict();

export type RecoveryPolicy = z.infer<typeof RecoveryPolicySchema>;

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
    autoFenceAndRetry: false,
    maxAttempts: 0,
};

/** Normalise une valeur inconnue : absente -> défaut off ; invalide -> erreur. */
export function normalizeRecoveryPolicy(value: unknown): RecoveryPolicy {
    if (value === undefined || value === null) {
        return { ...DEFAULT_RECOVERY_POLICY };
    }
    const parsed = RecoveryPolicySchema.safeParse(value);
    if (!parsed.success) {
        throw new Error(`Invalid recoveryPolicy: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    }
    return parsed.data;
}

/** Seuil : autorise une auto-recovery si la policy est active et sous le plafond. */
export function canAutoRecoverRun(policy: RecoveryPolicy, recoveryAttemptCount: number): boolean {
    return policy.autoFenceAndRetry
        && policy.maxAttempts > 0
        && recoveryAttemptCount < policy.maxAttempts;
}

/** Garde-fou d'environnement : l'auto-recovery doit être explicitement activée. */
export function isAgentAutoRecoveryEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.AGENT_AUTO_RECOVERY === 'true';
}

/** Clé d'idempotence déterministe pour une tentative d'auto-recovery. */
export function buildAutoRecoveryIdempotencyKey(runId: string, recoveryAttemptCount: number): string {
    return `auto-recovery:${runId}:${recoveryAttemptCount}`;
}
