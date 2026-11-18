#!/usr/bin/env node
/**
 * audit-gate — gate CI `npm audit --audit-level=high` avec allowlist d'advisories retirés.
 *
 * Pourquoi : le 2026-11-18, GitHub a RETIRÉ (withdrawn) l'advisory
 * GHSA-fc5q-39xc-vjpf (picomatch ReDoS, « Patched versions: None »), mais le
 * registry npm continue de le servir via /-/npm/v1/security/advisories/bulk.
 * Il contamine alors transitivement tout le graphe jest/vite/tailwind
 * (45 high à la racine, 35 au backend) sans aucun correctif applicable :
 * picomatch est déjà à sa dernière version (4.0.7) et les « fixes » proposées
 * par npm sont des changements majeurs cassants (jest@30, ts-jest@26, etc.).
 *
 * Ce script préserve un gate STRICT au seuil demandé (high par défaut) :
 * toute vulnérabilité high/critical restante fait échouer le gate (exit 1).
 * Seuls les packages dont TOUTE la chaîne d'advisories mène exclusivement à
 * des advisories retirés par leur éditeur sont ignorés, et chaque entrée de
 * l'allowlist porte son GHSA, sa date de retrait, son URL et la raison.
 *
 * Usage :
 *   node scripts/ci/audit-gate.mjs                 # racine du dépôt
 *   node scripts/ci/audit-gate.mjs --prefix backend
 *   node scripts/ci/audit-gate.mjs --audit-level critical --prefix backend
 *   node scripts/ci/audit-gate.mjs --self-test
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

/**
 * Advisories retirés (withdrawn) par leur éditeur, encore servis par le registry npm.
 * Ne jamais retirer une entrée sans vérification : ce sont les seules exceptions au gate.
 */
const WITHDRAWN_ADVISORIES = [
    {
        ghsa: 'GHSA-fc5q-39xc-vjpf',
        withdrawnOn: '2026-11-18',
        url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
        reason: 'Withdrawn by the publisher ("Patched versions: None"); picomatch is already pinned at the latest 4.0.7. No applicable fix; all npm-proposed fixes are breaking majors (jest@30, ts-jest@26, tailwindcss@4, vite@6).',
    },
];

function ghsaIdOf(url) {
    if (typeof url !== 'string') return null;
    const match = /GHSA-[0-9a-z-]+/i.exec(url);
    return match ? match[0].toUpperCase() : null;
}

const WITHDRAWN_GHSA_IDS = new Set(WITHDRAWN_ADVISORIES.map((entry) => entry.ghsa.toUpperCase()));

function isWithdrawnAdvisory(entry) {
    if (typeof entry !== 'object' || entry === null) return false;
    const id = ghsaIdOf(entry.url);
    return id !== null && WITHDRAWN_GHSA_IDS.has(id);
}

/**
 * Calcule, pour un seuil donné, les packages qui ont au moins un advisory
 * NON retiré de sévérité >= seuil, atteignable directement ou transitivement
 * via le graphe `via` (point fixe). Les packages dont la sévérité >= seuil ne
 * provient que d'advisories retirés sont supprimés du gate.
 */
export function computeRealAtOrAbove(vulnerabilities, level) {
    const threshold = SEVERITY_ORDER.indexOf(level);
    if (threshold < 0) throw new Error(`Unknown audit level: ${level}`);
    const real = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const [name, node] of Object.entries(vulnerabilities)) {
            if (real.has(name)) continue;
            const via = Array.isArray(node.via) ? node.via : [];
            const reaches = via.some((entry) => {
                if (typeof entry === 'string') return real.has(entry);
                if (isWithdrawnAdvisory(entry)) return false;
                return SEVERITY_ORDER.indexOf(entry.severity) >= threshold;
            });
            if (reaches) {
                real.add(name);
                changed = true;
            }
        }
    }
    return real;
}

