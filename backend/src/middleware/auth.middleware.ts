import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import mongoose from 'mongoose';
import { User, IUser } from '../models/User.model';
import config from '../config/environment';

// Étendre Request d'Express pour inclure user
declare global {
    namespace Express {
        interface User extends IUser { }
    }
}

/**
 * Configuration Passport JWT Strategy
 * Vérifie le token JWT dans le header Authorization: Bearer <token>
 */
passport.use(
    new JwtStrategy(
        {
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            // Validation is enforced centrally during server bootstrap.
            secretOrKey: config.jwt.secret || '__missing_jwt_secret__'
        },
        async (payload, done) => {
            try {
                const user = await User.findById(payload.sub);
                if (!user || !user.isActive) {
                    return done(null, false);
                }
                return done(null, user);
            } catch (error) {
                return done(error, false);
            }
        }
    )
);

/**
 * Middleware: Requiert authentification JWT valide
 * Injecte req.user avec les données utilisateur
 */
export const requireAuth = passport.authenticate('jwt', { session: false });

/**
 * Middleware: Authentification optionnelle
 * - Pas de header Authorization -> continue sans req.user
 * - Token valide -> injecte req.user
 * - Token invalide -> 401 explicite
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('jwt', { session: false }, (error: unknown, user: IUser | false) => {
        if (error) {
            return next(error as Error);
        }

        const authHeader = req.headers.authorization;
        if (authHeader && !user) {
            return res.status(401).json({ error: 'Token d\'authentification invalide' });
        }

        if (user) {
            req.user = user;
        }

        next();
    })(req, res, next);
};

/**
 * Middleware: Vérifie que l'utilisateur a l'un des rôles requis
 * @param roles Tableau de rôles autorisés (ex: ['admin', 'user'])
 */
export const requireRole = (roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Non authentifié' });
        }

        const user = req.user as IUser;
        if (!roles.includes(user.role)) {
            return res.status(403).json({
                error: 'Permissions insuffisantes',
                required: roles,
                current: user.role
            });
        }

        next();
    };
};

/**
 * Middleware: Vérifie que l'utilisateur est propriétaire de la ressource
 * @param getUserIdFromRequest Fonction pour extraire l'userId de la ressource
 */
export const requireOwnership = (getUserIdFromRequest: (req: Request) => string) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Non authentifié' });
        }

        const user = req.user as IUser;
        const resourceUserId = getUserIdFromRequest(req);

        // Admin bypass ownership check
        if (user.id !== resourceUserId && user.role !== 'admin') {
            return res.status(403).json({ error: 'Accès non autorisé à cette ressource' });
        }

        next();
    };
};

/**
 * Middleware: Vérifie ownership avec query async MongoDB
 * @param getResourceUserId Fonction async qui retourne l'userId de la ressource ou null si introuvable
 */
export const requireOwnershipAsync = (
    getResourceUserId: (req: Request) => Promise<string | null>
) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Non authentifié' });
            }

            // CORRECTION SOLID: Validation ObjectId AVANT query DB
            // Cela prévient CastError → 500 et retourne 400 Bad Request
            const resourceId = req.params.id || req.params.instanceId || req.params.workflowId;
            if (resourceId && !mongoose.Types.ObjectId.isValid(resourceId)) {
                return res.status(400).json({ error: 'Format d\'ID invalide.' });
            }

            const user = req.user as IUser;
            const resourceUserId = await getResourceUserId(req);

            if (!resourceUserId) {
                return res.status(404).json({ error: 'Ressource introuvable' });
            }

            // Admin bypass ownership check
            if (user.id !== resourceUserId && user.role !== 'admin') {
                return res.status(403).json({ error: 'Accès non autorisé à cette ressource' });
            }

            next();
        } catch (error) {
            console.error('[requireOwnershipAsync] Error:', error);
            res.status(500).json({ error: 'Erreur vérification ownership' });
        }
    };
};

export default passport;
