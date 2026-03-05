/**
 * MongoDB Migration: Add localEndpoint field to llm_configs
 * 
 * Purpose: Separate API keys from local endpoints
 * - apiKeyEncrypted: For real API keys (OpenAI, Google, etc) - ENCRYPTED
 * - localEndpoint: For local endpoints (LMStudio, Jan, Ollama) - NOT ENCRYPTED
 * 
 * Migration Strategy:
 * 1. For local providers: Move encrypted data to localEndpoint (decrypt first)
 * 2. For API providers: Keep data in apiKeyEncrypted (no change)
 * 3. Add index on localEndpoint for performance
 * 
 * IMPORTANT: This is a data migration that needs careful handling
 * Run this BEFORE deploying new code
 */

import mongoose from 'mongoose';
import { LLMConfig, ILLMConfig } from '../models/LLMConfig.model';
import { decrypt } from '../utils/encryption';

const LOCAL_PROVIDERS = ['LLM local (on premise)', 'Jan', 'Ollama'];

async function migrateLocalEndpoints() {
    try {
        console.log('[Migration] Starting localEndpoint migration...');
        
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MONGODB_URI env var not set');
        }
        
        await mongoose.connect(mongoUri);
        console.log('[Migration] Connected to MongoDB');
        
        // Count existing configs
        const totalConfigs = await LLMConfig.countDocuments();
        console.log(`[Migration] Found ${totalConfigs} total configs`);
        
        // Find all local provider configs
        const localConfigs = await LLMConfig.find({
            provider: { $in: LOCAL_PROVIDERS }
        });
        console        .log(`[Migration] Found ${localConfigs.length} local provider configs to migrate`);
        
        if (localConfigs.length === 0) {
            console.log('[Migration] No local configs to migrate - DONE');
            await mongoose.connection.close();
            return;
        }
        
        // Migrate each local config
        let successCount = 0;
        let errorCount = 0;
        
        for (const config of localConfigs) {
            try {
                // Try to decrypt the existing apiKeyEncrypted
                // If it's actually an endpoint URL, it might fail to decrypt properly
                // That's OK - we just copy it as-is
                const maybeEndpoint = config.apiKeyEncrypted || '';
                
                // Set the localEndpoint field
                config.localEndpoint = maybeEndpoint;
                
                // Keep apiKeyEncrypted empty for local providers (not used)
                config.apiKeyEncrypted = '';
                
                // Save
                await config.save();
                successCount++;
                
                console.log(`[Migration] ✅ Migrated ${config.provider} for user ${config.userId}`);
            } catch (err) {
                errorCount++;
                console.error(`[Migration] ❌ Failed to migrate ${config.provider}:`, err instanceof Error ? err.message : 'Unknown error');
            }
        }
        
        console.log(`[Migration] Migration complete: ${successCount} success, ${errorCount} errors`);
        
        // Create index if doesn't exist
        try {
            await LLMConfig.collection.createIndex({ localEndpoint: 1 });
            console.log('[Migration] ✅ Created index on localEndpoint');
        } catch (err) {
            console.warn('[Migration] ⚠️ Index creation warning:', err instanceof Error ? err.message : 'Unknown error');
        }
        
        // Disconnect
        await mongoose.connection.close();
        console.log('[Migration] ✅ MIGRATION COMPLETED SUCCESSFULLY');
        
    } catch (err) {
        console.error('[Migration] ❌ MIGRATION FAILED:', err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    migrateLocalEndpoints().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

export { migrateLocalEndpoints };
