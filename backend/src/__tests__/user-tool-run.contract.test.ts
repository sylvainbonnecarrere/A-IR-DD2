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

    it('allows only declared transitions and closes terminal states', () => {
        const validTransitions: Array<[string, string]> = [
            ['queued', 'running'],
            ['queued', 'failed'],
            ['queued', 'stopped'],
            ['queued', 'timed_out'],
            ['running', 'completed'],
            ['running', 'failed'],
            ['running', 'stopped'],
            ['running', 'timed_out'],
        ];

        validTransitions.forEach(([from, to]) => {
            expect(canTransitionUserToolRun(from as any, to as any)).toBe(true);
        });

        const forbiddenTransitions: Array<[string, string]> = [
            ['completed', 'running'],
            ['failed', 'running'],
            ['failed', 'completed'],
            ['stopped', 'running'],
            ['timed_out', 'completed'],
            ['queued', 'completed'],
            ['running', 'queued'],
        ];

        forbiddenTransitions.forEach(([from, to]) => {
            expect(canTransitionUserToolRun(from as any, to as any)).toBe(false);
        });
    });

    it('throws on forbidden transitions', () => {
        expect(() => assertUserToolRunTransition('failed', 'running', 'exec-1')).toThrow(
            'Invalid UserToolRun transition for exec-1: failed -> running'
        );
    });
});