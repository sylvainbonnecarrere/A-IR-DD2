import { Router } from 'express';
import { z } from 'zod';
import { UserToolRunStatusSchema } from '../domain/execution/userToolRun.contract';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { IUser } from '../models/User.model';
import { RECONSTRUCTION_REJECTION_CODES } from '../domain/execution/runReconstructionQuarantine';
import { RuntimeCompatibilityService } from '../services/runtimeCompatibility.service';
import { BuildPreparationError } from '../services/build.service';
import { RuntimeNotReadyError } from '../services/runtime/errors';
import { SandboxService, SandboxServiceError } from '../services/sandbox.service';
import { IdempotencyKeyReuseError } from '../services/runtime/ExecutionOrchestrator';
import { UserToolRunQueryService } from '../services/userToolRunQuery.service';
import { UserToolRunRetentionService } from '../services/userToolRunRetention.service';
import { UserToolRunService } from '../services/userToolRun.service';
import { UserToolRunStateError } from '../services/userToolRun.service';

const router = Router();
const runtimeCompatibilityService = new RuntimeCompatibilityService();
const sandboxService = new SandboxService();
const userToolRunQueryService = new UserToolRunQueryService();
const userToolRunRetentionService = new UserToolRunRetentionService();
const userToolRunService = new UserToolRunService();

const idParamSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID doit être un ObjectId MongoDB valide');
const artifactQuerySchema = z.object({
  path: z.string().min(1, "Le chemin d'artefact est requis"),
});
const cleanupRunsSchema = z
  .object({
    retentionDays: z.number().int().min(1).max(365).optional(),
    retainLatest: z.number().int().min(0).max(200).optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .refine((value) => value.retentionDays !== undefined || value.retainLatest !== undefined, {
    message: 'retentionDays ou retainLatest est requis',
  });

const listRunsQuerySchema = z.object({
  workflowId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  toolId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  agentInstanceId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  page: z.coerce.number().int().min(1).optional().default(1),
  status: UserToolRunStatusSchema.optional(),
  sortBy: z.enum(['createdAt', 'durationMs', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

const toolSelectionSchema = z.object({
  toolId: z.string().regex(/^[a-f\d]{24}$/i, 'toolId doit être un ObjectId MongoDB valide'),
  versionRef: z
    .object({
      versionTag: z.string().optional(),
      versionNumber: z.number().optional(),
      workspaceId: z.string().nullable().optional(),
    })
    .optional(),
});

const executeRunSchema = z
  .object({
    functionId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, 'functionId doit être un ObjectId MongoDB valide')
      .optional(),
    agentInstanceId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, 'agentInstanceId doit être un ObjectId MongoDB valide')
      .optional(),
    toolSelection: toolSelectionSchema.optional(),
    testArgs: z.record(z.string(), z.unknown()).optional().default({}),
    privateContext: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.functionId && !value.toolSelection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'functionId ou toolSelection est requis',
        path: ['functionId'],
      });
    }
  });
const resolveQuarantineSchema = z.object({
  expectedCode: z.enum(RECONSTRUCTION_REJECTION_CODES),
});

function readIdempotencyKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sendRunCommandError(res: import('express').Response, error: unknown) {
  if (error instanceof IdempotencyKeyReuseError) {
    return res.status(409).json({ error: error.message, code: error.code });
  }
  if (error instanceof RuntimeNotReadyError) {
    return res.status(503).json({ error: error.message, code: 'RUNTIME_NOT_READY' });
  }
  if (error instanceof SandboxServiceError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  if (error instanceof BuildPreparationError) {
    return res.status(422).json({ error: error.message, code: error.code });
  }
  if (error instanceof UserToolRunStateError) {
    return res.status(409).json({ error: error.message, code: 'RUN_STATE_CONFLICT' });
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error && 'code' in error) {
    const statusCode = Number((error as { statusCode: unknown }).statusCode);
    const code = String((error as { code: unknown }).code);
    if (statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : 'Run command rejected',
        code,
      });
    }
  }
  console.error('[RunsRoute] Run command failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  return res.status(500).json({ error: 'Erreur lors de la commande de run', code: 'RUN_COMMAND_FAILED' });
}

router.post('/execute', requireAuth, async (req, res) => {
  try {
    const bodyResult = executeRunSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Paramètres run invalides', details: bodyResult.error.issues });
    }

    const user = req.user as IUser;
    const idempotencyKey = readIdempotencyKey(req.header('Idempotency-Key'));
    const { functionId, agentInstanceId, toolSelection, testArgs, privateContext } = bodyResult.data;

    const result = await sandboxService.queueFunctionRun({
      functionId,
      userId: user.id,
      testArgs,
      toolSelection,
      agentInstanceId,
      privateContext,
      idempotencyKey,
    });

    res.status(result.replayed ? 200 : 202).json({
      executionId: result.executionId,
      status: result.status,
      idempotency: {
        key: idempotencyKey ?? null,
        replayed: result.replayed,
      },
    });
  } catch (error) {
    return sendRunCommandError(res, error);
  }
});

