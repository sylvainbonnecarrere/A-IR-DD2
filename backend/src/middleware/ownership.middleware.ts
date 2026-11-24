import { logger } from '../services/logger';
import { Request, Response, NextFunction } from 'express';
import { Model, Types } from 'mongoose';
import { IUser } from '../models/User.model';

/**
 * Interface TypeScript pour les requêtes authentifiées
 * Étend l'interface Request d'Express pour inclure l'utilisateur authentifié
 */
export interface AuthenticatedRequest extends Request {
  user?: IUser;
}

// Filtre d'ownership attaché par `filterByOwnership` et consommé par les contrôleurs.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentation standard d'Express via declare global
  namespace Express {
    interface Request {
      ownershipFilter?: Record<string, unknown>;
    }
  }
}

/**
 * Middleware de vérification de propriété générique
 *
 * Vérifie que l'utilisateur connecté est bien le propriétaire d'une ressource.
 * Prévient l'accès non autorisé et les manipulations de données d'autres utilisateurs.
 *
 * @param model Le modèle Mongoose sur lequel effectuer la recherche
 * @param idParamName Le nom du paramètre dans l'URL contenant l'ID de la ressource (ex: 'workflowId')
 * @param userIdField Le nom du champ dans le modèle stockant l'ID utilisateur (par défaut: 'userId')
 *
 * @example
 * // Pour vérifier qu'un utilisateur est propriétaire d'un workflow:
 * router.delete(
 *   '/:workflowId',
 *   requireAuth,
 *   requireOwnership(Workflow, 'workflowId'),
 *   workflowController.deleteWorkflow
 * );
 *
 * @example
 * // Pour un modèle utilisant 'creator_id' au lieu de 'userId':
 * router.put(
 *   '/:agentId',
 *   requireAuth,
 *   requireOwnership(Agent, 'agentId', 'creator_id'),
 *   agentController.updateAgent
 * );
 */
export const requireOwnership = <T>(model: Model<T>, idParamName: string, userIdField: string = 'userId') => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resourceId = req.params[idParamName];
      const userId = req.user?._id || req.user?.id;

      // Vérifier que l'utilisateur est authentifié
      if (!userId) {
        res.status(401).json({
          message: 'Authentification requise.',
          code: 'AUTH_REQUIRED',
        });
        return;
      }

      // Vérifier le format de l'ID MongoDB
      if (!Types.ObjectId.isValid(resourceId)) {
        res.status(400).json({
          message: `Format d'ID invalide pour ${idParamName}.`,
          code: 'INVALID_ID_FORMAT',
        });
        return;
      }

      // Rechercher la ressource et vérifier la propriété
      const query: Record<string, unknown> = { _id: resourceId };
      const resource = await model.findOne(query).select(userIdField).lean();

      // Si la ressource n'existe pas, retourner 404 (sans révéler l'existence)
      if (!resource) {
        res.status(404).json({
          message: 'Ressource non trouvée.',
          code: 'RESOURCE_NOT_FOUND',
        });
        return;
      }

      // Vérifier que l'utilisateur est bien le propriétaire
      // Type guard robuste: accès sécurisé à la propriété dynamique
      const resourceObj = resource as unknown as Record<string, unknown>;
      const resourceUserId = resourceObj[userIdField]?.toString?.() ?? String(resourceObj[userIdField] ?? '');
      const userIdString = userId.toString();

      if (resourceUserId !== userIdString) {
        res.status(403).json({
          message: "Accès interdit : vous n'êtes pas propriétaire de cette ressource.",
          code: 'OWNERSHIP_DENIED',
        });
        return;
      }

      // L'utilisateur est bien le propriétaire, la requête peut continuer
      next();
    } catch (error) {
      logger.error('Erreur dans le middleware de propriété:', error);
      res.status(500).json({
        message: 'Erreur interne du serveur.',
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
  };
};

/**
 * Middleware pour filtrer les ressources par propriétaire
 *
 * Attache automatiquement un filtre `userId` aux requêtes GET pour lister
 * uniquement les ressources appartenant à l'utilisateur authentifié.
 *
 * @param userIdField Le nom du champ dans le modèle stockant l'ID utilisateur (par défaut: 'userId')
 *
 * @example
 * router.get('/', requireAuth, filterByOwnership(), async (req, res) => {
 *   const resources = await Model.find(req.ownershipFilter);
 * });
 */
export const filterByOwnership = (userIdField: string = 'userId') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      const userId = req.user?._id || req.user?.id;

      if (!userId) {
        res.status(401).json({
          message: 'Authentification requise.',
          code: 'AUTH_REQUIRED',
        });
        return;
      }

      // Attacher le filtre au req pour que le contrôleur l'utilise
      req.ownershipFilter = { [userIdField]: userId };

      next();
    } catch (error) {
      logger.error('Erreur dans le middleware de filtrage:', error);
      res.status(500).json({
        message: 'Erreur interne du serveur.',
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
  };
};
