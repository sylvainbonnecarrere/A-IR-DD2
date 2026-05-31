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

describe('user_functions reliquat architecture guard', () => {
    it('keeps UserFunction persistence confined to the approved legacy boundary', () => {
        const sourceRoot = path.resolve(__dirname, '../');
        const sourceFiles = collectSourceFiles(sourceRoot);
        const userFunctionModelPath = path.resolve(__dirname, '../models/UserFunction.model.ts');
        const databaseInitPath = path.resolve(__dirname, '../services/databaseInit.ts');

        const userFunctionModelImporters = sourceFiles.filter((filePath) => {
            const source = readFileSync(filePath, 'utf8');
            return source.includes('UserFunction.model');
        }).sort();

        const userFunctionIndexImporters = sourceFiles.filter((filePath) => {
            const source = readFileSync(filePath, 'utf8');
            const importsModelsIndex = /(^|\n)import\s+[^;]*from ['"]\.\.\/models['"]/.test(source)
                || /(^|\n)import\s+[^;]*from ['"]\.\.\/\.\.\/models['"]/.test(source);

            return importsModelsIndex && (source.includes('UserFunction') || source.includes('IUserFunction'));
        }).sort();

        const rawUserFunctionsPersistenceUsers = sourceFiles.filter((filePath) => {
            const source = readFileSync(filePath, 'utf8');
            return source.includes("collection('user_functions')")
                || source.includes('collection("user_functions")')
                || source.includes("collection: 'user_functions'")
                || source.includes('collection: "user_functions"');
        }).sort();

        expect(existsSync(userFunctionModelPath)).toBe(false);

        expect(userFunctionModelImporters).toEqual([]);

        expect(userFunctionIndexImporters).toEqual([]);

        expect(rawUserFunctionsPersistenceUsers).toEqual([
            path.resolve(__dirname, '../migrations/005_user_functions_eol.ts'),
        ].sort());

        const databaseInitSource = readFileSync(databaseInitPath, 'utf8');
        expect(databaseInitSource).not.toContain('user_functions: {');
        expect(databaseInitSource).not.toContain('user_functions: [');
        expect(databaseInitSource).not.toContain("collection('user_functions')");
        expect(databaseInitSource).not.toContain('collection("user_functions")');
    });
});