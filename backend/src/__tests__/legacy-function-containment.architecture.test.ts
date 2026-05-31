import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

function collectSourceFiles(rootDir: string): string[] {
    return readdirSync(rootDir).flatMap((entry) => {
        const entryPath = path.join(rootDir, entry);
        const stats = statSync(entryPath);

        if (stats.isDirectory()) {
            if (entry === '__tests__') {
                return [];
            }

            return collectSourceFiles(entryPath);
        }

        return entryPath.endsWith('.ts') ? [entryPath] : [];
    });
}

describe('legacy function containment architecture guard', () => {
    it('removes function.service.ts from production and keeps userToolMirror imports fully absent from production', () => {
        const servicesRoot = path.resolve(__dirname, '../');
        const sourceFiles = collectSourceFiles(servicesRoot);
        const functionServicePath = path.resolve(__dirname, '../services/function.service.ts');
        const userToolMirrorPath = path.resolve(__dirname, '../services/userToolMirror.service.ts');

        const functionServiceImporters = sourceFiles.filter((filePath) => {
            if (filePath === functionServicePath) {
                return false;
            }

            const source = readFileSync(filePath, 'utf8');
            return source.includes("./function.service") || source.includes("../services/function.service");
        });

        const userToolMirrorImporters = sourceFiles.filter((filePath) => {
            if (filePath === userToolMirrorPath) {
                return false;
            }

            const source = readFileSync(filePath, 'utf8');
            return source.includes("./userToolMirror.service") || source.includes("../services/userToolMirror.service");
        });

        expect(existsSync(functionServicePath)).toBe(false);
        expect(functionServiceImporters).toEqual([]);
        expect(userToolMirrorImporters).toEqual([]);
    });
});