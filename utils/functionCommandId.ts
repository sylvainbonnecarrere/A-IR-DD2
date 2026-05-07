import type { UserFunction } from '../types/function.types';

type FunctionCommandIdentity = Pick<UserFunction, '_id' | 'toolId'>;

export const getFunctionCommandId = (fn: FunctionCommandIdentity): string => fn.toolId ?? fn._id;

export const matchesFunctionIdentity = (fn: FunctionCommandIdentity, id: string): boolean => (
    fn._id === id || fn.toolId === id
);

export const resolveFunctionCommandId = (id: string, functions: FunctionCommandIdentity[]): string => {
    const match = functions.find((fn) => matchesFunctionIdentity(fn, id));
    return match ? getFunctionCommandId(match) : id;
};