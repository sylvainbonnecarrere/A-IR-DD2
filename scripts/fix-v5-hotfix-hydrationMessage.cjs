/**
 * Fix V5 Hotfix: Remove setHydrationMessage calls from switchToWorkflow
 * These reference a state setter that doesn't exist in the disk version.
 * The HydrationOverlay uses a static message prop on disk.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'App.tsx');
let content = fs.readFileSync(filePath, 'utf8');

console.log('[Hotfix] App.tsx lines:', content.split('\n').length);

// Fix 1: Remove "setHydrationMessage('Chargement du workflow...');" line
const before = content;
content = content.replace(
  /\s*setHydrationMessage\('Chargement du workflow\.\.\.'\);\n/g,
  '\n'
);
if (content === before) {
  console.error('❌ Could not find setHydrationMessage Chargement du workflow');
} else {
  console.log('✅ Removed setHydrationMessage(Chargement du workflow)');
}

// Fix 2: Remove "setHydrationMessage('Chargement de votre workspace...');" in the finally block
const before2 = content;
content = content.replace(
  /\s*setHydrationMessage\('Chargement de votre workspace\.\.\.'\);\n/g,
  '\n'
);
if (content === before2) {
  console.error('❌ Could not find setHydrationMessage Chargement de votre workspace');
} else {
  console.log('✅ Removed setHydrationMessage(Chargement de votre workspace)');
}

fs.writeFileSync(filePath, content, 'utf8');

// Verify
const verify = fs.readFileSync(filePath, 'utf8');
const remaining = (verify.match(/setHydrationMessage/g) || []).length;
console.log(`\nRemaining setHydrationMessage occurrences: ${remaining}`);
if (remaining === 0) {
  console.log('🎉 Hotfix complete — 0 references to setHydrationMessage');
} else {
  console.error('❌ Still found', remaining, 'occurrences');
  process.exit(1);
}

// Also verify the key functions are still there
const checks = ['switchToWorkflow', 'setIsHydrating', 'setHydrationProgress', 'workflow:switch:error', 'workflow:switch:success', 'loadUserWorkflows'];
for (const k of checks) {
  console.log(verify.includes(k) ? `  ✓ ${k}` : `  ✗ ${k} — MISSING!`);
}
