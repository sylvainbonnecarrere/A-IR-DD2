import {
  USER_TOOL_RUN_RECONCILABLE_TERMINAL_STATUS_VALUES,
  USER_TOOL_RUN_TERMINAL_STATUS_VALUES,
  UserToolRunPolicySnapshotSchema,
  UserToolRunStatusSchema,
  type UserToolRunDomainStatus,
  assertUserToolRunTransition,
  canTransitionUserToolRun,
  isUserToolRunTerminalStatus,
} from '../domain/execution/userToolRun.contract';

describe('UserToolRun domain contract', () => {
  it('accepts canonical execution statuses', () => {
    expect(UserToolRunStatusSchema.safeParse('queued').success).toBe(true);
    expect(UserToolRunStatusSchema.safeParse('timed_out').success).toBe(true);
    expect(UserToolRunStatusSchema.safeParse('worker_lost').success).toBe(true);
    expect(UserToolRunStatusSchema.safeParse('quarantined').success).toBe(true);
    expect(UserToolRunStatusSchema.safeParse('paused').success).toBe(false);
  });

  it('treats worker_lost and quarantined as irreversible terminal statuses', () => {
    expect(USER_TOOL_RUN_RECONCILABLE_TERMINAL_STATUS_VALUES).toEqual(['worker_lost', 'quarantined']);
    for (const status of ['worker_lost', 'quarantined'] as const) {
      expect(isUserToolRunTerminalStatus(status)).toBe(true);
      expect(USER_TOOL_RUN_TERMINAL_STATUS_VALUES).toContain(status);
      // Aucune transition sortante : le retry passe par un nouvel executionId.
      expect(canTransitionUserToolRun(status, 'queued')).toBe(false);
      expect(canTransitionUserToolRun(status, 'running')).toBe(false);
      expect(canTransitionUserToolRun(status, 'completed')).toBe(false);
      expect(canTransitionUserToolRun(status, 'failed')).toBe(false);
      expect(canTransitionUserToolRun(status, 'stopped')).toBe(false);
      expect(canTransitionUserToolRun(status, 'timed_out')).toBe(false);
      expect(canTransitionUserToolRun(status, 'worker_lost')).toBe(false);
      expect(canTransitionUserToolRun(status, 'quarantined')).toBe(false);
      expect(() => assertUserToolRunTransition(status, 'running', 'exec-q')).toThrow(
        `Invalid UserToolRun transition for exec-q: ${status} -> running`,
      );
    }
    // Le reconciler peut poser ces statuts depuis `running` (lease expiré), jamais depuis `queued`.
    expect(canTransitionUserToolRun('running', 'worker_lost')).toBe(true);
    expect(canTransitionUserToolRun('running', 'quarantined')).toBe(true);
    expect(canTransitionUserToolRun('queued', 'worker_lost')).toBe(false);
    expect(canTransitionUserToolRun('queued', 'quarantined')).toBe(false);
  });

  it('validates strict execution policy payloads', () => {
    const parseResult = UserToolRunPolicySnapshotSchema.safeParse({
      networkMode: 'restricted',
      timeoutSeconds: 120,
      maxMemoryMb: 512,
      secretAliases: ['OPENAI_API_KEY'],
    });

    expect(parseResult.success).toBe(true);
  });

  it('rejects invalid execution policy payloads', () => {
    const parseResult = UserToolRunPolicySnapshotSchema.safeParse({
      networkMode: 'internet',
      timeoutSeconds: 0,
      extra: true,
    });

    expect(parseResult.success).toBe(false);
  });

  it('allows only declared transitions and closes terminal states', () => {
    const validTransitions: Array<[UserToolRunDomainStatus, UserToolRunDomainStatus]> = [
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
      expect(canTransitionUserToolRun(from, to)).toBe(true);
    });

    const forbiddenTransitions: Array<[UserToolRunDomainStatus, UserToolRunDomainStatus]> = [
      ['completed', 'running'],
      ['failed', 'running'],
      ['failed', 'completed'],
      ['stopped', 'running'],
      ['timed_out', 'completed'],
      ['queued', 'completed'],
      ['running', 'queued'],
      ['worker_lost', 'queued'],
      ['worker_lost', 'running'],
      ['quarantined', 'queued'],
      ['quarantined', 'running'],
      ['worker_lost', 'quarantined'],
      ['quarantined', 'worker_lost'],
    ];

    forbiddenTransitions.forEach(([from, to]) => {
      expect(canTransitionUserToolRun(from, to)).toBe(false);
    });
  });

  it('throws on forbidden transitions', () => {
    expect(() => assertUserToolRunTransition('failed', 'running', 'exec-1')).toThrow(
      'Invalid UserToolRun transition for exec-1: failed -> running',
    );
  });
});
