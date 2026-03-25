import { Request, Response, NextFunction } from 'express';
import {
    evaluateRobotGovernance,
    getRequestedRobotId,
    GovernedObjectType,
    GovernedOperation
} from '../services/robotGovernancePolicy.service';

interface RequireRobotGovernanceOptions {
    governedType: GovernedObjectType;
    operation: GovernedOperation;
    resolveTargetRobotId: (req: Request) => Promise<string | null | undefined> | string | null | undefined;
    resolveActorRobotId?: (req: Request) => Promise<string | null | undefined> | string | null | undefined;
}

export const requireRobotGovernance = (options: RequireRobotGovernanceOptions) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const actorRobotId = options.resolveActorRobotId
                ? await options.resolveActorRobotId(req)
                : getRequestedRobotId(req);
            const targetRobotId = await options.resolveTargetRobotId(req);

            const decision = evaluateRobotGovernance({
                governedType: options.governedType,
                operation: options.operation,
                actorRobotId,
                targetRobotId
            });

            if (!decision.allowed) {
                return res.status(decision.status).json({
                    error: decision.error,
                    code: decision.code,
                    details: decision.details
                });
            }

            next();
        } catch (error) {
            console.error('[RobotGovernance] Middleware error:', error);
            return res.status(500).json({ error: 'Erreur vérification gouvernance robot' });
        }
    };
};