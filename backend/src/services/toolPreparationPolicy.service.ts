import type { IUserFunction } from '../models/UserFunction.model';
import type { IUserTool } from '../models/UserTool.model';

export type PreparationRequirement = 'none' | 'author_build' | 'platform_provision';
export type PreparationPolicyErrorCode =
    | 'FUNCTION_NOT_FOUND'
    | 'TOOL_NOT_FOUND'
    | 'AUTHOR_BUILD_SCOPE_REQUIRED'
    | 'AUTHOR_BUILD_UNSUPPORTED'
    | 'AUTHOR_BUILD_REQUIRED'
    | 'PLATFORM_PROVISION_REQUIRED';

export interface AuthorBuildPolicyDecision {
    allowed: boolean;
    requirement: PreparationRequirement;
    reason?: string;
    errorCode?: PreparationPolicyErrorCode;
}

export interface ExecutionPreparationPolicyDecision {
    requirement: PreparationRequirement;
    hasDeclaredDependencies: boolean;
    missingPreparationMessage?: string;
    errorCode?: PreparationPolicyErrorCode;
}

interface FunctionPreparationTarget {
    origin: IUserFunction['origin'];
    isReadonly: boolean;
    workflowId?: string | null | IUserFunction['workflowId'];
    dependencies?: {
        npm?: string[];
        python?: string[];
    } | null;
}

interface ToolPreparationTarget {
    scopeType: IUserTool['scopeType'];
    isReadonly: boolean;
    workflowId?: string | null | IUserTool['workflowId'];
    dependencies?: {
        npm?: string[];
        python?: string[];
    } | null;
}

function hasDeclaredDependencies(dependencies?: { npm?: string[]; python?: string[] } | null): boolean {
    return (dependencies?.npm?.length ?? 0) > 0 || (dependencies?.python?.length ?? 0) > 0;
}

export class ToolPreparationPolicyService {
    evaluateFunctionAuthorBuild(fn: Pick<FunctionPreparationTarget, 'origin' | 'isReadonly' | 'workflowId'>): AuthorBuildPolicyDecision {
        if (fn.origin === 'native' || fn.isReadonly) {
            return {
                allowed: false,
                requirement: 'platform_provision',
                reason: 'Native readonly functions cannot be prepared by the author build workflow. They require platform provisioning instead.',
                errorCode: 'AUTHOR_BUILD_UNSUPPORTED'
            };
        }

        if (!fn.workflowId) {
            return {
                allowed: false,
                requirement: 'author_build',
                reason: 'Only workflow-scoped custom functions can be prepared by the author build workflow.',
                errorCode: 'AUTHOR_BUILD_SCOPE_REQUIRED'
            };
        }

        return {
            allowed: true,
            requirement: 'author_build'
        };
    }

    evaluateToolAuthorBuild(tool: Pick<ToolPreparationTarget, 'scopeType' | 'isReadonly' | 'workflowId'>): AuthorBuildPolicyDecision {
        if (tool.scopeType === 'native' || tool.isReadonly) {
            return {
                allowed: false,
                requirement: 'platform_provision',
                reason: 'Native readonly tools cannot be prepared by the author build workflow. They require platform provisioning instead.',
                errorCode: 'AUTHOR_BUILD_UNSUPPORTED'
            };
        }

        if (!tool.workflowId) {
            return {
                allowed: false,
                requirement: 'author_build',
                reason: 'Only workflow-scoped custom tools can be prepared by the author build workflow.',
                errorCode: 'AUTHOR_BUILD_SCOPE_REQUIRED'
            };
        }

        return {
            allowed: true,
            requirement: 'author_build'
        };
    }

    evaluateFunctionExecution(fn: Pick<FunctionPreparationTarget, 'origin' | 'isReadonly' | 'workflowId' | 'dependencies'>): ExecutionPreparationPolicyDecision {
        const dependencyDriven = hasDeclaredDependencies(fn.dependencies);
        if (!dependencyDriven) {
            return {
                requirement: 'none',
                hasDeclaredDependencies: false
            };
        }

        if (fn.origin === 'native' || fn.isReadonly) {
            return {
                requirement: 'platform_provision',
                hasDeclaredDependencies: true,
                missingPreparationMessage: 'This native function declares dependencies and requires platform provisioning before sandbox execution.',
                errorCode: 'PLATFORM_PROVISION_REQUIRED'
            };
        }

        if (fn.workflowId) {
            return {
                requirement: 'author_build',
                hasDeclaredDependencies: true,
                missingPreparationMessage: 'This function declares dependencies and must be prepared via the author build workflow before sandbox execution.',
                errorCode: 'AUTHOR_BUILD_REQUIRED'
            };
        }

        return {
            requirement: 'none',
            hasDeclaredDependencies: true
        };
    }

    evaluateToolExecution(tool: Pick<ToolPreparationTarget, 'scopeType' | 'isReadonly' | 'workflowId' | 'dependencies'>): ExecutionPreparationPolicyDecision {
        const dependencyDriven = hasDeclaredDependencies(tool.dependencies);
        if (!dependencyDriven) {
            return {
                requirement: 'none',
                hasDeclaredDependencies: false
            };
        }

        if (tool.scopeType === 'native' || tool.isReadonly) {
            return {
                requirement: 'platform_provision',
                hasDeclaredDependencies: true,
                missingPreparationMessage: 'This native tool version declares dependencies and requires platform provisioning before sandbox execution.',
                errorCode: 'PLATFORM_PROVISION_REQUIRED'
            };
        }

        if (tool.workflowId) {
            return {
                requirement: 'author_build',
                hasDeclaredDependencies: true,
                missingPreparationMessage: 'This tool version declares dependencies and must be prepared via the author build workflow before sandbox execution.',
                errorCode: 'AUTHOR_BUILD_REQUIRED'
            };
        }

        return {
            requirement: 'none',
            hasDeclaredDependencies: true
        };
    }
}