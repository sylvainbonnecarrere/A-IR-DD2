import { createDefaultHistoryConfig, validateAndRepairHistoryConfig } from '../../utils/historyConfigDefaults';
import { LLMProvider } from '../../types';

describe('historyConfigDefaults', () => {
    it('enables only sentence and message thresholds by default with the requested limits', () => {
        const config = createDefaultHistoryConfig();

        expect(config.enabledLimits).toEqual({
            char: false,
            word: false,
            token: false,
            sentence: true,
            message: true,
        });
        expect(config.limits).toEqual({
            char: 5000,
            word: 1000,
            token: 800,
            sentence: 30,
            message: 6,
        });
    });

    it('repairs legacy history configs that are missing enabled limits', () => {
        const repaired = validateAndRepairHistoryConfig({
            enabled: true,
            llmProvider: LLMProvider.Gemini,
            model: 'gemini-2.5-flash',
            role: 'Archiviste',
            systemPrompt: 'Résumé',
            limits: {
                char: 5000,
                word: 1000,
                token: 800,
                sentence: 30,
                message: 6,
            },
        }, [LLMProvider.Gemini]);

        expect(repaired.enabledLimits).toEqual({
            char: false,
            word: false,
            token: false,
            sentence: true,
            message: true,
        });
    });
});