import type { RuntimeCompatibilityContext } from './runtimeCompatibility.service';
import { ToolPreparationPolicyService } from './toolPreparationPolicy.service';

export type ToolReadinessRequirement = 'none' | 'author_build' | 'platform_provision';
export type ToolReadinessState = 'ready' | 'not_ready' | 'waiting_for_provisioning' | 'waiting_for_build';

export interface ToolReadinessStatus {
    requirement: ToolReadinessRequirement;
    state: ToolReadinessState;
    prepared: boolean;
    runnable: boolean;
    dependencyReadiness: 'satisfied' | 'missing' | 'not_required';
    runtimeReady: boolean;
    summary: string;
    actionLabel: string;
}

interface ToolReadinessTarget {
    scopeType: 'native' | 'user';
    isReadonly: boolean;
    workflowId?: string | null;
    dependencies?: { npm?: string[]; python?: string[] } | null;
    currentVersion: {
        buildStatus: 'not_built' | 'building' | 'built' | 'failed';
    };
}

export class ToolReadinessService {
    private readonly preparationPolicy = new ToolPreparationPolicyService();

    evaluateToolReadiness(tool: ToolReadinessTarget, runtimeCompatibility: RuntimeCompatibilityContext): ToolReadinessStatus {
        const policy = this.preparationPolicy.evaluateToolExecution(tool);
        const runtimeReady = runtimeCompatibility.executionReady;

        const applyRuntimeState = (status: Omit<ToolReadinessStatus, 'runtimeReady' | 'runnable' | 'state' | 'summary' | 'actionLabel'> & {
            prepared: boolean;
            stateWhenRuntimeReady: ToolReadinessState;
            summaryWhenRuntimeReady: string;
            actionWhenRuntimeReady: string;
        }): ToolReadinessStatus => {
            const runnable = status.prepared && runtimeReady;
            if (!runtimeReady) {
                return {
                    requirement: status.requirement,
                    state: 'not_ready',
                    prepared: status.prepared,
                    runnable,
                    dependencyReadiness: status.dependencyReadiness,
                    runtimeReady,
                    summary: `Runtime indisponible: ${runtimeCompatibility.summary}`,
                    actionLabel: 'Attendre le runtime'
                };
            }

            return {
                requirement: status.requirement,
                state: status.stateWhenRuntimeReady,
                prepared: status.prepared,
                runnable,
                dependencyReadiness: status.dependencyReadiness,
                runtimeReady,
                summary: status.summaryWhenRuntimeReady,
                actionLabel: status.actionWhenRuntimeReady
            };
        };

        if (policy.requirement === 'none') {
            return applyRuntimeState({
                requirement: 'none',
                prepared: true,
                dependencyReadiness: 'not_required',
                stateWhenRuntimeReady: 'ready',
                summaryWhenRuntimeReady: 'Aucune preparation supplementaire requise avant execution.',
                actionWhenRuntimeReady: 'Executable immediatement'
            });
        }

        const prepared = tool.currentVersion.buildStatus === 'built';

        if (policy.requirement === 'platform_provision') {
            return applyRuntimeState({
                requirement: 'platform_provision',
                prepared,
                dependencyReadiness: prepared ? 'satisfied' : 'missing',
                stateWhenRuntimeReady: prepared ? 'ready' : 'waiting_for_provisioning',
                summaryWhenRuntimeReady: prepared
                    ? 'Provisionnement plateforme confirme pour cette fonction native.'
                    : 'Provisionnement plateforme requis avant execution de cette fonction native.',
                actionWhenRuntimeReady: prepared ? 'Executable' : 'Provisionnement plateforme requis'
            });
        }

        return applyRuntimeState({
            requirement: 'author_build',
            prepared,
            dependencyReadiness: prepared ? 'satisfied' : 'missing',
            stateWhenRuntimeReady: prepared ? 'ready' : 'waiting_for_build',
            summaryWhenRuntimeReady: prepared
                ? 'Build auteur valide pour cette version.'
                : 'Build auteur requis avant execution de cette version.',
            actionWhenRuntimeReady: prepared ? 'Executable' : 'Executer le build auteur'
        });
    }
}