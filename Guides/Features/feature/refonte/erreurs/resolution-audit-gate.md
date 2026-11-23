# Résolution des 2 erreurs CI `npm audit --audit-level=high` (push main, 2026-11-18)

Stacks bruts (supprimés après résolution) : `erreurs.md` (root), `apperror.md` (backend) —
contenu intégralement consigné ci-dessous.

## Cause racine

Aucune dépendance du merge US-J7-06 n'est en cause (`git diff` des manifests/lockfiles vide).
Les 45 vulnérabilités « high » (root) et 35 (backend) proviennent toutes d'un seul advisory :
**GHSA-fc5q-39xc-vjpf** (picomatch ReDoS via extglobs répétés), qui contamine transitivement
tout le graphe jest / vite / tailwind / ts-jest via `picomatch`.

Cet advisory a été **retiré (withdrawn) par GitHub le 2026-11-18**
(https://github.com/advisories/GHSA-fc5q-39xc-vjpf — « Patched versions: None »),
mais le registry npm continue de le servir via `/-/npm/v1/security/advisories/bulk`
(vérifié : id 1247710, `<=4.0.7`, high). picomatch est déjà à sa dernière version (4.0.7) ;
les « fixes » proposées par npm sont des changements majeurs cassants (jest@30.2.0,
ts-jest@26.5.6 en downgrade, tailwindcss@4.3.5, vite@6.2.7), déjà refusés par le projet
(voir `Guides/Features/feature/suivi/j6-validation-report.md`).

## Correctif (agent 04-cicd-installation)

- Nouveau gate `scripts/ci/audit-gate.mjs` : lance `npm audit --audit-level=high --json`,
  puis supprime du gate les packages dont toute la chaîne d'advisories à sévérité >= seuil
  mène exclusivement à des advisories **retirés par leur éditeur** (allowlist documentée :
  GHSA, date de retrait, URL, raison — actuellement GHSA-fc5q-39xc-vjpf seul).
  Le gate reste STRICT : toute vulnérabilité high/critical restante (non retirée) fait
  échouer le job (exit 1). Self-test : `node scripts/ci/audit-gate.mjs --self-test`.
- Câblage : `.github/workflows/security.yml` (jobs `npm-audit-root`, `npm-audit-backend`),
  `.github/workflows/deploy.yml` (étapes preflight), `npm run audit:all` (root) et
  `npm run audit:deps` (backend) pointent désormais sur le gate.
  `audit:root` / `audit:backend` restent le npm audit brut pour le diagnostic.

## Résultats (2026-11-18, Node 24.22.1)

- `node scripts/ci/audit-gate.mjs` → PASS (raw: 4 moderate + 45 high; 45 high supprimés car
  advisory retiré; 0 high effectif)
- `node scripts/ci/audit-gate.mjs --prefix backend` → PASS (raw: 1 low + 8 moderate + 36 high;
  36 high supprimés; 0 high effectif)
- `npm run audit:all` → exit 0 ; `cd backend && npm run audit:deps` → exit 0
- `--self-test` → OK (vérifie qu'un advisory réel high fait toujours échouer le gate)
- `npm run audit:workflow-architecture:strict` → OK ; `npm run ci:node25:runtime` → PASS

## Suivi

- Quand npm retirera GHSA-fc5q-39xc-vjpf de sa base bulk, l'entrée de l'allowlist pourra
  être supprimée (le gate repasse alors sur le npm audit brut, toujours strict).
- Les vulnérabilités moderate restantes (glob/minimatch GHSA-3g3m-2fjr-6pw4 / GHSA-g3hv-75wg-m249,
  qs, fast-xml-parser) ne fail pas le seuil high ; lot de remédiation séparé
  (`Guides/TODO/INSTALL_FIXES/NPM_AUDIT_REMEDIATION_LOT.md`), aucun `npm audit fix --force`.
