/**
 * Types — Fonctions Personnalisées (Tools V2) côté Frontend
 *
 * Miroir des types backend IUserFunction.
 * Source de vérité côté frontend — utilisée par le store, les composants et les services.
 */

export type FunctionLanguage = 'python' | 'typescript';
export type FunctionOrigin = 'native' | 'custom';

export interface UserFunction {
    _id: string;
    name: string;
    description: string;
    language: FunctionLanguage;
    origin: FunctionOrigin;
    userId: string | null;
    workflowId: string | null;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    codePath: string | null;
    codeInline: string | null;
    dependencies: string[];
    isEnabled: boolean;
    isReadonly: boolean;
    version: number;
    tags: string[];
    createdAt: string;
    updatedAt: string;
}

export interface CreateFunctionPayload {
    name: string;
    description: string;
    language: FunctionLanguage;
    workflowId?: string | null;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    codeInline?: string | null;
    dependencies?: string[];
    tags?: string[];
}

export interface UpdateFunctionPayload extends Partial<Omit<CreateFunctionPayload, 'name'>> {}

export interface SandboxRunResult {
    success: boolean;
    output: unknown;
    stdout?: string;
    stderr?: string;
    durationMs: number;
    timedOut?: boolean;
}

export interface SyntaxCheckResult {
    valid: boolean;
    errors: Array<{ line?: number; message: string }>;
}

export type FunctionFilter = {
    origin?: FunctionOrigin | 'all';
    language?: FunctionLanguage | 'all';
    isEnabled?: boolean | 'all';
    search?: string;
};