router.post('/executions/:executionId/cancel', requireAuth, async (req, res) => {
  try {
    const executionId = String(req.params.executionId || '').trim();
    if (!executionId) {
      return res.status(400).json({ error: 'executionId invalide' });
    }

    const user = req.user as IUser;
    const run = await userToolRunService.getRunByExecutionId(executionId);
    if (!run || run.ownerUserId.toString() !== user.id) {
      return res.status(404).json({ error: 'Run introuvable' });
    }

    if (run.status !== 'queued' && run.status !== 'running') {
      return res.status(409).json({
        error: 'Run non annulable',
        code: 'RUN_NOT_CANCELLABLE',
        status: run.status,
      });
    }

    const cancellation = await sandboxService.cancelRun(executionId, user.id);
    if (cancellation.kind === 'not_found') {
      return res.status(404).json({ error: 'Run introuvable' });
    }
    if (cancellation.kind === 'not_cancellable') {
      return res.status(409).json({
        error: 'Run non annulable',
        code: 'RUN_NOT_CANCELLABLE',
        status: cancellation.run.status,
      });
    }

    res.status(cancellation.kind === 'requested' ? 202 : 200).json({
      success: true,
      executionId,
      status: cancellation.run.status,
      cancellationRequested: cancellation.kind === 'requested',
    });
  } catch (error) {
    console.error('[RunsRoute] POST /executions/:executionId/cancel error:', error);
    res.status(500).json({ error: 'Erreur lors de l’annulation du run' });
  }
});

router.post('/executions/:executionId/retry', requireAuth, async (req, res) => {
  const executionId = String(req.params.executionId || '').trim();
  if (!executionId) {
    return res.status(400).json({ error: 'executionId invalide' });
  }

  const idempotencyKey = readIdempotencyKey(req.header('Idempotency-Key'));
  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Idempotency-Key est requis pour relancer un run',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }

  try {
    const user = req.user as IUser;
    const result = await sandboxService.retryRun(executionId, user.id, idempotencyKey);
    return res.status(result.replayed ? 200 : 202).json({
      executionId: result.executionId,
      retryOfExecutionId: executionId,
      status: result.status,
      idempotency: { key: idempotencyKey, replayed: result.replayed },
    });
  } catch (error) {
    return sendRunCommandError(res, error);
  }
});

router.post('/executions/:executionId/reconstruction-quarantine/fail', requireAuth, requireRole(['admin']), async (req, res) => {
  const executionId = String(req.params.executionId || '').trim();
  if (!executionId) {
    return res.status(400).json({ error: 'executionId invalide', code: 'INVALID_EXECUTION_ID' });
  }

  const body = resolveQuarantineSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: 'Le code attendu de quarantaine est requis',
      code: 'INVALID_QUARANTINE_RESOLUTION',
      details: body.error.issues,
    });
  }

  try {
    const admin = req.user as IUser;
    const result = await userToolRunService.failQuarantinedRun(executionId, body.data.expectedCode, admin.id);
    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'Run introuvable', code: 'RUN_NOT_FOUND' });
    }
    if (result.kind === 'conflict') {
      return res.status(409).json({
        error: 'Le run n’est plus dans la quarantaine attendue',
        code: 'RUN_QUARANTINE_STATE_CONFLICT',
      });
    }
    return res.status(200).json({
      executionId,
      status: result.run.status,
      error: result.run.error,
      quarantineResolution: result.run.reconstructionQuarantineResolution,
    });
  } catch (error) {
    return sendRunCommandError(res, error);
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const queryResult = listRunsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Paramètres runs invalides', details: queryResult.error.issues });
    }

    const user = req.user as IUser;
    const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
    runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);

    const runs = await userToolRunQueryService.listRuns(user.id, queryResult.data);
    res.json({ ...runs, runtimeCompatibility });
  } catch (error) {
    console.error('[RunsRoute] GET / error:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des runs' });
  }
});

