import vm from 'vm';
import { buildPythonCustomWrapper, buildTypescriptWrapper } from '../services/runtime/runtimeWrappers';

describe('runtimeWrappers', () => {
    it('produces a syntactically valid TypeScript wrapper for node --eval', () => {
        expect(() => new vm.Script(buildTypescriptWrapper())).not.toThrow();
    });

    it('passes context and args to custom runtimes', () => {
        const typescriptWrapper = buildTypescriptWrapper();
        const pythonWrapper = buildPythonCustomWrapper();

        expect(typescriptWrapper).toContain('const context = payload.context ?? {};');
        expect(typescriptWrapper).toContain('result = await Promise.resolve(runFn(context, args));');
        expect(pythonWrapper).toContain('context = SimpleNamespace(**(payload.get("context") or {}))');
        expect(pythonWrapper).toContain('output = result(context, args) if callable(result) else namespace.get("__result__")');
    });
});