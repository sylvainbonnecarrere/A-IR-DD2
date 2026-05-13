import { readFileSync } from 'fs';
import path from 'path';

describe('userToolStartupSync architecture guard', () => {
    it('keeps startup sync in repair-only projection mode and forbids legacy-authority bootstrap writes', () => {
        const source = readFileSync(
            path.resolve(__dirname, '../services/userToolStartupSync.service.ts'),
            'utf8'
        );

        expect(source).toContain("export type UserToolStartupSyncPhase = 'repair-only'");
        expect(source).not.toMatch(/legacy-authority/);
        expect(source).not.toMatch(/LegacyAuthorityStartupSyncPolicy/);
    });
});