router.get('/tool/:toolId', requireAuth, async (req, res) => {
  try {
    const idResult = idParamSchema.safeParse(req.params.toolId);
    if (!idResult.success) {
      return res.status(400).json({ error: 'ID de tool invalide' });
    }

    const queryResult = listRunsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Paramètres runs invalides', details: queryResult.error.issues });
    }

    const user = req.user as IUser;
    const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
    runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);

    const runs = await userToolRunQueryService.listRunsForTool(idResult.data, user.id, queryResult.data);
    if (!runs) {
      return res.status(404).json({ error: 'Tool introuvable' });
    }

    res.json({ ...runs, runtimeCompatibility });
  } catch (error) {
    console.error('[RunsRoute] GET /tool/:toolId error:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des runs du tool' });
  }
});

router.get('/executions/:executionId', requireAuth, async (req, res) => {
  try {
    const executionId = String(req.params.executionId || '').trim();
    if (!executionId) {
      return res.status(400).json({ error: 'executionId invalide' });
    }

    const toolId = typeof req.query.toolId === 'string' ? req.query.toolId : undefined;
    if (toolId) {
      const idResult = idParamSchema.safeParse(toolId);
      if (!idResult.success) {
        return res.status(400).json({ error: 'ID de tool invalide' });
      }
    }

    const user = req.user as IUser;
    const run = await userToolRunQueryService.getRunByExecutionId(user.id, executionId, { toolId });
    if (!run) {
      return res.status(404).json({ error: 'Run introuvable' });
    }

    res.json(run);
  } catch (error) {
    console.error('[RunsRoute] GET /executions/:executionId error:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du run' });
  }
});

router.get('/tool/:toolId/:executionId/artifacts/content', requireAuth, async (req, res) => {
  try {
    const idResult = idParamSchema.safeParse(req.params.toolId);
    if (!idResult.success) {
      return res.status(400).json({ error: 'ID de tool invalide' });
    }

    const executionId = String(req.params.executionId || '').trim();
    if (!executionId) {
      return res.status(400).json({ error: 'executionId invalide' });
    }

    const queryResult = artifactQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: "Paramètres d'artefact invalides", details: queryResult.error.issues });
    }

    const user = req.user as IUser;
    const preview = await userToolRunQueryService.getArtifactPreviewForTool(idResult.data, user.id, executionId, queryResult.data.path);
    if (!preview) {
      return res.status(404).json({ error: 'Artefact introuvable' });
    }

    res.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur lors de la lecture de l'artefact";
    if (message.includes('Artifact path') || message.includes('escapes output root')) {
      return res.status(400).json({ error: message });
    }

    console.error('[RunsRoute] GET /tool/:toolId/:executionId/artifacts/content error:', error);
    res.status(500).json({ error: message });
  }
});

router.get('/tool/:toolId/:executionId/artifacts/download', requireAuth, async (req, res) => {
  try {
    const idResult = idParamSchema.safeParse(req.params.toolId);
    if (!idResult.success) {
      return res.status(400).json({ error: 'ID de tool invalide' });
    }

    const executionId = String(req.params.executionId || '').trim();
    if (!executionId) {
      return res.status(400).json({ error: 'executionId invalide' });
    }

    const queryResult = artifactQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: "Paramètres d'artefact invalides", details: queryResult.error.issues });
    }

    const user = req.user as IUser;
    const artifactFile = await userToolRunQueryService.getArtifactFileForTool(idResult.data, user.id, executionId, queryResult.data.path);
    if (!artifactFile) {
      return res.status(404).json({ error: 'Artefact introuvable' });
    }

    res.setHeader('Content-Type', artifactFile.artifact.contentType);
    res.download(artifactFile.artifact.absolutePath, artifactFile.artifact.fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur lors du téléchargement de l'artefact";
    if (message.includes('Artifact path') || message.includes('escapes output root')) {
      return res.status(400).json({ error: message });
    }

    console.error('[RunsRoute] GET /tool/:toolId/:executionId/artifacts/download error:', error);
    res.status(500).json({ error: message });
  }
});

router.post('/tool/:toolId/cleanup', requireAuth, async (req, res) => {
  try {
    const idResult = idParamSchema.safeParse(req.params.toolId);
    if (!idResult.success) {
      return res.status(400).json({ error: 'ID de tool invalide' });
    }

    const bodyResult = cleanupRunsSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Paramètres cleanup invalides', details: bodyResult.error.issues });
    }

    const user = req.user as IUser;
    const result = await userToolRunRetentionService.cleanupRunsForTool(idResult.data, user.id, bodyResult.data);
    if (!result) {
      return res.status(404).json({ error: 'Tool introuvable' });
    }

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur lors du nettoyage des runs';
    console.error('[RunsRoute] POST /tool/:toolId/cleanup error:', error);
    res.status(500).json({ error: message });
  }
});

export default router;
