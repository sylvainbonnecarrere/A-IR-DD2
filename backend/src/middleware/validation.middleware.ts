import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

type ValidationIssue = {
    field: string;
    message: string;
    code: string;
};

export function formatZodValidationDetails(error: z.ZodError): ValidationIssue[] {
    const issues = Array.isArray(error.issues)
        ? error.issues
        : Array.isArray((error as unknown as { errors?: z.ZodIssue[] }).errors)
            ? (error as unknown as { errors: z.ZodIssue[] }).errors
            : [];

    return issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
    }));
}

/**
 * Middleware de validation Zod
 * Valide req.body contre un schéma Zod et retourne erreurs détaillées
 * @param schema Schéma Zod à valider
 */
export const validateRequest = (schema: ZodSchema) => {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            schema.parse(req.body);
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    error: 'Validation échouée',
                    details: formatZodValidationDetails(error)
                });
            }
            res.status(500).json({ error: 'Erreur validation interne' });
        }
    };
};
