import jwt, { SignOptions } from 'jsonwebtoken';
import config from '../config/environment';

// SOLID: Dependency Injection - récupérer les secrets depuis config centralisée
const isTestEnvironment = process.env.NODE_ENV === 'test';
const JWT_SECRET = config.jwt.secret;
const JWT_EXPIRATION = config.jwt.expiration || '1h';
const REFRESH_SECRET = config.jwt.refreshSecret || (isTestEnvironment ? JWT_SECRET : '');
const REFRESH_EXPIRATION = config.jwt.refreshExpiration || '7d';

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured - check your .env file');
}

if (!REFRESH_SECRET) {
    throw new Error('REFRESH_TOKEN_SECRET not configured - check your .env file');
}

if (!isTestEnvironment && REFRESH_SECRET === JWT_SECRET) {
    throw new Error('REFRESH_TOKEN_SECRET must be different from JWT_SECRET');
}

export interface JWTPayload {
    sub: string; // User ID
    email: string;
    role: string;
}

/**
 * Génère un access token JWT (courte durée)
 */
export const generateAccessToken = (payload: JWTPayload): string => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION } as SignOptions);
};

/**
 * Génère un refresh token JWT (longue durée)
 */
export const generateRefreshToken = (payload: JWTPayload): string => {
    return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRATION } as SignOptions);
};

/**
 * Vérifie et décode un access token
 */
export const verifyAccessToken = (token: string): JWTPayload => {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
};

/**
 * Vérifie et décode un refresh token
 */
export const verifyRefreshToken = (token: string): JWTPayload => {
    return jwt.verify(token, REFRESH_SECRET) as JWTPayload;
};
