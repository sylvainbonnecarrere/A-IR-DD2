import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.model';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { validateRequest } from '../middleware/validation.middleware';
import { WorkflowSelfHealingService } from '../services/workflowSelfHealing.service';

const router = Router();

// ===== SCHÉMAS VALIDATION ZOD =====

const registerSchema = z.object({
    email: z.string().email('Email invalide'),
    password: z.string()
        .min(8, 'Minimum 8 caractères')
        .regex(/[A-Z]/, 'Au moins 1 majuscule requise')
        .regex(/[a-z]/, 'Au moins 1 minuscule requise')
        .regex(/[0-9]/, 'Au moins 1 chiffre requis')
});

const loginSchema = z.object({
    email: z.string().email('Email invalide'),
    password: z.string().min(1, 'Mot de passe requis')
});

const refreshSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token requis')
});

// ===== ROUTES AUTHENTIFICATION =====

/**
 * POST /api/auth/register
 * Inscription d'un nouvel utilisateur
 */
router.post('/register', validateRequest(registerSchema), async (req, res) => {
    try {
        const { email, password } = req.body;

        // Vérifier email unique
        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(409).json({
                error: 'Email déjà utilisé',
                code: 'EMAIL_EXISTS'
            });
        }

        // Créer utilisateur (password haché automatiquement par pre-save hook)
        const user = new User({
            email: email.toLowerCase(),
            password,
            role: 'user',              // CORRECTION: Valeur par défaut explicite
            isActive: true              // CORRECTION: Valeur par défaut explicite
        });
        await user.save();

        // ⭐ SELF-HEALING: Créer le workflow par défaut pour le nouvel utilisateur
        const defaultWorkflow = await WorkflowSelfHealingService.createDefaultWorkflowForNewUser(user.id);
        console.log(`✅ [Auth] Default workflow created for user ${user.email}:`, defaultWorkflow.id);

        // Générer tokens JWT
        const payload = {
            sub: user.id,
            email: user.email,
            role: user.role
        };
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        console.log(`✅ [Auth] User registered: ${user.email}`);

        res.status(201).json({
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt
            },
            accessToken,
            refreshToken
        });
    } catch (error) {
        console.error('[Auth] Register error:', error);
        res.status(500).json({
            error: 'Erreur lors de l\'inscription',
            code: 'REGISTER_ERROR'
        });
    }
});

/**
 * POST /api/auth/login
 * Connexion utilisateur existant
 */
router.post('/login', validateRequest(loginSchema), async (req, res) => {
    try {
        const { email, password } = req.body;

        // Rechercher utilisateur
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
        if (!user || !user.isActive) {
            return res.status(401).json({
                error: 'Email ou mot de passe invalide',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Vérifier mot de passe
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                error: 'Email ou mot de passe invalide',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Mettre à jour lastLogin
        user.lastLogin = new Date();
        await user.save();

        // Générer tokens JWT
        const payload = {
            sub: user.id,
            email: user.email,
            role: user.role
        };
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        console.log(`✅ [Auth] User logged in: ${user.email}`);

        res.json({
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                lastLogin: user.lastLogin
            },
            accessToken,
            refreshToken
        });
    } catch (error) {
        console.error('[Auth] Login error:', error);
        res.status(500).json({
            error: 'Erreur lors de la connexion',
            code: 'LOGIN_ERROR'
        });
    }
});

/**
 * POST /api/auth/refresh
 * Renouveler l'access token avec un refresh token valide
 */
router.post('/refresh', validateRequest(refreshSchema), async (req, res) => {
    try {
        const { refreshToken } = req.body;

        // Vérifier refresh token
        const payload = verifyRefreshToken(refreshToken);

        // Vérifier que l'utilisateur existe toujours
        const user = await User.findById(payload.sub);
        if (!user || !user.isActive) {
            return res.status(401).json({
                error: 'Utilisateur invalide ou inactif',
                code: 'INVALID_USER'
            });
        }

        // Générer nouveau access token
        const newAccessToken = generateAccessToken({
            sub: payload.sub,
            email: payload.email,
            role: payload.role
        });

        console.log(`🔄 [Auth] Token refreshed for: ${user.email}`);

        res.json({ accessToken: newAccessToken });
    } catch (error) {
        console.error('[Auth] Refresh error:', error);
        res.status(401).json({
            error: 'Refresh token invalide ou expiré',
            code: 'INVALID_REFRESH_TOKEN'
        });
    }
});

/**
 * POST /api/auth/logout
 * Déconnexion (côté client doit supprimer tokens)
 */
router.post('/logout', (req, res) => {
    // Note: Avec JWT, la déconnexion est principalement côté client
    // Le frontend doit supprimer les tokens du storage
    console.log('👋 [Auth] User logged out');
    res.json({ message: 'Déconnexion réussie' });
});

export default router;
