import { mapPersistedChatMessages, mergePersistedAndRuntimeMessages } from '../../services/persistedChatMessages';
import type { ChatMessage } from '../../types';
import { shouldSuppressVisualToolResult } from '../../utils/toolResultVisibility';

describe('persistedChatMessages', () => {
    it('reclassifies legacy agent chat pairs into tool and tool_result messages when they share an execution id', () => {
        const mapped = mapPersistedChatMessages([
            {
                id: 'legacy-agent-tool-1',
                sender: 'agent',
                text: 'hello_test({"user_name":"Joe"}) [utr-6a1989ce121cd1727a9b6ed8]',
                timestamp: '2026-05-31T17:08:50.000Z',
            },
            {
                id: 'legacy-agent-tool-result-1',
                sender: 'agent',
                text: '[executionId=utr-6a1989ce121cd1727a9b6ed8] {\n  "result": "Ton nom, Joe, est maintenant enregistré dans ma mémoire"\n}',
                timestamp: '2026-05-31T17:08:50.001Z',
            },
        ]);

        expect(mapped[0]).toEqual(expect.objectContaining({
            sender: 'tool',
            toolName: 'hello_test',
            toolCallRecord: expect.objectContaining({
                id: 'legacy-tool-call:utr-6a1989ce121cd1727a9b6ed8',
                functionName: 'hello_test',
                arguments: { user_name: 'Joe' },
                executionId: 'utr-6a1989ce121cd1727a9b6ed8',
                status: 'success',
                result: {
                    result: 'Ton nom, Joe, est maintenant enregistré dans ma mémoire',
                },
            }),
        }));

        expect(mapped[1]).toEqual(expect.objectContaining({
            sender: 'tool_result',
            toolName: 'hello_test',
            toolCallId: 'legacy-tool-call:utr-6a1989ce121cd1727a9b6ed8',
        }));
        expect(shouldSuppressVisualToolResult(mapped[1], mapped)).toBe(true);
    });

    it('reconstructs legacy persisted tool chats into a structured tool block', () => {
        const mapped = mapPersistedChatMessages([
            {
                id: 'legacy-tool-1',
                sender: 'tool',
                text: 'hello_test({"user_name":"Joe"}) [utr-6a1989ce121cd1727a9b6ed8]',
                timestamp: '2026-05-31T17:08:50.000Z',
            },
            {
                id: 'legacy-tool-result-1',
                sender: 'tool_result',
                text: '[executionId=utr-6a1989ce121cd1727a9b6ed8] {\n  "result": "Ton nom, Joe, est maintenant enregistré dans ma mémoire"\n}',
                toolName: 'hello_test',
                timestamp: '2026-05-31T17:08:50.001Z',
            },
        ]);

        expect(mapped[0]).toEqual(expect.objectContaining({
            sender: 'tool',
            toolName: 'hello_test',
            toolCallRecord: expect.objectContaining({
                id: 'legacy-tool-call:utr-6a1989ce121cd1727a9b6ed8',
                functionName: 'hello_test',
                arguments: { user_name: 'Joe' },
                executionId: 'utr-6a1989ce121cd1727a9b6ed8',
                status: 'success',
                result: {
                    result: 'Ton nom, Joe, est maintenant enregistré dans ma mémoire',
                },
                timestamp: expect.any(Date),
            }),
        }));

        expect(mapped[1]).toEqual(expect.objectContaining({
            sender: 'tool_result',
            toolName: 'hello_test',
            toolCallId: 'legacy-tool-call:utr-6a1989ce121cd1727a9b6ed8',
        }));
        expect(shouldSuppressVisualToolResult(mapped[1], mapped)).toBe(true);
    });

    it('deduplicates shimmed agent messages by shared message id even when timestamps differ', () => {
        const runtimeMessage: ChatMessage = {
            id: 'agent-msg-1',
            sender: 'agent',
            text: 'Recherche d\'outil en cours',
            timestamp: new Date('2026-05-07T10:00:00.000Z'),
            toolCalls: [
                {
                    id: 'call-1',
                    name: 'web_search_py',
                    arguments: '{"query":"dedup"}'
                }
            ]
        };

        const persistedMessage: ChatMessage = {
            ...runtimeMessage,
            timestamp: new Date('2026-05-07T10:00:05.000Z')
        };

        const merged = mergePersistedAndRuntimeMessages([persistedMessage], [runtimeMessage]);

        expect(merged).toHaveLength(1);
        expect(merged[0]).toEqual(expect.objectContaining({
            id: 'agent-msg-1',
            sender: 'agent',
            toolCalls: [
                expect.objectContaining({ id: 'call-1', name: 'web_search_py' })
            ]
        }));
    });

    it('deduplicates projected tool blocks by tool call identity when runtime ids differ', () => {
        const persistedToolMessage: ChatMessage = {
            id: 'toolinv:call-weather-1',
            sender: 'tool',
            text: 'weather_tool({"city":"Paris"}) [exec-1]',
            timestamp: new Date('2026-05-07T10:01:05.000Z'),
            toolCallRecord: {
                id: 'call-weather-1',
                functionName: 'weather_tool',
                arguments: { city: 'Paris' },
                result: { temperature: 21 },
                status: 'success',
                executionId: 'exec-1',
                timestamp: new Date('2026-05-07T10:01:05.000Z')
            }
        };

        const runtimeToolMessage: ChatMessage = {
            id: 'pending-tool-local-1',
            sender: 'tool',
            text: 'weather_tool({"city":"Paris"}) [exec-1]',
            timestamp: new Date('2026-05-07T10:01:00.000Z'),
            toolCallRecord: {
                id: 'call-weather-1',
                functionName: 'weather_tool',
                arguments: { city: 'Paris' },
                result: { temperature: 21 },
                status: 'success',
                executionId: 'exec-1',
                timestamp: new Date('2026-05-07T10:01:00.000Z')
            }
        };

        const merged = mergePersistedAndRuntimeMessages([persistedToolMessage], [runtimeToolMessage]);

        expect(merged).toHaveLength(1);
        expect(merged[0]).toEqual(expect.objectContaining({
            id: 'toolinv:call-weather-1',
            sender: 'tool',
            toolCallRecord: expect.objectContaining({
                id: 'call-weather-1',
                executionId: 'exec-1'
            })
        }));
    });
});