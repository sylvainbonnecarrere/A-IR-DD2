Deux problèmes bien distincts. Laisse-moi chercher les informations à jour sur les deux.Parfait, j'ai tout ce qu'il faut. Deux problèmes indépendants, deux solutions claires.

---

## Problème 1 — Rootless sur Windows/Docker Desktop : c'est architecturalement impossible

L'application doit être installable quel que soit l'OS et elle est actuellement testée sur windows. C'est le point fondamental que tu as raté. Docker Desktop sur Windows utilise un named pipe `npipe:////./pipe/docker_engine` et non un socket Unix. Or, le mode rootless Docker attend obligatoirement un contexte `rootless` et un `DOCKER_HOST=unix:///run/user/<uid>/docker.sock` — un daemon Linux utilisateur tournant dans un user namespace.

**Ce n'est donc pas un bug de détection à corriger, c'est une impossibilité de plateforme.** Docker Desktop est par nature un daemon "rootful" piloté en root dans une VM Linux interne. Il ne peut pas passer le test rootless.

### La bonne architecture : détection contextuelle par environnement

Il faut distinguer 3 cas dans ton service de health-check :

```typescript
// services/runtime-health.service.ts

export type RuntimeMode = 'rootless' | 'docker-desktop' | 'rootful-linux' | 'unknown';

interface RuntimeStatus {
  mode: RuntimeMode;
  healthy: boolean;       // l'app peut-elle tourner ?
  securityLevel: 'high' | 'medium' | 'low';
  warning?: string;
}

export async function detectRuntime(): Promise<RuntimeStatus> {
  // 1. Détection Docker Desktop (Windows / macOS)
  const context = await runCmd('docker', ['context', 'show']);
  const endpoint = await runCmd('docker', [
    'context', 'inspect', context.trim(),
    '--format', '{{.Endpoints.docker.Host}}'
  ]);

  if (endpoint.includes('npipe://') || endpoint.includes('desktop-linux')) {
    return {
      mode: 'docker-desktop',
      healthy: true,                  // ✅ fonctionnel, juste pas rootless
      securityLevel: 'medium',
      warning: 'Docker Desktop détecté : isolation via VM Linux (pas de rootless natif). ' +
               'Acceptable en dev/test, déconseillé en production Linux.'
    };
  }

  // 2. Détection rootless Linux (SecurityOptions JSON)
  const secOpts = await runCmd('docker', [
    'info', '--format', '{{json .SecurityOptions}}'
  ]);
  if (secOpts.includes('"name=rootless"')) {
    return { mode: 'rootless', healthy: true, securityLevel: 'high' };
  }

  // 3. Fallback : socket XDG (rootless sans SecurityOptions visible)
  const uid = process.getuid?.() ?? 1000;
  const xdgSocket = `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`}/docker.sock`;
  if (await fileExists(xdgSocket)) {
    return { mode: 'rootless', healthy: true, securityLevel: 'high' };
  }

  // 4. Linux rootful classique
  return {
    mode: 'rootful-linux',
    healthy: true,
    securityLevel: 'low',
    warning: 'Daemon Docker rootful. Envisager le mode rootless en production.'
  };
}

async function runCmd(cmd: string, args: string[]): Promise<string> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  try {
    const { stdout } = await promisify(execFile)(cmd, args);
    return stdout;
  } catch {
    return '';
  }
}

async function fileExists(path: string): Promise<boolean> {
  const fs = await import('fs/promises');
  return fs.access(path).then(() => true).catch(() => false);
}
```

Et dans ton endpoint `/health`, tu changes le comportement :

```typescript
// routes/python.ts
router.get('/health', async (_req, res) => {
  const runtime = await detectRuntime();
  
  // healthy = true sur Docker Desktop aussi
  res.status(runtime.healthy ? 200 : 503).json({
    status: runtime.healthy ? 'ok' : 'error',
    mode: runtime.mode,
    securityLevel: runtime.securityLevel,
    ...(runtime.warning && { warning: runtime.warning })
  });
});
```

**Résultat :** sur Windows, le health-check retourne `200 OK` avec `mode: "docker-desktop"` au lieu de bloquer en `unhealthy`.

---

## Problème 2 — Vulnérabilités dans `node:22-bookworm-slim`

Le diagnostic Docker DX est correct. Un scan Trivy de `gcr.io/distroless/nodejs22-debian12` donne seulement 15 vulnérabilités (0 HIGH, 0 CRITICAL), contre des centaines pour `node:22-bookworm-slim`.

La solution est un **build multi-stage** : on garde `node:22-bookworm-slim` uniquement pour builder/installer les dépendances, et on utilise l'image **distroless** pour l'exécution finale.

La dernière image distroless Node.js recommandée en 2026 est `gcr.io/distroless/nodejs22-debian13` (debian13 = Trixie, sorti fin 2025).

```dockerfile
# docker/runtime/node/Dockerfile

# ── Stage 1 : build (image avec vulnérabilités, jamais exposée) ──────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
# Si tu as un step TypeScript/bundling :
# RUN npm run build

# ── Stage 2 : runtime (distroless, 0 HIGH CVE) ───────────────────────────────
# debian13 = Trixie — image la plus récente et patchée en mars 2026
FROM gcr.io/distroless/nodejs22-debian13:nonroot

WORKDIR /app

# Copie uniquement les artefacts compilés et les dépendances prod
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
# ou COPY --from=builder /app/src ./src si pas de build step

# nonroot = UID 65532 — utilisateur non-root par défaut de l'image distroless
# Pas besoin de USER nonroot, c'est déjà le default du tag :nonroot

EXPOSE 3000
CMD ["dist/index.js"]
```

> **Attention :** l'image distroless n'a pas de shell, donc `child_process.exec()` ne fonctionnera pas — utilise `child_process.execFile()` partout dans ton code Node (ce que tu faisais déjà dans `pythonRunner.js`, c'est bon).

---

## Récapitulatif des deux corrections

| Problème | Diagnostic réel | Fix |
|---|---|---|
| `runtime: unhealthy` sur Windows | Docker Desktop ne supporte PAS le mode rootless — c'est normal | Détecter `npipe://` / `desktop-linux` et retourner `healthy: true` avec `mode: docker-desktop` |
| 10 HIGH CVE sur `node:22-bookworm-slim` | L'image contient des paquets OS inutiles en runtime | Build multi-stage : builder sur `bookworm-slim`, runner sur `distroless/nodejs22-debian13:nonroot` |