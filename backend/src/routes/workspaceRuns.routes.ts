import { logger } from '../services/logger';
import { Router, type Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.middleware';

import { IUser } from '../models/User.model';

import { FenceAndRetryError, FenceAndRetryService } from '../services/fenceAndRetry.service';

import { MongoDockerGatewayAdmission } from '../services/runtime/MongoDockerGatewayAdmission';

import { DockerGatewayControlClient } from '../services/runtime/DockerGatewayControlClient';

import { MongoRunVisibilityService } from '../services/runtime/runVisibility.service';

const objectIdParamSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID doit être un ObjectId MongoDB valide');

const fenceAndRetryParamsSchema = z.object({
  workspaceId: objectIdParamSchema,
  runId: z.string().trim().min(1, 'runId est requis'),
});

function readIdempotencyKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sendFenceAndRetryError(res: Response, error: unknown) {
  if (error instanceof FenceAndRetryError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error && 'code' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    const code = String((error as { code?: unknown }).code);
    if (statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : 'Fence-and-retry refusé',
        code,
      });
    }
  }
  logger.error('[WorkspaceRunsRoute] fence-and-retry failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  return res.status(500).json({ error: 'Erreur lors du fence-and-retry', code: 'FENCE_AND_RETRY_FAILED' });
}

/**
 * Routeur des commandes de runs d'un workspace (US-J7-07) :
 * `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry`.
 * Le service est injecté pour rester testable ; le routeur par défaut est
 * fail-closed si aucun socket gateway n'est configuré (pas de preuve = 504).
 */
export function createWorkspaceRunsRouter(service: FenceAndRetryService): Router {
  const router = Router();

  router.post('/:workspaceId/runs/:runId/fence-and-retry', requireAuth, async (req, res) => {
    const paramsResult = fenceAndRetryParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({
        error: 'Paramètres invalides',
        code: 'INVALID_PARAMS',
        details: paramsResult.error.issues,
      });
    }

    const idempotencyKey = readIdempotencyKey(req.header('Idempotency-Key'));
    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'Idempotency-Key est requis pour fence-and-retry',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      });
    }

    try {
      const user = req.user as IUser;
      const result = await service.fenceAndRetry({
        userId: user.id,
        workspaceId: paramsResult.data.workspaceId,
        runId: paramsResult.data.runId,
        idempotencyKey,
      });
      return res.status(result.replayed ? 200 : 202).json({
        ...result.response,
        idempotency: { key: idempotencyKey, replayed: result.replayed },
      });
    } catch (error) {
      return sendFenceAndRetryError(res, error);
    }
  });

  return router;
}

/**
 * Service fail-closed de production : sans socket gateway configuré, aucune
 * preuve de quiescence n'est disponible et la réponse reste 504.
 */
class UnavailableFenceControlClient {
  async fenceOperation(): Promise<never> {
    throw new Error('Docker gateway control plane is not configured');
  }

  async verifyFenced(): Promise<never> {
    throw new Error('Docker gateway control plane is not configured');
  }
}

function createProductionFenceAndRetryService(): FenceAndRetryService {
  const gatewaySocket = process.env.DOCKER_GATEWAY_SOCKET?.trim();
  const control = gatewaySocket ? new DockerGatewayControlClient({ socketPath: gatewaySocket }) : new UnavailableFenceControlClient();
  // ⭐ J7-09: visibilité (journal agent + événements runtime) sur le flux fence-and-retry.
  return new FenceAndRetryService(
    control,
    new MongoDockerGatewayAdmission(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new MongoRunVisibilityService(),
  );
}

export default createWorkspaceRunsRouter(createProductionFenceAndRetryService());
