import { Request } from 'express';
import { CANONICAL_ROBOT_IDS, CanonicalRobotId } from '../types/robotIds';

export type GovernedObjectType = 'agent' | 'connection' | 'file' | 'event';
export type GovernedOperation = 'create' | 'modify' | 'delete';

type GovernanceDecisionCode = 'INVALID_ROBOT_CONTEXT' | 'ROBOT_POLICY_DENIED';

interface GovernancePolicyMap {
    [key: string]: CanonicalRobotId;
}

const GOVERNED_OBJECT_POLICY: GovernancePolicyMap = {
    agent: 'AR_001',
    connection: 'CO_003',
    file: 'PH_004',
    event: 'TI_005'
};

export interface RobotGovernanceDecision {
    allowed: boolean;
    status: 400 | 403;
    code?: GovernanceDecisionCode;
    error?: string;
    details?: {
        governedType: GovernedObjectType;
        operation: GovernedOperation;
        requiredRobotId: CanonicalRobotId;
        actorRobotId?: string;
        targetRobotId?: string;
    };
}

interface EvaluateRobotGovernanceInput {
    governedType: GovernedObjectType;
    operation: GovernedOperation;
    actorRobotId?: string | null;
    targetRobotId?: string | null;
}

const isCanonicalRobotId = (robotId: string): robotId is CanonicalRobotId => {
    return CANONICAL_ROBOT_IDS.includes(robotId as CanonicalRobotId);
};

const buildDeniedDecision = (
    status: 400 | 403,
    code: GovernanceDecisionCode,
    error: string,
    input: EvaluateRobotGovernanceInput,
    requiredRobotId: CanonicalRobotId
): RobotGovernanceDecision => ({
    allowed: false,
    status,
    code,
    error,
    details: {
        governedType: input.governedType,
        operation: input.operation,
        requiredRobotId,
        actorRobotId: input.actorRobotId ?? undefined,
        targetRobotId: input.targetRobotId ?? undefined
    }
});

export const getRequestedRobotId = (req: Request): string | undefined => {
    const headerValue = req.get('x-robot-id');
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim();
    }

    if (typeof req.body?.robotId === 'string' && req.body.robotId.trim()) {
        return req.body.robotId.trim();
    }

    return undefined;
};

export const evaluateRobotGovernance = (
    input: EvaluateRobotGovernanceInput
): RobotGovernanceDecision => {
    const requiredRobotId = GOVERNED_OBJECT_POLICY[input.governedType];

    if (!requiredRobotId) {
        return {
            allowed: true,
            status: 400
        };
    }

    if (!input.targetRobotId) {
        return buildDeniedDecision(
            400,
            'INVALID_ROBOT_CONTEXT',
            'Contexte de gouvernance incomplet: robotId cible introuvable.',
            input,
            requiredRobotId
        );
    }

    if (!isCanonicalRobotId(input.targetRobotId)) {
        return buildDeniedDecision(
            403,
            'ROBOT_POLICY_DENIED',
            `Gouvernance refusée: l'objet gouverné porte un robotId incohérent (${input.targetRobotId}).`,
            input,
            requiredRobotId
        );
    }

    if (input.targetRobotId !== requiredRobotId) {
        return buildDeniedDecision(
            403,
            'ROBOT_POLICY_DENIED',
            `Gouvernance refusée: seul ${requiredRobotId} peut ${input.operation} un objet de type ${input.governedType}.`,
            input,
            requiredRobotId
        );
    }

    if (input.actorRobotId) {
        if (!isCanonicalRobotId(input.actorRobotId)) {
            return buildDeniedDecision(
                400,
                'INVALID_ROBOT_CONTEXT',
                `Contexte robot invalide: ${input.actorRobotId}.`,
                input,
                requiredRobotId
            );
        }

        if (input.actorRobotId !== requiredRobotId) {
            return buildDeniedDecision(
                403,
                'ROBOT_POLICY_DENIED',
                `Gouvernance refusée: le robot acteur ${input.actorRobotId} ne peut pas ${input.operation} un objet de type ${input.governedType}.`,
                input,
                requiredRobotId
            );
        }

        if (input.actorRobotId !== input.targetRobotId) {
            return buildDeniedDecision(
                403,
                'ROBOT_POLICY_DENIED',
                'Gouvernance refusée: le robot acteur ne correspond pas au robot gouvernant de l’objet.',
                input,
                requiredRobotId
            );
        }
    }

    return {
        allowed: true,
        status: 400
    };
};