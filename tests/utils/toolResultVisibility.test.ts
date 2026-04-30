import type { ChatMessage } from '../../types';
import { shouldSuppressVisualToolResult } from '../../utils/toolResultVisibility';

describe('toolResultVisibility', () => {
  it('suppresses redundant visible web_search_py tool_result when a matching tool block exists', () => {
    const messages = [
      {
        id: 'tool-1',
        sender: 'tool',
        text: 'web_search_py({"query":"météo paris"})',
        toolName: 'web_search_py',
        timestamp: new Date('2026-04-30T10:00:00.000Z'),
        toolCallRecord: {
          id: 'call-1',
          functionName: 'web_search_py',
          arguments: { query: 'météo paris' },
          result: { ok: true },
          status: 'success',
          timestamp: new Date('2026-04-30T10:00:00.000Z'),
        },
      },
      {
        id: 'tool-result-1',
        sender: 'tool_result',
        text: 'planned_queries=1',
        toolName: 'web_search_py',
        toolCallId: 'call-1',
        timestamp: new Date('2026-04-30T10:00:00.000Z'),
      },
    ] as ChatMessage[];

    expect(shouldSuppressVisualToolResult(messages[1], messages)).toBe(true);
  });

  it('keeps visible tool_result messages for other tools', () => {
    const messages = [
      {
        id: 'tool-1',
        sender: 'tool',
        text: 'python_exec({"code":"print(1)"})',
        toolName: 'python_exec',
        timestamp: new Date('2026-04-30T10:00:00.000Z'),
        toolCallRecord: {
          id: 'call-2',
          functionName: 'python_exec',
          arguments: { code: 'print(1)' },
          result: { ok: true },
          status: 'success',
          timestamp: new Date('2026-04-30T10:00:00.000Z'),
        },
      },
      {
        id: 'tool-result-2',
        sender: 'tool_result',
        text: '{"stdout":"1"}',
        toolName: 'python_exec',
        toolCallId: 'call-2',
        timestamp: new Date('2026-04-30T10:00:00.000Z'),
      },
    ] as ChatMessage[];

    expect(shouldSuppressVisualToolResult(messages[1], messages)).toBe(false);
  });
});