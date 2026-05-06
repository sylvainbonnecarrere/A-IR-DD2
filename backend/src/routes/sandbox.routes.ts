/**
 * Routes API — Sandbox d'exécution des fonctions (Tools V2)
 *
 * ENDPOINTS :
 *   POST /api/sandbox/run     — Exécute une fonction avec des paramètres de test
 *   POST /api/sandbox/check   — Vérifie la syntaxe d'un snippet de code (dry-run)
 *
 * Sécurité :
 *   - requireAuth requis sur toutes les routes
 *   - Timeout global (15s Python / 10s TypeScript)
 *   - Validation Zod stricte des inputs
 *   - Rate-limit (10 req/min par utilisateur — via rateLimiter middleware)
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { BuildPreparationError } from '../services/build.service';
import { RuntimeHealthService } from '../services/runtimeHealth.service';
import { SandboxService } from '../services/sandbox.service';
import { buildSandboxErrorDetails, RuntimeNotReadyError } from '../services/runtime/errors';
import { IUser } from '../models/User.model';

const router = Router();
const sandboxService = new SandboxService();
const runtimeHealthService = new RuntimeHealthService();

type SandboxStdoutEvent = Record<string, unknown>;

function parseSandboxStdoutEvents(stdout?: string): SandboxStdoutEvent[] {
    if (typeof stdout !== 'string' || !stdout.trim()) {
        return [];
    }

    const events: SandboxStdoutEvent[] = [];
    for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                events.push(parsed as SandboxStdoutEvent);
            }
        } catch {
            continue;
        }
    }

    return events;
}

// ─── Schémas de Validation ────────────────────────────────────────────────────

const runFunctionSchema = z.object({
    functionId: z
        .string()
        .regex(/^[a-f\d]{24}$/i, 'functionId doit être un ObjectId MongoDB valide'),
    toolSelection: z.object({
        toolId: z.string().regex(/^[a-f\d]{24}$/i, 'toolId doit être un ObjectId MongoDB valide'),
        versionRef: z.object({
            versionTag: z.string().optional(),
            versionNumber: z.number().optional(),
            workspaceId: z.string().nullable().optional()
        }).optional()
    }).optional(),
    testArgs: z
        .record(z.unknown())
        .optional()
        .default({}),
    privateContext: z.record(z.unknown()).optional()
});

const checkSyntaxSchema = z.object({
    language: z.enum(['python', 'typescript']),
    code: z
        .string()
        .min(1, 'Le code ne peut pas être vide')
        .max(50_000, 'Le code dépasse la limite de 50 000 caractères')
});

// ─── GET /api/sandbox/health ──────────────────────────────────────────────────
// C9.1: Vérifie la disponibilité du sandbox Python (détection cross-platform)
router.get('/health', requireAuth, async (_req, res) => {
    try {
        const health = await runtimeHealthService.getHealthReport();
        res.json(health);
    } catch (error) {
        console.error('[SandboxRoute] GET /health error:', error);
        res.status(500).json({ error: 'Erreur vérification health sandbox' });
    }
});

// ─── POST /api/sandbox/run ────────────────────────────────────────────────────
router.post('/run', requireAuth, validateRequest(runFunctionSchema), async (req, res) => {
    try {
        const user = req.user as IUser;
        const { functionId, toolSelection, testArgs, privateContext } = req.body;

        console.info('[SandboxRoute] POST /run start', {
            userId: user.id,
            functionId,
            toolId: toolSelection?.toolId ?? null,
            versionTag: toolSelection?.versionRef?.versionTag ?? null,
            argKeys: Object.keys(testArgs ?? {}),
        });

        const result = await sandboxService.runFunction(
            functionId,
            user.id,
            testArgs,
            toolSelection,
            privateContext,
            req.headers.authorization,
        );

        console.info('[SandboxRoute] POST /run done', {
            userId: user.id,
            functionId,
            toolId: toolSelection?.toolId ?? null,
            executionId: result.executionId ?? null,
            success: result.success,
            runner: result.runner ?? null,
            exitCode: result.exitCode ?? null,
            failureKind: result.metadata?.failureKind ?? result.errorDetails?.failureKind ?? null,
        });

        const stdoutEvents = parseSandboxStdoutEvents(result.stdout);
        for (const event of stdoutEvents) {
            const sandboxDebugEvent = typeof event.SANDBOX_DEBUG === 'string' ? event.SANDBOX_DEBUG : null;
            const webSearchDebugEvent = typeof event.WEB_SEARCH_DEBUG === 'string' ? event.WEB_SEARCH_DEBUG : null;

            if (!sandboxDebugEvent && !webSearchDebugEvent) {
                continue;
            }

            console.info('[SandboxRoute] POST /run sandbox stdout', {
                executionId: result.executionId ?? null,
                event: webSearchDebugEvent ?? sandboxDebugEvent,
                payload: event,
            });
        }

        const outputPayload = result.output && typeof result.output === 'object'
            ? result.output as {
                error?: { step?: string; message?: string; diagnostics?: unknown };
                rerank_diagnostics?: unknown;
                trace?: {
                    transformed_query_raw?: string;
                    input?: { web_engine?: string };
                    engine_query_plans?: unknown[];
                    engine_execution_trace?: unknown[];
                    engine_top_results?: unknown[];
                    rerank_diagnostics?: unknown;
                };
            }
            : undefined;

        const outputTrace = outputPayload?.trace;

        const rerankDiagnostics = outputPayload?.rerank_diagnostics ?? outputTrace?.rerank_diagnostics;

        if (outputPayload?.error?.step === 'rerank_sources') {
            console.info('[SandboxRoute] POST /run web_search rerank diagnostic', {
                executionId: result.executionId ?? null,
                webEngine: outputTrace?.input?.web_engine ?? null,
                transformedQuery: outputTrace?.transformed_query_raw ?? null,
                error: outputPayload.error.message ?? null,
                rerankDiagnostics,
            });
        }

        if (outputTrace?.engine_query_plans?.length) {
            console.info('[SandboxRoute] POST /run web_search plan', {
                executionId: result.executionId ?? null,
                webEngine: outputTrace.input?.web_engine ?? null,
                transformedQuery: outputTrace.transformed_query_raw ?? null,
                queryPlans: outputTrace.engine_query_plans,
            });
        }

        if (outputTrace?.engine_execution_trace?.length) {
            console.info('[SandboxRoute] POST /run web_search execution trace', {
                executionId: result.executionId ?? null,
                webEngine: outputTrace.input?.web_engine ?? null,
                transformedQuery: outputTrace.transformed_query_raw ?? null,
                executions: outputTrace.engine_execution_trace,
            });
        }

        if (outputTrace?.engine_top_results?.length) {
            console.info('[SandboxRoute] POST /run web_search debug', {
                executionId: result.executionId ?? null,
                webEngine: outputTrace.input?.web_engine ?? null,
                transformedQuery: outputTrace.transformed_query_raw ?? null,
                topResults: outputTrace.engine_top_results,
            });
        }

        res.json(result);
    } catch (error: any) {
        console.error('[SandboxRoute] POST /run error:', error);

        if (error.message?.includes('introuvable') || error.message?.includes('not found')) {
            return res.status(404).json({
                error: error.message,
                errorDetails: buildSandboxErrorDetails({
                    message: error.message,
                    code: 'SANDBOX_TARGET_NOT_FOUND',
                    subsystem: 'validation',
                    retryable: false,
                })
            });
        }
        if (error.message?.includes('désactivée') || error.message?.includes('disabled')) {
            return res.status(403).json({
                error: error.message,
                errorDetails: buildSandboxErrorDetails({
                    message: error.message,
                    code: 'SANDBOX_TARGET_DISABLED',
                    subsystem: 'validation',
                    retryable: false,
                })
            });
        }
        if (error instanceof BuildPreparationError || error.message?.includes('prepared via the build workflow')) {
            return res.status(409).json({
                error: error.message,
                errorDetails: buildSandboxErrorDetails({
                    message: error.message,
                    code: error instanceof BuildPreparationError ? error.code : 'BUILD_PREPARATION_ERROR',
                    subsystem: 'build_preparation',
                    retryable: false,
                })
            });
        }
        if (error instanceof RuntimeNotReadyError) {
            return res.status(503).json({
                error: error.message,
                errorDetails: buildSandboxErrorDetails({
                    message: error.message,
                    code: 'RUNTIME_NOT_READY',
                    subsystem: 'runtime_readiness',
                    retryable: true,
                })
            });
        }
        if (error.message?.includes('timeout') || error.message?.includes('Timeout')) {
            const message = 'Timeout : la fonction a dépassé le délai d\'exécution autorisé';
            return res.status(408).json({
                error: message,
                errorDetails: buildSandboxErrorDetails({
                    message,
                    code: 'TIMEOUT',
                    subsystem: 'sandbox_runtime',
                    retryable: false,
                    failureKind: 'timeout',
                })
            });
        }

        const message = 'Erreur lors de l\'exécution dans le sandbox';
        res.status(500).json({
            error: message,
            errorDetails: buildSandboxErrorDetails({
                message,
                code: 'SANDBOX_ROUTE_ERROR',
                subsystem: 'sandbox_runtime',
                retryable: false,
            })
        });
    }
});

// ─── POST /api/sandbox/check ──────────────────────────────────────────────────
router.post('/check', requireAuth, validateRequest(checkSyntaxSchema), async (req, res) => {
    try {
        const { language, code } = req.body;
        const result = await sandboxService.checkSyntax(language, code);
        res.json(result);
    } catch (error) {
        console.error('[SandboxRoute] POST /check error:', error);
        res.status(500).json({ error: 'Erreur lors de la vérification syntaxique' });
    }
});

export default router;
