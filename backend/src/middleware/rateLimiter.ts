// Rate limiting pour les routes LMStudio
import { logger } from '../services/logger';
import rateLimit from 'express-rate-limit';
import { LMSTUDIO_CONFIG } from '../config/lmstudio.config';

/**
 * Rate limiter global pour toutes les routes LMStudio
 * Limite : 60 requêtes par minute par IP
 */
export const lmstudioRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: LMSTUDIO_CONFIG.MAX_REQUESTS_PER_MINUTE,
  message: {
    error: 'Too many requests to LMStudio proxy',
    details: `Maximum ${LMSTUDIO_CONFIG.MAX_REQUESTS_PER_MINUTE} requests per minute allowed. Please try again later.`,
    retryAfter: '60 seconds',
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers

  // Skip successful requests from counting (optionnel)
  // skipSuccessfulRequests: false,

  // Skip failed requests from counting (optionnel)
  // skipFailedRequests: false,

  // Ne PAS utiliser keyGenerator custom pour éviter l'erreur IPv6
  // express-rate-limit gère automatiquement IPv4 et IPv6

  // Handler custom pour logging
  handler: (req, res) => {
    logger.warn(`[LMStudio Proxy] Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests',
      details: `Maximum ${LMSTUDIO_CONFIG.MAX_REQUESTS_PER_MINUTE} requests per minute allowed`,
      retryAfter: '60 seconds',
    });
  },
});

/**
 * Rate limiter strict pour les endpoints coûteux (chat/completions)
 * Limite : 30 requêtes par minute (plus strict)
 */
export const strictRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // Plus strict pour le streaming
  message: {
    error: 'Too many chat requests',
    details: 'Maximum 30 chat requests per minute allowed',
    retryAfter: '60 seconds',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Ne PAS utiliser keyGenerator custom pour éviter l'erreur IPv6
  handler: (req, res) => {
    logger.warn(`[LMStudio Proxy] Strict rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many chat requests',
      details: 'Maximum 30 chat completion requests per minute allowed',
      retryAfter: '60 seconds',
    });
  },
});
