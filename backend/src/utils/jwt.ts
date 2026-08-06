import jwt, { SignOptions } from 'jsonwebtoken';
import config from '../config/environment';

function getJwtRuntimeConfig() {
    const isTestEnvironment = process.env.NODE_ENV === 'test';
    const accessSecret = config.jwt.secret;
    const refreshSecret = config.jwt.refreshSecret || (isTestEnvironment ? accessSecret : '');

    if (!accessSecret) {
        throw new Error('JWT_SECRET not configured - check your .env file');
    }

    if (!refreshSecret) {
        throw new Error('REFRESH_TOKEN_SECRET not configured - check your .env file');
    }

    if (!isTestEnvironment && refreshSecret === accessSecret) {
        throw new Error('REFRESH_TOKEN_SECRET must be different from JWT_SECRET');
    }

    return {
        accessSecret,
        accessExpiration: config.jwt.expiration || '1h',
        refreshSecret,
        refreshExpiration: config.jwt.refreshExpiration || '7d'
    };
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
    const { accessSecret, accessExpiration } = getJwtRuntimeConfig();
    return jwt.sign(payload, accessSecret, { expiresIn: accessExpiration } as SignOptions);
};

/**
 * Génère un refresh token JWT (longue durée)
 */
export const generateRefreshToken = (payload: JWTPayload): string => {
    const { refreshSecret, refreshExpiration } = getJwtRuntimeConfig();
    return jwt.sign(payload, refreshSecret, { expiresIn: refreshExpiration } as SignOptions);
};

/**
 * Vérifie et décode un access token
 */
export const verifyAccessToken = (token: string): JWTPayload => {
    const { accessSecret } = getJwtRuntimeConfig();
    return jwt.verify(token, accessSecret) as JWTPayload;
};

/**
 * Vérifie et décode un refresh token
 */
export const verifyRefreshToken = (token: string): JWTPayload => {
    const { refreshSecret } = getJwtRuntimeConfig();
    return jwt.verify(token, refreshSecret) as JWTPayload;
};
