import { readFileSync } from 'fs';
import path from 'path';

describe('runtime legacy coupling architecture guard', () => {
    it('keeps sandbox and pythonExecutor free from user_tools mirror writes during execution', () => {
        const sandboxSource = readFileSync(
            path.resolve(__dirname, '../services/sandbox.service.ts'),
            'utf8'
        );
        const pythonExecutorSource = readFileSync(
            path.resolve(__dirname, '../pythonExecutor.ts'),
            'utf8'
        );

        expect(sandboxSource).not.toMatch(/syncUserToolMirrorFromLegacyFunction/);
        expect(pythonExecutorSource).not.toMatch(/syncUserToolMirrorFromLegacyFunction/);
    });
});