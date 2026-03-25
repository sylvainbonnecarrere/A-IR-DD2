// Middleware de validation des requêtes LMStudio
import { Request, Response, NextFunction } from 'express';
import { LOCAL_ENDPOINT_POLICY_ERROR } from '../utils/localEndpointPolicy';
import { isEndpointAccessibleForUser } from '../services/localEndpointAccess.service';

/**
 * Validation des requêtes chat completion
 * Vérifie la présence et la validité des paramètres model et messages
 */
export function validateChatRequest(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { model, messages } = req.body;

    // Validation model
    if (!model || typeof model !== 'string' || model.trim().length === 0) {
        res.status(400).json({
            error: 'Invalid model parameter',
            details: 'Model must be a non-empty string'
        });
        return;
    }

    // Validation messages
    if (!Array.isArray(messages)) {
        res.status(400).json({
            error: 'Invalid messages parameter',
            details: 'Messages must be an array'
        });
        return;
    }

    if (messages.length === 0) {
        res.status(400).json({
            error: 'Invalid messages parameter',
            details: 'Messages array cannot be empty'
        });
        return;
    }

    // Validation de chaque message
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (!msg || typeof msg !== 'object') {
            console.error('[Validation] Invalid message format at index', i, ':', msg);
            res.status(400).json({
                error: 'Invalid message format',
                details: `Message at index ${i} must be an object`
            });
            return;
        }

        // Validation role
        if (!msg.role || !['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
            console.error('[Validation] Invalid message role at index', i, '- role:', msg.role);
            res.status(400).json({
                error: 'Invalid message role',
                details: `Message at index ${i} has invalid role "${msg.role}". Must be: system, user, assistant, or tool`
            });
            return;
        }

        // Validation content (peut être null pour tool calls)
        if (msg.content !== null && typeof msg.content !== 'string') {
            res.status(400).json({
                error: 'Invalid message content',
                details: `Message at index ${i} content must be a string or null`
            });
            return;
        }
    }

    next();
}

/**
 * Validation de l'endpoint
 * Vérifie que l'endpoint cible reste un endpoint local ou réseau privé autorisé.
 */
export function validateEndpoint(
    req: Request,
    res: Response,
    next: NextFunction
): void | Promise<void> {
    const endpoint = req.body.endpoint || (req.query.endpoint as string);

    // Si pas d'endpoint fourni, laisser passer (default sera utilisé)
    if (!endpoint) {
        next();
        return;
    }

    // Validation type
    if (typeof endpoint !== 'string') {
        res.status(400).json({
            error: 'Invalid endpoint parameter',
            details: 'Endpoint must be a string'
        });
        return;
    }

    const userId = (req.user as { id?: string } | undefined)?.id;

    return isEndpointAccessibleForUser(endpoint, userId)
        .then((isAllowed) => {
            if (isAllowed) {
                next();
                return;
            }

            res.status(403).json({
                error: 'Endpoint forbidden',
                details: LOCAL_ENDPOINT_POLICY_ERROR
            });
        })
        .catch((error) => {
            next(error);
        });
}

/**
 * Validation des paramètres optionnels de chat completion
 */
export function validateChatOptions(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { temperature, max_tokens, stream } = req.body;

    // Validation temperature
    if (temperature !== undefined) {
        if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
            res.status(400).json({
                error: 'Invalid temperature',
                details: 'Temperature must be a number between 0 and 2'
            });
            return;
        }
    }

    // Validation max_tokens
    if (max_tokens !== undefined) {
        if (typeof max_tokens !== 'number' || max_tokens < 1 || max_tokens > 32768) {
            res.status(400).json({
                error: 'Invalid max_tokens',
                details: 'max_tokens must be a number between 1 and 32768'
            });
            return;
        }
    }

    // Validation stream
    if (stream !== undefined && typeof stream !== 'boolean') {
        res.status(400).json({
            error: 'Invalid stream parameter',
            details: 'Stream must be a boolean'
        });
        return;
    }

    next();
}
