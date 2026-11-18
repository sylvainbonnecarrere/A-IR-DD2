import { executionTargetFingerprint } from '../services/runtime/executionTargetFingerprint';
import type { ExecutionFunctionRef } from '../services/runtime/execution.types';

describe('execution target fingerprint', () => {
    const target: ExecutionFunctionRef = {
        _id: '507f1f77bcf86cd799439011',
        name: 'fixture',
        language: 'typescript',
        origin: 'custom',
        codeInline: 'export default () => 1',
        dependencies: { npm: ['package@1.0.0'], python: [] },
        toolVersionTag: 'v1',
        toolContentHash: 'hash',
        policySnapshot: {
            networkMode: 'none',
            writablePaths: ['b', 'a'],
            secretAliases: ['s2', 's1'],
        },
    };

    it('is stable when source materialization or policy ordering changes', () => {
        expect(executionTargetFingerprint({
            ...target,
            codePath: 'tools/materialized.ts',
            policySnapshot: { networkMode: 'none', writablePaths: ['a', 'b'], secretAliases: ['s1', 's2'] },
        })).toBe(executionTargetFingerprint(target));
    });

    it.each([
        ['code', { codeInline: 'export default () => 2' }],
        ['dependency', { dependencies: { npm: ['package@2.0.0'], python: [] } }],
        ['origin', { origin: 'native' as const }],
        ['policy', { policySnapshot: { networkMode: 'restricted' as const } }],
    ])('changes when %s changes despite an unchanged stored hash', (_label, change) => {
        expect(executionTargetFingerprint({ ...target, ...change })).not.toBe(executionTargetFingerprint(target));
    });

    it('records a path when no inline source exists', () => {
        const byPath = { ...target, codeInline: null, codePath: 'a.py' };
        expect(executionTargetFingerprint({ ...byPath, codePath: 'b.py' }))
            .not.toBe(executionTargetFingerprint(byPath));
    });
});
