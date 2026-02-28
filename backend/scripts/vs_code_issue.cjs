/**
 * vs_code_issue.cjs — Correctif App.tsx sur disque
 * 
 * Problème : VS Code affiche des modifications dans le buffer qui n'ont
 * jamais été persistées sur le disque. Ce script applique les 3 corrections
 * critiques directement sur le fichier App.tsx via Node.js fs.
 *
 * Usage : node backend/scripts/vs_code_issue.cjs
 */
const fs = require('fs');
const path = require('path');

const APP_PATH = path.resolve(__dirname, '../../App.tsx');
console.log('[vs_code_issue] Target:', APP_PATH);

if (!fs.existsSync(APP_PATH)) {
  console.error('ERREUR: App.tsx introuvable à', APP_PATH);
  process.exit(1);
}

const raw = fs.readFileSync(APP_PATH, 'utf8');
const hasCRLF = raw.includes('\r\n');
const SEP = hasCRLF ? '\r\n' : '\n';
const lines = raw.split(SEP);

console.log(`[vs_code_issue] ${lines.length} lignes, line-endings: ${hasCRLF ? 'CRLF' : 'LF'}`);

let fixes = 0;

// ═══════════════════════════════════════════════════════════════════════
// FIX 1 : localStorage.clear() détruit le JWT token auth_data_v1
//         → Sauvegarder/restaurer le token autour du clear()
// ═══════════════════════════════════════════════════════════════════════

