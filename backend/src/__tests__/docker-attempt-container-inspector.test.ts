import { randomUUID } from 'crypto';
import { DockerAttemptContainerInspector } from '../services/runtime/DockerAttemptContainerInspector';
import { DockerAttemptReservation, type DockerReservationCommand } from '../services/runtime/DockerAttemptReservation';

describe('experimental attempt container inspection', () => {
    const attemptId = randomUUID();
    const id = 'a'.repeat(64);
    const name = DockerAttemptReservation.containerName(attemptId);
    const inspectResult = () => ({
        Id: id,
        Name: `/${name}`,
        Config: { Labels: { 'airdd2.execution.attempt': attemptId } },
        State: { Status: 'exited' },
    });
    let command: jest.Mocked<DockerReservationCommand>;
    let inspector: DockerAttemptContainerInspector;

    beforeEach(() => {
        command = { run: jest.fn().mockResolvedValue(JSON.stringify([inspectResult()])) };
        inspector = new DockerAttemptContainerInspector(command);
    });

    it.each(['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'])(
        'reports %s only as an observation of the exact ID',
        async (state) => {
            const result = inspectResult();
            result.State.Status = state;
            command.run.mockResolvedValue(JSON.stringify([result]));
            await expect(inspector.inspect(attemptId, id)).resolves.toEqual({ containerId: id, attemptId, state });
            expect(command.run).toHaveBeenCalledWith(['inspect', id]);
        },
    );

    it.each(['', 'abc', 'A'.repeat(64), name])('refuses a non-full or invalid ID', async (invalidId) => {
        await expect(inspector.inspect(attemptId, invalidId)).rejects.toThrow('full immutable Docker ID');
        expect(command.run).not.toHaveBeenCalled();
    });

    it('refuses an invalid attempt before accessing Docker', async () => {
        await expect(inspector.inspect('invalid', id)).rejects.toThrow('UUID');
        expect(command.run).not.toHaveBeenCalled();
    });

    it.each([
        ['different ID', { ...inspectResult(), Id: 'b'.repeat(64) }],
        ['different name', { ...inspectResult(), Name: '/other' }],
        ['missing label', { ...inspectResult(), Config: { Labels: {} } }],
        ['wrong label', { ...inspectResult(), Config: { Labels: { 'airdd2.execution.attempt': randomUUID() } } }],
        ['reservation rather than execution', { ...inspectResult(), Config: { Labels: { 'airdd2.reservation.attempt': attemptId } } }],
    ])('refuses %s', async (_label, result) => {
        command.run.mockResolvedValue(JSON.stringify([result]));
        await expect(inspector.inspect(attemptId, id)).rejects.toThrow('expected identity');
    });

    it.each(['{', '[]', '[{},{}]', 'null'])('rejects invalid inspection output %s', async (raw) => {
        command.run.mockResolvedValue(raw);
        await expect(inspector.inspect(attemptId, id)).rejects.toThrow('inspection');
    });

    it('rejects missing state and unknown state', async () => {
        command.run.mockResolvedValueOnce(JSON.stringify([{ ...inspectResult(), State: null }]));
        await expect(inspector.inspect(attemptId, id)).rejects.toThrow('incomplete');
        command.run.mockResolvedValueOnce(JSON.stringify([{ ...inspectResult(), State: { Status: 'unknown' } }]));
        await expect(inspector.inspect(attemptId, id)).rejects.toThrow('unknown state');
    });

    it('propagates Docker unavailability without converting it to absence', async () => {
        command.run.mockRejectedValue(new Error('Docker unavailable'));
        await expect(inspector.inspect(attemptId, id)).rejects.toThrow('Docker unavailable');
    });
});
