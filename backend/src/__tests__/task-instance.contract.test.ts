import {
    TaskInstanceStatusSchema,
    assertTaskInstanceTransition,
    canTransitionTaskInstance,
} from '../domain/execution/taskInstance.contract';

describe('TaskInstance domain contract', () => {
    it('accepts the canonical task statuses', () => {
        expect(TaskInstanceStatusSchema.safeParse('pending').success).toBe(true);
        expect(TaskInstanceStatusSchema.safeParse('cancelled').success).toBe(true);
        expect(TaskInstanceStatusSchema.safeParse('timed_out').success).toBe(true);
    });

    it('declares legal task transitions', () => {
        const validTransitions: Array<[string, string]> = [
            ['pending', 'ready'],
            ['pending', 'blocked'],
            ['pending', 'cancelled'],
            ['pending', 'timed_out'],
            ['ready', 'running'],
            ['ready', 'cancelled'],
            ['ready', 'timed_out'],
            ['running', 'completed'],
            ['running', 'failed'],
            ['running', 'blocked'],
            ['running', 'cancelled'],
            ['running', 'timed_out'],
            ['blocked', 'ready'],
            ['blocked', 'cancelled'],
            ['blocked', 'timed_out'],
        ];

        validTransitions.forEach(([from, to]) => {
            expect(canTransitionTaskInstance(from as any, to as any)).toBe(true);
        });
    });

    it('rejects illegal task transitions and terminal re-entry', () => {
        const forbiddenTransitions: Array<[string, string]> = [
            ['completed', 'running'],
            ['completed', 'ready'],
            ['failed', 'ready'],
            ['failed', 'running'],
            ['cancelled', 'ready'],
            ['timed_out', 'running'],
            ['pending', 'running'],
            ['ready', 'completed'],
            ['blocked', 'running'],
        ];

        forbiddenTransitions.forEach(([from, to]) => {
            expect(canTransitionTaskInstance(from as any, to as any)).toBe(false);
        });

        expect(() => assertTaskInstanceTransition('failed', 'ready', 'task-1')).toThrow(
            'Invalid TaskInstance transition for task-1: failed -> ready'
        );
    });
});