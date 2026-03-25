import { buildBosHydrationFingerprint, hydrateToolMessagesFromPersistedRuns, resetBosRunHydrationCache } from '../../services/bosRunProjectionService';
import { toolRepository } from '../../services/toolRepository';
import type { ChatMessage } from '../../types';

jest.mock('../../services/toolRepository', () => ({
    toolRepository: {
        loadFunctionRunByExecutionId: jest.fn(),
    }
}));

const mockedToolRepository = toolRepository as jest.Mocked<typeof toolRepository>;

describe('bosRunProjectionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetBosRunHydrationCache();
    });

    it('hydrates tool messages from persisted runs by executionId', async () => {
        mockedToolRepository.loadFunctionRunByExecutionId.mockResolvedValue({
            data: {
                executionId: 'exec-1',
                status: 'completed',
                runtime: 'python',
                runner: 'docker_sandbox',
                launchContext: 'workflow_run',
                createdAt: '2026-03-19T00:00:00.000Z',
                updatedAt: '2026-03-19T00:00:10.000Z',
                timing: { durationMs: 42 },
                outputs: {
                    artifacts: [{ path: 'output/report.json', kind: 'json' }]
                }
            }
        } as any);

        const messages: ChatMessage[] = [
            {
                id: 'tool-1',
                sender: 'tool',
                text: 'demo_tool({})',
                toolName: 'demo_tool',
                timestamp: new Date('2026-03-19T00:00:00.000Z'),
                toolCallRecord: {
                    id: 'tool-1',
                    functionId: 'fn-1',
                    functionName: 'demo_tool',
                    arguments: {},
                    result: { ok: true },
                    status: 'success',
                    durationMs: 0,
                    executionId: 'exec-1',
                    timestamp: new Date('2026-03-19T00:00:00.000Z'),
                }
            }
        ];

        const hydrated = await hydrateToolMessagesFromPersistedRuns(messages);

        expect(mockedToolRepository.loadFunctionRunByExecutionId).toHaveBeenCalledWith('exec-1', 'fn-1');
        expect(hydrated[0].toolCallRecord).toEqual(expect.objectContaining({
            executionId: 'exec-1',
            durationMs: 42,
            persistedRunStatus: 'completed',
            artifacts: [{ path: 'output/report.json', kind: 'json' }],
        }));
    });

    it('keeps the same message array reference when no persisted join changes are found', async () => {
        mockedToolRepository.loadFunctionRunByExecutionId.mockResolvedValue({
            data: {
                executionId: 'exec-1',
                status: 'completed',
                runtime: 'python',
                runner: 'docker_sandbox',
                launchContext: 'workflow_run',
                createdAt: '2026-03-19T00:00:00.000Z',
                updatedAt: '2026-03-19T00:00:10.000Z',
                timing: { durationMs: 42 },
                outputs: {
                    artifacts: [{ path: 'output/report.json', kind: 'json' }]
                }
            }
        } as any);

        const messages: ChatMessage[] = [
            {
                id: 'tool-1',
                sender: 'tool',
                text: 'demo_tool({})',
                toolName: 'demo_tool',
                timestamp: new Date('2026-03-19T00:00:00.000Z'),
                toolCallRecord: {
                    id: 'tool-1',
                    functionId: 'fn-1',
                    toolId: 'fn-1',
                    functionName: 'demo_tool',
                    arguments: {},
                    result: { ok: true },
                    status: 'success',
                    durationMs: 42,
                    executionId: 'exec-1',
                    persistedRunStatus: 'completed',
                    persistedRunUpdatedAt: '2026-03-19T00:00:10.000Z',
                    artifacts: [{ path: 'output/report.json', kind: 'json' }],
                    timestamp: new Date('2026-03-19T00:00:00.000Z'),
                }
            }
        ];

        const hydrated = await hydrateToolMessagesFromPersistedRuns(messages);

        expect(hydrated).toBe(messages);
    });

    it('builds a stable hydration fingerprint when only non-tool messages change', () => {
        const toolMessage: ChatMessage = {
            id: 'tool-1',
            sender: 'tool',
            text: 'demo_tool({})',
            toolName: 'demo_tool',
            timestamp: new Date('2026-03-19T00:00:00.000Z'),
            toolCallRecord: {
                id: 'tool-1',
                functionId: 'fn-1',
                toolId: 'tool-1',
                functionName: 'demo_tool',
                arguments: {},
                result: { ok: true },
                status: 'success',
                durationMs: 42,
                executionId: 'exec-1',
                persistedRunStatus: 'completed',
                persistedRunUpdatedAt: '2026-03-19T00:00:10.000Z',
                artifacts: [{ path: 'output/report.json', kind: 'json' }],
                timestamp: new Date('2026-03-19T00:00:00.000Z'),
            }
        };

        const baseline = buildBosHydrationFingerprint([toolMessage]);
        const withExtraAgentMessage = buildBosHydrationFingerprint([
            toolMessage,
            {
                id: 'agent-1',
                sender: 'agent',
                text: 'extra response',
                timestamp: new Date('2026-03-19T00:00:20.000Z'),
            }
        ]);

        expect(withExtraAgentMessage).toBe(baseline);
    });

    it('reuses the short-lived cache across repeated hydrations', async () => {
        mockedToolRepository.loadFunctionRunByExecutionId.mockResolvedValue({
            data: {
                executionId: 'exec-1',
                status: 'completed',
                runtime: 'python',
                runner: 'docker_sandbox',
                launchContext: 'workflow_run',
                createdAt: '2026-03-19T00:00:00.000Z',
                updatedAt: '2026-03-19T00:00:10.000Z',
                timing: { durationMs: 42 },
                outputs: {
                    artifacts: [{ path: 'output/report.json', kind: 'json' }]
                }
            }
        } as any);

        const messages: ChatMessage[] = [
            {
                id: 'tool-1',
                sender: 'tool',
                text: 'demo_tool({})',
                toolName: 'demo_tool',
                timestamp: new Date('2026-03-19T00:00:00.000Z'),
                toolCallRecord: {
                    id: 'tool-1',
                    functionId: 'fn-1',
                    functionName: 'demo_tool',
                    arguments: {},
                    result: { ok: true },
                    status: 'success',
                    durationMs: 0,
                    executionId: 'exec-1',
                    timestamp: new Date('2026-03-19T00:00:00.000Z'),
                }
            }
        ];

        await hydrateToolMessagesFromPersistedRuns(messages);
        await hydrateToolMessagesFromPersistedRuns(messages);

        expect(mockedToolRepository.loadFunctionRunByExecutionId).toHaveBeenCalledTimes(1);
    });

    it('deduplicates in-flight Bos hydration lookups between concurrent callers', async () => {
        let resolveRun: ((value: any) => void) | undefined;
        mockedToolRepository.loadFunctionRunByExecutionId.mockImplementation(() => new Promise((resolve) => {
            resolveRun = resolve;
        }) as any);

        const messages: ChatMessage[] = [
            {
                id: 'tool-1',
                sender: 'tool',
                text: 'demo_tool({})',
                toolName: 'demo_tool',
                timestamp: new Date('2026-03-19T00:00:00.000Z'),
                toolCallRecord: {
                    id: 'tool-1',
                    functionId: 'fn-1',
                    functionName: 'demo_tool',
                    arguments: {},
                    result: { ok: true },
                    status: 'success',
                    durationMs: 0,
                    executionId: 'exec-1',
                    timestamp: new Date('2026-03-19T00:00:00.000Z'),
                }
            }
        ];

        const firstHydration = hydrateToolMessagesFromPersistedRuns(messages);
        const secondHydration = hydrateToolMessagesFromPersistedRuns(messages);

        expect(mockedToolRepository.loadFunctionRunByExecutionId).toHaveBeenCalledTimes(1);

        resolveRun?.({
            data: {
                executionId: 'exec-1',
                status: 'completed',
                runtime: 'python',
                runner: 'docker_sandbox',
                launchContext: 'workflow_run',
                createdAt: '2026-03-19T00:00:00.000Z',
                updatedAt: '2026-03-19T00:00:10.000Z',
                timing: { durationMs: 42 },
                outputs: {
                    artifacts: [{ path: 'output/report.json', kind: 'json' }]
                }
            }
        });

        const [firstResult, secondResult] = await Promise.all([firstHydration, secondHydration]);

        expect(firstResult[0].toolCallRecord).toEqual(expect.objectContaining({ persistedRunStatus: 'completed' }));
        expect(secondResult[0].toolCallRecord).toEqual(expect.objectContaining({ persistedRunStatus: 'completed' }));
    });

    it('expires the Bos cache after the short ttl', async () => {
        const nowSpy = jest.spyOn(Date, 'now');
        nowSpy
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(2_500)
            .mockReturnValueOnce(3_100)
            .mockReturnValueOnce(3_100);

        mockedToolRepository.loadFunctionRunByExecutionId.mockResolvedValue({
            data: {
                executionId: 'exec-1',
                status: 'completed',
                runtime: 'python',
                runner: 'docker_sandbox',
                launchContext: 'workflow_run',
                createdAt: '2026-03-19T00:00:00.000Z',
                updatedAt: '2026-03-19T00:00:10.000Z',
                timing: { durationMs: 42 },
                outputs: {
                    artifacts: [{ path: 'output/report.json', kind: 'json' }]
                }
            }
        } as any);

        const messages: ChatMessage[] = [
            {
                id: 'tool-1',
                sender: 'tool',
                text: 'demo_tool({})',
                toolName: 'demo_tool',
                timestamp: new Date('2026-03-19T00:00:00.000Z'),
                toolCallRecord: {
                    id: 'tool-1',
                    functionId: 'fn-1',
                    functionName: 'demo_tool',
                    arguments: {},
                    result: { ok: true },
                    status: 'success',
                    durationMs: 0,
                    executionId: 'exec-1',
                    timestamp: new Date('2026-03-19T00:00:00.000Z'),
                }
            }
        ];

        await hydrateToolMessagesFromPersistedRuns(messages);
        await hydrateToolMessagesFromPersistedRuns(messages);
        await hydrateToolMessagesFromPersistedRuns(messages);

        expect(mockedToolRepository.loadFunctionRunByExecutionId).toHaveBeenCalledTimes(2);

        nowSpy.mockRestore();
    });
});