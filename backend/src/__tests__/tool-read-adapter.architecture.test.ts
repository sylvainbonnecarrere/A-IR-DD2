import { readFileSync } from 'fs';
import path from 'path';

describe('ToolReadAdapterService architecture guard', () => {
    it('projects legacy function reads without depending on UserFunction persistence or FunctionService', () => {
        const source = readFileSync(
            path.resolve(__dirname, '../services/toolReadAdapter.service.ts'),
            'utf8'
        );

        expect(source).toContain('UserToolQueryService');
        expect(source).not.toMatch(/UserFunction\.model/);
        expect(source).not.toMatch(/\bUserFunction\b/);
        expect(source).not.toMatch(/from '\.\/function\.service'/);
        expect(source).not.toMatch(/FunctionService/);
    });
});