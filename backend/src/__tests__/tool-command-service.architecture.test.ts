import { readFileSync } from 'fs';
import path from 'path';

describe('ToolCommandService architecture guard', () => {
    it('keeps canonical /api/tools commands independent from legacy FunctionService and UserFunction persistence', () => {
        const source = readFileSync(
            path.resolve(__dirname, '../services/toolCommand.service.ts'),
            'utf8'
        );

        expect(source).toContain('UserTool');
        expect(source).not.toMatch(/from '\.\/function\.service'/);
        expect(source).not.toMatch(/FunctionService/);
        expect(source).not.toMatch(/UserFunction\.model/);
        expect(source).not.toMatch(/syncUserToolMirrorFromLegacyFunction/);
    });
});