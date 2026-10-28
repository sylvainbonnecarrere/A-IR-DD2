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
        expect(canTransitionTaskInstance('pending', 'ready')).toBe(true);
        expect(canTransitionTaskInstance('running', 'completed')).toBe(true);
        expect(canTransitionTaskInstance('running', 'timed_out')).toBe(true);
        expect(canTransitionTaskInstance('completed', 'running')).toBe(false);
    });

    it('rejects illegal task transitions', () => {
        expect(() => assertTaskInstanceTransition('failed', 'ready', 'task-1')).toThrow(
            'Invalid TaskInstance transition for task-1: failed -> ready'
        );
    });
});