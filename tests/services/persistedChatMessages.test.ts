import { mergePersistedAndRuntimeMessages } from '../../services/persistedChatMessages';
import type { ChatMessage } from '../../types';

describe('persistedChatMessages', () => {
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