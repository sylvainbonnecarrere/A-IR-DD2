import { readFileSync } from 'fs';
import path from 'path';

describe('userTool run services architecture guard', () => {
    it('keeps run query and retention services independent from legacy FunctionService', () => {
        const querySource = readFileSync(
            path.resolve(__dirname, '../services/userToolRunQuery.service.ts'),
            'utf8'
        );
        const retentionSource = readFileSync(
            path.resolve(__dirname, '../services/userToolRunRetention.service.ts'),
            'utf8'
        );

        expect(querySource).not.toMatch(/from '\.\/function\.service'/);
        expect(querySource).not.toMatch(/FunctionService/);
        expect(retentionSource).not.toMatch(/from '\.\/function\.service'/);
        expect(retentionSource).not.toMatch(/FunctionService/);
    });
});