#!/usr/bin/env node

/**
 * Check if backend is running and accessible
 */

const API_BASE = 'http://localhost:3001';

async function checkBackend() {
    console.log('🔍 Checking backend connectivity...\n');
    
    try {
        const res = await fetch(`${API_BASE}/api/health`, {
            timeout: 5000
        }).catch(() => null);
        
        if (!res) {
            console.error('❌ Backend not responding at', API_BASE);
            console.error('\nTo start backend:');
            console.error('  cd backend');
            console.error('  npm run dev');
            process.exit(1);
        }
        
        console.log('✅ Backend is running at', API_BASE);
        console.log('   Status:', res.status);
        
        // Try auth endpoints  
        console.log('\n🔍 Checking auth endpoints...');
        const endpoints = ['/api/auth/login', '/api/auth/register', '/api/workflows'];
        
        for (const endpoint of endpoints) {
            try {
                const res = await fetch(`${API_BASE}${endpoint}`, { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                    timeout: 2000
                }).catch(e => null);
                
                console.log(res ? `   ✅ ${endpoint} responding` : `   ⚠️  ${endpoint} no response`);
            } catch (e) {
                console.log(`   ⚠️  ${endpoint} error`);
            }
        }
        
        console.log('\n✅ Backend looks ready for testing!\n');
        
    } catch (error) {
        console.error('❌ Error checking backend:', error.message);
        process.exit(1);
    }
}

checkBackend();
