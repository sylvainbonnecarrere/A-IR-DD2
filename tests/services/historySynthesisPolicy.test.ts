import { computeHistoryLimitStats, getTriggeredHistoryLimits, shouldTriggerHistorySynthesis } from '../../services/historySynthesisPolicy';
import { HistoryConfig, LLMProvider } from '../../types';

const baseHistoryConfig: HistoryConfig = {
    enabled: true,
    llmProvider: LLMProvider.Gemini,
    model: 'gemini-2.0-flash',
    role: 'Archiviste Concis',
    systemPrompt: 'Summarize',
    limits: {
        char: 5,
        word: 10,
        token: 10,
        sentence: 10,
        message: 10,
    },
    enabledLimits: {
        char: true,
        word: true,
        token: true,
        sentence: true,
        message: true,
    },
};

describe('historySynthesisPolicy', () => {
    it.each([
        {
            limitKey: 'char',
            messages: [{ id: 'm-1', sender: 'user' as const, text: 'abcdef', timestamp: new Date('2026-05-07T12:00:00.000Z') }],
        },
        {
            limitKey: 'word',
            messages: [{ id: 'm-1', sender: 'user' as const, text: 'un deux trois quatre cinq six sept huit neuf dix', timestamp: new Date('2026-05-07T12:00:00.000Z') }],
        },
        {
            limitKey: 'token',
            messages: [{ id: 'm-1', sender: 'user' as const, text: 'abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwx', timestamp: new Date('2026-05-07T12:00:00.000Z') }],
        },
        {
            limitKey: 'sentence',
            messages: [{ id: 'm-1', sender: 'user' as const, text: 'Un. Deux. Trois. Quatre. Cinq. Six. Sept. Huit. Neuf. Dix.', timestamp: new Date('2026-05-07T12:00:00.000Z') }],
        },
        {
            limitKey: 'message',
            messages: Array.from({ length: 10 }, (_, index) => ({
                id: `m-${index + 1}`,
                sender: 'user' as const,
                text: `message ${index + 1}`,
                timestamp: new Date('2026-05-07T12:00:00.000Z'),
            })),
        },
    ])('triggers the $limitKey threshold when it is enabled', ({ limitKey, messages }) => {
        const stats = computeHistoryLimitStats(messages);

        expect(getTriggeredHistoryLimits(baseHistoryConfig, stats)).toContain(limitKey);
        expect(shouldTriggerHistorySynthesis(baseHistoryConfig, stats)).toBe(true);
    });

    it('counts char threshold as a first-class trigger', () => {
        const stats = computeHistoryLimitStats([
            {
                id: 'm-1',
                sender: 'user' as const,
                text: 'abcdef',
                timestamp: new Date('2026-05-07T12:00:00.000Z'),
            },
        ]);

        expect(stats.char).toBe(6);
        expect(getTriggeredHistoryLimits(baseHistoryConfig, stats)).toEqual(['char']);
        expect(shouldTriggerHistorySynthesis(baseHistoryConfig, stats)).toBe(true);
    });

    it('ignores disabled thresholds even when the raw value exceeds the limit', () => {
        const stats = computeHistoryLimitStats([
            {
                id: 'm-1',
                sender: 'user' as const,
                text: 'abcdef',
                timestamp: new Date('2026-05-07T12:00:00.000Z'),
            },
        ]);

        const config: HistoryConfig = {
            ...baseHistoryConfig,
            enabledLimits: {
                ...baseHistoryConfig.enabledLimits,
                char: false,
            },
        };

        expect(getTriggeredHistoryLimits(config, stats)).toEqual([]);
        expect(shouldTriggerHistorySynthesis(config, stats)).toBe(false);
    });

    it('does not trigger on zero-or-negative limits', () => {
        const stats = computeHistoryLimitStats([
            {
                id: 'm-1',
                sender: 'user' as const,
                text: 'a b c d e f g h i j',
                timestamp: new Date('2026-05-07T12:00:00.000Z'),
            },
        ]);

        const config: HistoryConfig = {
            ...baseHistoryConfig,
            limits: {
                ...baseHistoryConfig.limits,
                word: 0,
            },
        };

        expect(getTriggeredHistoryLimits(config, stats)).toEqual(['char']);
    });
});