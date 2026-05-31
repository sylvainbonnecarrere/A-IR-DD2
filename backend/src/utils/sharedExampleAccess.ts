import mongoose from 'mongoose';

const SHARED_CUSTOM_FUNCTION_NAMES = ['hello_test'] as const;

const SHARED_CUSTOM_FUNCTION_NAME_LIST = [...SHARED_CUSTOM_FUNCTION_NAMES];

export function isSharedCustomFunctionName(name: string | null | undefined): boolean {
    return typeof name === 'string' && SHARED_CUSTOM_FUNCTION_NAME_LIST.includes(name as typeof SHARED_CUSTOM_FUNCTION_NAMES[number]);
}

export function buildGlobalLegacyFunctionClauses(): Array<Record<string, unknown>> {
    return [
        { userId: null, origin: 'native' },
        { userId: null, origin: 'custom', isReadonly: true, name: { $in: SHARED_CUSTOM_FUNCTION_NAME_LIST } }
    ];
}

export function buildOwnedLegacyFunctionClause(userId: string | mongoose.Types.ObjectId): Record<string, unknown> {
    return {
        userId: userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId)
    };
}

export function buildGlobalToolClauses(): Array<Record<string, unknown>> {
    return [
        { ownerUserId: null, scopeType: 'native' },
        { ownerUserId: null, scopeType: 'user', isReadonly: true, name: { $in: SHARED_CUSTOM_FUNCTION_NAME_LIST } }
    ];
}

export function buildOwnedToolClause(ownerUserId: string | mongoose.Types.ObjectId): Record<string, unknown> {
    return {
        ownerUserId: ownerUserId instanceof mongoose.Types.ObjectId ? ownerUserId : new mongoose.Types.ObjectId(ownerUserId),
        scopeType: 'user'
    };
}