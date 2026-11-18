import {
    DEFAULT_RECOVERY_POLICY,
    MAX_RECOVERY_ATTEMPTS_LIMIT,
    RecoveryPolicySchema,
    buildAutoRecoveryIdempotencyKey,
    canAutoRecoverRun,
    isAgentAutoRecoveryEnvEnabled,
    normalizeRecoveryPolicy,
} from '../domain/execution/recoveryPolicy.contract';

describe('recoveryPolicy contract (US-J7-08)', () => {

    describe('RecoveryPolicySchema', () => {

        it('accepts a valid policy', () => {
            expect(RecoveryPolicySchema.parse({ autoFenceAndRetry: true, maxAttempts: 3 })).toEqual({
                autoFenceAndRetry: true,
                maxAttempts: 3,
            });
        });

        it('accepts the default off policy', () => {
            expect(RecoveryPolicySchema.parse(DEFAULT_RECOVERY_POLICY)).toEqual(DEFAULT_RECOVERY_POLICY);
        });

        it('rejects non-integer or out-of-range maxAttempts', () => {
            expect(RecoveryPolicySchema.safeParse({ autoFenceAndRetry: true, maxAttempts: -1 }).success).toBe(false);
            expect(RecoveryPolicySchema.safeParse({ autoFenceAndRetry: true, maxAttempts: 1.5 }).success).toBe(false);
            expect(RecoveryPolicySchema.safeParse({ autoFenceAndRetry: true, maxAttempts: MAX_RECOVERY_ATTEMPTS_LIMIT + 1 }).success).toBe(false);
        });

        it('rejects unknown keys (strict)', () => {
            expect(RecoveryPolicySchema.safeParse({ autoFenceAndRetry: true, maxAttempts: 1, extra: true }).success).toBe(false);
        });

        it('rejects non-boolean autoFenceAndRetry', () => {
            expect(RecoveryPolicySchema.safeParse({ autoFenceAndRetry: 'yes', maxAttempts: 1 }).success).toBe(false);
        });
    });

    describe('normalizeRecoveryPolicy', () => {

        it('returns the default off policy for nullish values', () => {
            expect(normalizeRecoveryPolicy(undefined)).toEqual(DEFAULT_RECOVERY_POLICY);
            expect(normalizeRecoveryPolicy(null)).toEqual(DEFAULT_RECOVERY_POLICY);
        });

        it('throws on invalid values', () => {
            expect(() => normalizeRecoveryPolicy({ autoFenceAndRetry: true })).toThrow('Invalid recoveryPolicy');
            expect(() => normalizeRecoveryPolicy('on')).toThrow('Invalid recoveryPolicy');
        });
    });

    describe('canAutoRecoverRun', () => {

        it('allows recovery only when the policy is active and below the threshold', () => {
            const policy = { autoFenceAndRetry: true, maxAttempts: 2 };
            expect(canAutoRecoverRun(policy, 0)).toBe(true);
            expect(canAutoRecoverRun(policy, 1)).toBe(true);
            expect(canAutoRecoverRun(policy, 2)).toBe(false);
            expect(canAutoRecoverRun(policy, 3)).toBe(false);
        });

        it('never allows recovery when the policy is off', () => {
            expect(canAutoRecoverRun(DEFAULT_RECOVERY_POLICY, 0)).toBe(false);
            expect(canAutoRecoverRun({ autoFenceAndRetry: false, maxAttempts: 5 }, 0)).toBe(false);
            expect(canAutoRecoverRun({ autoFenceAndRetry: true, maxAttempts: 0 }, 0)).toBe(false);
        });
    });

    describe('isAgentAutoRecoveryEnvEnabled', () => {

        it('is enabled only for the exact value "true"', () => {
            expect(isAgentAutoRecoveryEnvEnabled({ AGENT_AUTO_RECOVERY: 'true' })).toBe(true);
            expect(isAgentAutoRecoveryEnvEnabled({ AGENT_AUTO_RECOVERY: '1' })).toBe(false);
            expect(isAgentAutoRecoveryEnvEnabled({ AGENT_AUTO_RECOVERY: 'TRUE' })).toBe(false);
            expect(isAgentAutoRecoveryEnvEnabled({})).toBe(false);
        });
    });

    describe('buildAutoRecoveryIdempotencyKey', () => {

        it('builds a deterministic per-attempt key', () => {
            expect(buildAutoRecoveryIdempotencyKey('run-1', 0)).toBe('auto-recovery:run-1:0');
            expect(buildAutoRecoveryIdempotencyKey('run-1', 1)).toBe('auto-recovery:run-1:1');
            expect(buildAutoRecoveryIdempotencyKey('run-1', 0)).not.toBe(buildAutoRecoveryIdempotencyKey('run-2', 0));
        });
    });
});