const clearIdx = lines.findIndex(l => l.trim() === 'localStorage.clear();');
if (clearIdx >= 0) {
  // Vérifier que la ligne précédente contient resetAll (contexte attendu)
  const prevLine = lines[clearIdx - 1] || '';
  if (prevLine.includes('resetAll') || prevLine.includes('CRITICAL') || prevLine.includes('stale data')) {
    const indent = lines[clearIdx].match(/^(\s*)/)[1];
    const replacement = [
      `${indent}// ⭐ FIX: Preserve auth token during reset`,
      `${indent}// localStorage.clear() was wiping auth_data_v1 (JWT) → all apiClient calls got 401`,
      `${indent}const authBackup = localStorage.getItem('auth_data_v1');`,
      `${indent}localStorage.clear();`,
      `${indent}if (authBackup) localStorage.setItem('auth_data_v1', authBackup);`,
    ];
    lines.splice(clearIdx, 1, ...replacement);
    console.log(`✅ FIX 1: localStorage.clear() auth-preserve (line ${clearIdx + 1})`);
    fixes++;
  } else {
    console.warn(`⚠️  FIX 1: Found localStorage.clear() at line ${clearIdx + 1} but context doesn't match (prev: "${prevLine.trim()}")`);
  }
} else {
  // Check if already fixed
  if (raw.includes('authBackup')) {
    console.log('ℹ️  FIX 1: Already applied (authBackup found)');
  } else {
    console.error('❌ FIX 1: localStorage.clear() not found');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FIX 2 : _arc_hydrating n'est jamais nettoyé dans le finally block
//         → Ajouter sessionStorage.removeItem('_arc_hydrating')
// ═══════════════════════════════════════════════════════════════════════

// Find the finally block of the hydration useEffect
// Pattern: "} finally {" after the hydration try block
const hydrationSetIdx = lines.findIndex(l => l.includes("_arc_hydrating") && l.includes('setItem'));

if (hydrationSetIdx >= 0 && !raw.includes("removeItem('_arc_hydrating')")) {
  // Search for "} finally {" after hydrationSetIdx
  let finallyIdx = -1;
  for (let i = hydrationSetIdx; i < lines.length; i++) {
    if (lines[i].trim() === '} finally {') {
      finallyIdx = i;
      break;
    }
  }

  if (finallyIdx >= 0) {
    const indent = lines[finallyIdx].match(/^(\s*)/)[1] + '  ';
    lines.splice(finallyIdx + 1, 0,
      `${indent}// ⭐ FIX: Clear hydration flag so loadWorkflows can proceed`,
      `${indent}sessionStorage.removeItem('_arc_hydrating');`
    );
    console.log(`✅ FIX 2: _arc_hydrating cleanup in finally (after line ${finallyIdx + 1})`);
    fixes++;
  } else {
    console.error('❌ FIX 2: Could not find "} finally {" after hydration setItem');
  }
} else if (raw.includes("removeItem('_arc_hydrating')")) {
  console.log('ℹ️  FIX 2: Already applied (removeItem found)');
} else {
  console.error('❌ FIX 2: _arc_hydrating setItem not found');
}

// ═══════════════════════════════════════════════════════════════════════
// FIX 3 : loadWorkflows useEffect n'attend pas la fin de l'hydratation
//         → Ajouter un guard avec retryCount sur _arc_hydrating
//         → Augmenter le délai de 100ms à 200ms
// ═══════════════════════════════════════════════════════════════════════

// Find the "PHASE 2: Load workflows" comment
const phase2Idx = lines.findIndex(l => l.includes('PHASE 2: Load workflows'));

if (phase2Idx >= 0 && !raw.includes('retryCount')) {
  // Find the block boundaries
  // Expected pattern:
  //   // ⭐ PHASE 2: Load workflows on authentication
  //   useEffect(() => {
  //     if (isAuthenticated && accessToken) {
  //       const loadWorkflows = async () => { ...
  //       const timer = setTimeout(() => { loadWorkflows(); }, 100);
  //       return () => clearTimeout(timer);
  //     }
  //   }, [isAuthenticated, accessToken]);

  // Find the end: "}, [isAuthenticated, accessToken]);"
  let endIdx = -1;
  for (let i = phase2Idx; i < phase2Idx + 30; i++) {
    if (lines[i] && lines[i].includes('[isAuthenticated, accessToken]')) {
      endIdx = i;
      break;
    }
  }

  if (endIdx >= 0) {
    const indent = '  '; // 2 spaces base indent for top-level hook
    const newBlock = [
      `${indent}// ⭐ PHASE 2: Load workflows on authentication`,
      `${indent}// ⭐ V4 FIX: Wait for hydration to complete before loading workflows`,
      `${indent}useEffect(() => {`,
      `${indent}  if (!isAuthenticated || !accessToken) return;`,
      ``,
      `${indent}  const loadWorkflows = async (retryCount = 0) => {`,
      `${indent}    try {`,
      `${indent}      // Wait for hydration to finish before loading workflows`,
      `${indent}      const isHydrating = sessionStorage.getItem('_arc_hydrating') === 'true';`,
      `${indent}      if (isHydrating && retryCount < 5) {`,
      `${indent}        setTimeout(() => loadWorkflows(retryCount + 1), 300);`,
      `${indent}        return;`,
      `${indent}      }`,
      `${indent}      `,
      `${indent}      const designStore = useDesignStore.getState();`,
      `${indent}      await designStore.loadUserWorkflows();`,
      `${indent}      console.log('[App] ✅ Workflows loaded successfully');`,
      `${indent}    } catch (error) {`,
      `${indent}      console.error('[App] ❌ Failed to load workflows:', error);`,
      `${indent}    }`,
      `${indent}  };`,
      ``,
      `${indent}  const timer = setTimeout(() => {`,
      `${indent}    loadWorkflows();`,
      `${indent}  }, 200);`,
      ``,
      `${indent}  return () => clearTimeout(timer);`,
      `${indent}}, [isAuthenticated, accessToken]);`,
    ];

    const removeCount = endIdx - phase2Idx + 1;
    lines.splice(phase2Idx, removeCount, ...newBlock);
    console.log(`✅ FIX 3: loadWorkflows hydration guard (lines ${phase2Idx + 1}-${endIdx + 1} → ${newBlock.length} lines)`);
    fixes++;
  } else {
    console.error('❌ FIX 3: Could not find useEffect dependency array for loadWorkflows');
  }
} else if (raw.includes('retryCount')) {
  console.log('ℹ️  FIX 3: Already applied (retryCount found)');
} else {
  console.error('❌ FIX 3: "PHASE 2: Load workflows" comment not found');
}

// ═══════════════════════════════════════════════════════════════════════
// ÉCRITURE ET VÉRIFICATION
// ═══════════════════════════════════════════════════════════════════════

const result = lines.join(SEP);
fs.writeFileSync(APP_PATH, result, 'utf8');

// Vérification finale
const verify = fs.readFileSync(APP_PATH, 'utf8');
const checks = {
  'authBackup (FIX 1)': verify.includes('authBackup'),
  'removeItem _arc_hydrating (FIX 2)': verify.includes("removeItem('_arc_hydrating')"),
  'retryCount loadWorkflows (FIX 3)': verify.includes('retryCount'),
  'No raw localStorage.clear without guard': !verify.includes('localStorage.clear()') || verify.includes('authBackup'),
  'Timer 200ms': verify.includes(', 200);'),
};

console.log('\n══════════════════════════════════════');
console.log(`  ${fixes} fix(es) appliqué(s)`);
console.log('══════════════════════════════════════');
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
}
console.log(`  Total lignes: ${verify.split(SEP).length}`);
