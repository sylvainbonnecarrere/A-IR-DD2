import { BuildService } from '../services/build.service';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';
import type { ExecutionFunctionRef } from '../services/runtime/execution.types';

describe('verified inline source selection', () => {
    const resolveSource = (
        orchestrator: ExecutionOrchestrator,
        fn: ExecutionFunctionRef,
    ): Promise<string | undefined> => Reflect.apply(
        Reflect.get(orchestrator, 'resolveSourceCode'),
        orchestrator,
        [fn, 'owner', null, true],
    );

    afterEach(() => jest.restoreAllMocks());

    it('transpiles the snapshotted TypeScript without consulting a mutable build artifact', async () => {
        const getBuildStatus = jest.spyOn(BuildService.prototype, 'getBuildStatus');
        const source = await resolveSource(new ExecutionOrchestrator(), {
            _id: 'tool', name: 'tool', language: 'typescript', origin: 'custom',
            codeInline: 'export const value: number = 42;',
            codePath: 'stale.ts',
        });

        expect(source).toContain('exports.value = 42');
        expect(getBuildStatus).not.toHaveBeenCalled();
    });

    it('uses the snapshotted Python source without consulting a build artifact', async () => {
        const getBuildStatus = jest.spyOn(BuildService.prototype, 'getBuildStatus');
        const source = await resolveSource(new ExecutionOrchestrator(), {
            _id: 'tool', name: 'tool', language: 'python', origin: 'custom',
            codeInline: 'def run():\n    return 42',
        });

        expect(source).toBe('def run():\n    return 42');
        expect(getBuildStatus).not.toHaveBeenCalled();
    });

    it.each([
        { _id: 'tool', name: 'tool', language: 'python' as const, origin: 'native' as const, codeInline: 'return 1' },
        { _id: 'tool', name: 'tool', language: 'typescript' as const, origin: 'custom' as const, codePath: 'tool.ts' },
    ])('rejects sources that cannot be executed from the verified snapshot', async (fn) => {
        await expect(resolveSource(new ExecutionOrchestrator(), fn))
            .rejects.toThrow('Verified inline execution requires a custom tool with inline source');
    });
});
