function escapeForSingleQuotedPython(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildTypescriptWrapper(): string {
    return [
        'const chunks = [];',
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => chunks.push(chunk));",
        "process.stdin.on('end', async () => {",
        "  const payload = JSON.parse(chunks.join(''));",
        '  const context = payload.context ?? {};',
        '  const args = payload.args ?? {};',
        '  const source = String(payload.code ?? "").replace(/\\bexport\\s+(?=(async\\s+)?function\\s+run\\b)/g, "");',
        '  const logs = [];',
        '  const console = {',
        "    log: (...items) => logs.push(items.map(stringify).join(' ')),",
        "    warn: (...items) => logs.push(items.map(stringify).join(' ')),",
        "    error: (...items) => logs.push(items.map(stringify).join(' '))",
        '  };',
        '  function stringify(value) {',
        '    if (typeof value === "string") return value;',
        '    try { return JSON.stringify(value); } catch { return String(value); }',
        '  }',
        '  function classifyError(error) {',
        '    if (error && typeof error === "object" && error.code === "MODULE_NOT_FOUND") return "dependency_missing";',
        '    if (error instanceof SyntaxError) return "user_code_syntax_error";',
        '    return "sandbox_runtime_error";',
        '  }',
        '  let result;',
        '  try {',
        '    const module = { exports: {} };',
        '    const exports = module.exports;',
        '    const runnerFactory = new Function("module", "exports", source + "\\n;return typeof run === \\\"function\\\" ? run : ((module.exports && typeof module.exports.run === \\\"function\\\") ? module.exports.run : ((exports && typeof exports.run === \\\"function\\\") ? exports.run : undefined));");',
        '    const runFn = runnerFactory(module, exports);',
        '    if (typeof runFn !== "function") {',
        '      throw new Error("No run(context, args) function exported by tool source.");',
        '    }',
        '    result = await Promise.resolve(runFn(context, args));',
        "    process.stdout.write(JSON.stringify({ success: true, output: result ?? null, stdout: logs.join('\\n') }));",
        '  } catch (error) {',
        '    const failureKind = classifyError(error);',
        '    process.stdout.write(JSON.stringify({ success: false, output: null, stdout: logs.join("\\n"), stderr: error instanceof Error ? `${error.name}: ${error.message}` : String(error), failureKind, errorType: error instanceof Error ? error.name : "UnknownError" }));',
        '    process.exitCode = 1;',
        '  }',
        '});'
    ].join('\n');
}

export function buildPythonCustomWrapper(): string {
    return [
        'import json',
        'import sys',
        'import traceback',
        'from types import SimpleNamespace',
        'payload = json.loads(sys.stdin.read() or "{}")',
        'context = SimpleNamespace(**(payload.get("context") or {}))',
        'args = payload.get("args") or {}',
        'code = payload.get("code") or ""',
        'namespace = {}',
        'def classify_failure(exc):',
        '    if isinstance(exc, (ModuleNotFoundError, ImportError)):',
        '        return "dependency_missing"',
        '    if isinstance(exc, SyntaxError):',
        '        return "user_code_syntax_error"',
        '    return "sandbox_runtime_error"',
        'try:',
        '    exec(code, namespace)',
        '    result = namespace.get("run")',
        '    output = result(context, args) if callable(result) else namespace.get("__result__")',
        '    print(json.dumps({"success": True, "output": output, "stdout": ""}, ensure_ascii=False))',
        'except Exception as exc:',
        '    print(json.dumps({"success": False, "output": None, "stderr": str(exc), "stdout": "", "traceback": traceback.format_exc(), "failureKind": classify_failure(exc), "errorType": exc.__class__.__name__}, ensure_ascii=False))',
        '    sys.exit(1)'
    ].join('\n');
}

export function buildPythonNativeWrapper(nativeRoot: string): string {
    return [
        'import json',
        'import os',
        'import sys',
        'import traceback',
        `sys.path.insert(0, '${escapeForSingleQuotedPython(nativeRoot)}')`,
        'from runner import FUNCTION_REGISTRY, FunctionContext',
        'payload = json.loads(sys.stdin.read() or "{}")',
        'function_name = payload.get("functionName")',
        'args = payload.get("args") or {}',
        'workspace_dir = os.environ.get("SANDBOX_WORKSPACE_DIR", "/sandbox/workspace")',
        'def classify_failure(exc):',
        '    if isinstance(exc, (ModuleNotFoundError, ImportError)):',
        '        return "dependency_missing"',
        '    if isinstance(exc, SyntaxError):',
        '        return "user_code_syntax_error"',
        '    return "sandbox_runtime_error"',
        'try:',
        '    if function_name not in FUNCTION_REGISTRY:',
        '        raise ValueError(f"Fonction \'{function_name}\' non trouvée dans le registre")',
        '    context = FunctionContext(workspace_dir=workspace_dir, function_name=function_name)',
        '    output = FUNCTION_REGISTRY[function_name](context, args)',
        '    print(json.dumps({"success": True, "output": output, "stdout": ""}, ensure_ascii=False))',
        'except Exception as exc:',
        '    print(json.dumps({"success": False, "output": None, "stderr": str(exc), "stdout": "", "traceback": traceback.format_exc(), "failureKind": classify_failure(exc), "errorType": exc.__class__.__name__}, ensure_ascii=False))',
        '    sys.exit(1)'
    ].join('\n');
}