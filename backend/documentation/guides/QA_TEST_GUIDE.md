# QA TEST GUIDE - Pre-Push Validation

**Version**: 2.0  
**Date**: March 25, 2026  
**Scope**: Frontend + backend pre-push QA validation  

---

## Purpose

Ce guide décrit les vérifications minimales à exécuter avant un commit/push sur le dépôt A-IR-DD2, avec un focus sur les suites Jest, les rapports de non-régression et les contrôles backend critiques.

---

## Automated Test Commands

### Frontend

```bash
npm test
npm run test:coverage
npm run test:settingsmodal:report
```

### Backend

```bash
cd backend
npm test
npm run test:coverage
```

---

## Report Artifacts Convention

- Les artefacts de rapports Jest ne doivent pas être générés à la racine du dépôt.
- Les sorties ciblées doivent être écrites sous `tests/temp_rapport_tests/` dans un sous-dossier cohérent avec la suite concernée.
- Pour SettingsModal, le chemin canonique est `tests/temp_rapport_tests/unitaires/settingsmodal/`.

Commande dédiée:

```bash
npm run test:settingsmodal:report
```

Artefacts générés:

- `tests/temp_rapport_tests/unitaires/settingsmodal/settingsmodal-jest.out`
- `tests/temp_rapport_tests/unitaires/settingsmodal/settingsmodal-jest.exit`

Les anciens fichiers historiques `settingsmodal-jest-2.out` et `settingsmodal-jest-2.exit` peuvent être conservés dans le même dossier à titre de trace de diagnostic, mais ne doivent plus être générés à la racine.

---

## Critical Backend Checks

Avant push backend, vérifier au minimum:

```bash
curl http://localhost:3001/api/health
```

Attendus:

- backend démarré sans erreur fatale
- pas de warning bloquant sur la base ou les index
- routes protégées répondent proprement en `401` ou `403`, jamais en `500` pour un cas de validation attendu

---

## Recommended Targeted Regressions

### Frontend runtime / modal

```bash
npx jest tests/unitaires/SettingsModal.TNR.test.ts --runInBand --verbose
npx jest tests/services/lmStudioService.test.ts --runInBand --verbose
```

### Backend local runtime / proxy

```bash
cd backend
npx jest src/__tests__/lmstudioProxy.service.test.ts --runInBand --verbose
npx jest src/__tests__/localEndpointAccess.service.test.ts --runInBand --verbose
```

---

## Manual QA Checklist

- Vérifier que les profils LLM locaux configurés en UI fonctionnent encore après authentification.
- Vérifier qu’un endpoint non autorisé renvoie une erreur explicite, pas `Unknown error`.
- Vérifier que l’ouverture de la modal LLM n’entraîne plus de boucle de rendu.
- Vérifier qu’aucun artefact temporaire n’est recréé à la racine du dépôt après exécution des tests ciblés.
- Vérifier que `backend/storage/workspaces/users/` ne remonte plus dans les fichiers à committer.

---

## Pre-Push Acceptance

Le dépôt est prêt pour push quand les conditions suivantes sont vraies:

- `npm test` est vert côté frontend
- `cd backend && npm test` est vert côté backend
- les rapports Jest sont rangés sous `tests/temp_rapport_tests/`
- aucun dossier utilisateur sous `backend/storage/workspaces/users/` n’apparaît dans le diff Git
- README et guides QA reflètent les commandes réellement supportées par le projet

---

**Maintenu par**: ARC-1  
**Dernière mise à jour**: 2026-03-25
