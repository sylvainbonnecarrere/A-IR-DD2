/**
 * @file user-settings.routes.ts
 * @description User settings persistence endpoints (J4.4 - Simplified)
 * @domain Design Domain - Bounded Context: Settings Management
 *
 * ENDPOINTS:
 * - GET /api/user-settings (fetch user preferences)
 * - POST /api/user-settings (save user preferences)
 *
 * PREFERENCES SUPPORTED:
 * - language: 'fr' | 'en' | 'de' | 'es' | 'pt'
 * - theme: 'dark' | 'light'
 * - saveMode: 'auto' | 'manual'
 *
 * MIGRATION NOTE (J4.4):
 * - llmConfigs handling REMOVED from this route
 * - All API key operations now go through /api/llm-configs
 * - This route handles ONLY preferences (language, theme, saveMode)
 *
 * SECURITY:
 * - Requires Bearer token (JWT)
 * - userId from token validated
 */

import { logger } from '../services/logger';
import express, { Router, Request, Response, NextFunction } from 'express';
import UserSettings, { IUserSettings } from '../models/UserSettings.model';
import { User, type IUser } from '../models/User.model';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

/**
 * GET /api/user-settings
 * Fetch user preferences only
 *
 * NOTE (J4.4): llmConfigs removed - use GET /api/llm-configs instead
 *
 * Response: {
 *   preferences: { language, theme, saveMode },
 *   lastSync: Date,
 *   updatedAt: Date
 * }
 */
router.get('/api/user-settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as IUser;
    const userId = user.id || user._id;

    let settings = await UserSettings.findOne({ userId });

    // Initialize if doesn't exist
    if (!settings) {
      settings = new UserSettings({
        userId,
        preferences: {
          language: 'fr',
          theme: 'dark',
          saveMode: 'manual',
        },
      });
      await settings.save();
    }

    res.json({
      preferences: settings.preferences,
      lastSync: settings.lastSync,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    logger.error('[GET /api/user-settings] Error:', error);
    res.status(500).json({
      error: 'Failed to fetch user settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/user-settings (alias for PUT)
 * PUT /api/user-settings
 * Save user preferences only
 *
 * NOTE (J4.4): llmConfigs handling REMOVED
 * For LLM configs, use POST /api/llm-configs instead
 *
 * Request body: {
 *   preferences?: { language?, theme?, saveMode? }
 * }
 *
 * Response: {
 *   preferences: { language, theme, saveMode },
 *   lastSync: Date,
 *   updatedAt: Date
 * }
 */
const saveSettingsHandler = async (req: Request, res: Response) => {
  try {
    const user = req.user as IUser;
    const userId = user.id || user._id;
    const { preferences } = req.body;

    let settings = await UserSettings.findOne({ userId });

    // Initialize if doesn't exist
    if (!settings) {
      settings = new UserSettings({
        userId,
        preferences: {
          language: 'fr',
          theme: 'dark',
          saveMode: 'manual',
        },
      });
    }

    // Update preferences if provided
    if (preferences && typeof preferences === 'object') {
      if ('language' in preferences && preferences.language) {
        settings.preferences.language = preferences.language;
      }
      if ('theme' in preferences && preferences.theme) {
        settings.preferences.theme = preferences.theme;
      }
      if ('saveMode' in preferences && preferences.saveMode) {
        settings.preferences.saveMode = preferences.saveMode;
      }
    }

    // Update sync timestamp
    settings.lastSync = new Date();

    // Increment version for conflict detection
    settings.version = (settings.version || 0) + 1;

    // Save atomically
    await settings.save();

    res.json({
      preferences: settings.preferences,
      lastSync: settings.lastSync,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    logger.error('[SAVE user-settings] Error:', error);
    res.status(500).json({
      error: 'Failed to save user settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

router.post('/api/user-settings', requireAuth, saveSettingsHandler);
router.put('/api/user-settings', requireAuth, saveSettingsHandler);

export default router;
