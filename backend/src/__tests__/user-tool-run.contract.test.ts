import {
    UserToolRunPolicySnapshotSchema,
    UserToolRunStatusSchema,
    assertUserToolRunTransition,
    canTransitionUserToolRun,
} from '../domain/execution/userToolRun.contract';

describe('UserToolRun domain contract', () => {
    it('accepts canonical execution statuses', () => {
        expect(UserToolRunStatusSchema.safeParse('queued').success).toBe(true);
        expect(UserToolRunStatusSchema.safeParse('timed_out').success).toBe(true);
        expect(UserToolRunStatusSchema.safeParse('paused').success).toBe(false);
    });

    it('validates strict execution policy payloads', () => {
        const parseResult = UserToolRunPolicySnapshotSchema.safeParse({
            networkMode: 'restricted',
            timeoutSeconds: 120,
            maxMemoryMb: 512,
            secretAliases: ['OPENAI_API_KEY']
        });

        expect(parseResult.success).toBe(true);
    });

    it('rejects invalid execution policy payloads', () => {
        const parseResult = UserToolRunPolicySnapshotSchema.safeParse({
            networkMode: 'internet',
            timeoutSeconds: 0,
            extra: true
        });

        expect(parseResult.success).toBe(false);
    });

    it('allows only declared transitions', () => {
        expect(canTransitionUserToolRun('queued', 'running')).toBe(true);
        expect(canTransitionUserToolRun('running', 'completed')).toBe(true);
        expect(canTransitionUserToolRun('completed', 'running')).toBe(false);
    });

    it('throws on forbidden transitions', () => {
        expect(() => assertUserToolRunTransition('failed', 'running', 'exec-1')).toThrow(
            'Invalid UserToolRun transition for exec-1: failed -> running'
        );
    });
});