/** Sépare les vulnérabilités qui font échouer le gate des supprimées (advisories retirés). */
export function splitAudit(auditJson, level) {
    const vulnerabilities = auditJson.vulnerabilities ?? {};
    const threshold = SEVERITY_ORDER.indexOf(level);
    const real = computeRealAtOrAbove(vulnerabilities, level);
    const effective = {};
    const suppressed = {};
    for (const [name, node] of Object.entries(vulnerabilities)) {
        if (real.has(name)) effective[name] = node;
        else if (SEVERITY_ORDER.indexOf(node.severity) >= threshold) suppressed[name] = node;
    }
    return { effective, suppressed, real };
}

function countBySeverity(nodes) {
    const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
    for (const node of Object.values(nodes)) {
        if (node.severity in counts) counts[node.severity] += 1;
    }
    return counts;
}

function npmCliPath() {
    const candidates = [];
    try {
        candidates.push(require.resolve('npm/bin/npm-cli.js'));
    } catch {
        // npm n'est pas dans node_modules : on utilise le npm embarqué avec Node.
    }
    candidates.push(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    candidates.push(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    for (const candidate of candidates) {
        try {
            if (existsSync(candidate)) return candidate;
        } catch {
            // ignore
        }
    }
    return null;
}

function runNpmAudit(prefix, level) {
    // Appel via node + npm-cli.js : pas de shell, pas de warning DEP0190, args passés tels quels.
    const cli = npmCliPath();
    const argv = cli
        ? [process.execPath, cli, 'audit', `--audit-level=${level}`, '--json']
        : ['npm', 'audit', `--audit-level=${level}`, '--json'];
    const result = spawnSync(argv[0], argv.slice(1), {
        cwd: prefix,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        ...(cli ? {} : { shell: process.platform === 'win32' }),
    });
    if (result.error) {
        throw new Error(`Unable to run npm audit in ${prefix}: ${result.error.message}`);
    }
    try {
        return JSON.parse(result.stdout);
    } catch {
        const stderr = (result.stderr ?? '').trim();
        throw new Error(`npm audit did not return JSON in ${prefix} (exit ${result.status}). ${stderr.slice(0, 500)}`);
    }
}

export function evaluate(auditJson, level) {
    const threshold = SEVERITY_ORDER.indexOf(level);
    if (threshold < 0) throw new Error(`Unknown audit level: ${level}`);
    const { effective, suppressed, real } = splitAudit(auditJson, level);
    const counts = countBySeverity(effective);
    const failing = SEVERITY_ORDER.slice(threshold).filter((sev) => counts[sev] > 0);
    return {
        counts,
        failingSeverities: failing,
        failingPackages: Object.entries(effective)
            .filter(([, node]) => SEVERITY_ORDER.indexOf(node.severity) >= threshold)
            .map(([name, node]) => `${name} (${node.severity})`)
            .sort(),
        suppressedCount: Object.keys(suppressed).length,
        suppressedPackages: Object.keys(suppressed).sort(),
        realCount: real.size,
        rawMetadata: auditJson.metadata?.vulnerabilities ?? null,
        pass: failing.length === 0,
    };
}

function parseArgs(argv) {
    const args = { prefix: process.cwd(), level: 'high', selfTest: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--prefix') {
            args.prefix = path.resolve(argv[++i] ?? '');
        } else if (arg === '--audit-level') {
            args.level = String(argv[++i] ?? 'high').toLowerCase();
        } else if (arg === '--self-test') {
            args.selfTest = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return args;
}

function runSelfTest() {
    const withdrawnUrl = WITHDRAWN_ADVISORIES[0].url;
    const synthetic = {
        vulnerabilities: {
            picomatch: { severity: 'high', via: [{ url: withdrawnUrl, severity: 'high', title: 'withdrawn' }] },
            'jest-util': { severity: 'high', via: ['picomatch'] },
            'jest-haste-map': { severity: 'high', via: ['jest-util', '@parcel/watcher'] },
            '@parcel/watcher': { severity: 'high', via: ['picomatch'] },
            'evil-pkg': { severity: 'high', via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'high' }] },
            'mixed-pkg': { severity: 'high', via: ['picomatch', 'evil-pkg'] },
            'glob-like': { severity: 'moderate', via: [{ url: 'https://github.com/advisories/GHSA-gggg-hhhh-iiii', severity: 'moderate' }] },
            'jest-config-like': { severity: 'high', via: ['jest-util', 'glob-like'] },
            'moderate-pkg': { severity: 'moderate', via: [{ url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff', severity: 'moderate' }] },
        },
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 2, high: 6, critical: 0, total: 8 } },
    };

    const assert = (cond, message) => {
        if (!cond) throw new Error(`self-test failed: ${message}`);
    };

    // Seuil high : seuls evil-pkg et mixed-pkg (advisory réel high) échouent.
    // jest-config-like est high uniquement via la chaîne retirée + un chemin moderate réel -> supprimé au seuil high.
    const result = evaluate(synthetic, 'high');
    assert(result.pass === false, 'gate must fail while evil-pkg (real high) remains');
    assert(result.counts.high === 2, `expected 2 effective high (evil-pkg, mixed-pkg), got ${result.counts.high}`);
    assert(result.failingPackages.join(',') === 'evil-pkg (high),mixed-pkg (high)',
        `failing packages wrong: ${result.failingPackages.join(', ')}`);
    assert(result.suppressedCount === 5, `expected 5 suppressed at high (picomatch chain + jest-config-like), got ${result.suppressedCount}`);

    // Sans advisory réel high : pass au seuil high, mais échoue au seuil moderate (chemin réel moderate).
    const withoutEvil = {
        vulnerabilities: {
            picomatch: synthetic.vulnerabilities.picomatch,
            'jest-util': synthetic.vulnerabilities['jest-util'],
            'glob-like': synthetic.vulnerabilities['glob-like'],
            'jest-config-like': synthetic.vulnerabilities['jest-config-like'],
            'moderate-pkg': synthetic.vulnerabilities['moderate-pkg'],
        },
    };
    const cleanHigh = evaluate(withoutEvil, 'high');
    assert(cleanHigh.pass === true, 'gate must pass at level high when only withdrawn high + real moderate remain');
    assert(cleanHigh.suppressedCount === 3, `expected 3 suppressed at high, got ${cleanHigh.suppressedCount}`);

    const atModerate = evaluate(withoutEvil, 'moderate');
    assert(atModerate.pass === false, 'gate at level moderate must fail on real moderate advisories');
    assert(atModerate.failingPackages.includes('glob-like (moderate)')
        && atModerate.failingPackages.includes('jest-config-like (high)')
        && atModerate.failingPackages.includes('moderate-pkg (moderate)'),
        `moderate-level failing packages wrong: ${atModerate.failingPackages.join(', ')}`);

    console.log('[audit-gate] self-test OK');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.selfTest) {
        runSelfTest();
        return;
    }
    const label = path.relative(process.cwd(), args.prefix) || '.';
    const auditJson = runNpmAudit(args.prefix, args.level);
    const result = evaluate(auditJson, args.level);

    console.log(`[audit-gate] scope=${label} level=${args.level}`);
    if (result.rawMetadata) {
        console.log(`[audit-gate] raw npm audit: ${JSON.stringify(result.rawMetadata)}`);
    }
    console.log(`[audit-gate] vulnerabilities at or above '${args.level}' after filtering: ${JSON.stringify(result.counts)}`);
    console.log(`[audit-gate] suppressed (withdrawn advisories only): ${result.suppressedCount} packages via ${
        WITHDRAWN_ADVISORIES.map((entry) => entry.ghsa).join(', ')
    }`);
    if (result.suppressedCount > 0 && process.env.AUDIT_GATE_VERBOSE === '1') {
        console.log(`[audit-gate] suppressed packages: ${result.suppressedPackages.join(', ')}`);
    }
    for (const entry of WITHDRAWN_ADVISORIES) {
        console.log(`[audit-gate] withdrawn allowlist: ${entry.ghsa} (withdrawn ${entry.withdrawnOn}) ${entry.url}`);
    }

    if (!result.pass) {
        console.error(`[audit-gate] FAIL: ${result.failingSeverities.join('+')} vulnerabilities at or above '${args.level}':`);
        for (const pkg of result.failingPackages) console.error(`  - ${pkg}`);
        process.exitCode = 1;
        return;
    }
    console.log(`[audit-gate] PASS: no effective vulnerability at or above '${args.level}' in ${label}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
    try {
        main();
    } catch (error) {
        console.error(`[audit-gate] error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}
