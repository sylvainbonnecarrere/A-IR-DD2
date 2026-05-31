import { parseToolCalls } from '../../services/llm/ToolCallParser';

describe('ToolCallParser protocol hardening', () => {
    it('parses a strict hello_test tool call emitted by a local model', () => {
        const result = parseToolCalls('<tool_call>{"name":"hello_test","arguments":{"name":"Sylvain"}}</tool_call>');

        expect(result.parseStatus).toBe('tool_call');
        expect(result.trace.strategy).toBe('xml');
        expect(result.toolCalls).toEqual([
            expect.objectContaining({
                name: 'hello_test',
                arguments: { name: 'Sylvain' },
            }),
        ]);
    });

    it('parses a strict final answer block when no tool is needed', () => {
        const result = parseToolCalls('<final_answer>Bonjour Sylvain</final_answer>');

        expect(result.parseStatus).toBe('text');
        expect(result.trace.strategy).toBe('final_answer_tag');
        expect(result.textBefore).toBe('Bonjour Sylvain');
    });

    it('classifies a malformed tool block as invalid_tool_call', () => {
        const result = parseToolCalls('<tool_call>{"name":"web_search_py","arguments":</tool_call>');

        expect(result.parseStatus).toBe('invalid_tool_call');
        expect(result.trace.message).toContain('Malformed <tool_call> block');
    });
});