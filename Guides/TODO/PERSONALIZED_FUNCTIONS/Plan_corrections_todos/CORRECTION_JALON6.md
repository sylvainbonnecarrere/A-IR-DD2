Voici un briefing technique complet que tu peux copier-coller directement à ton agent.

---

## Briefing pour l'agent — Recadrage architecture sandbox

### Constat sur ton travail actuel

Tu as résolu le problème de CVE visible dans VS Code Problems en remplaçant `node:22-bookworm-slim` par `gcr.io/distroless/nodejs22-debian13:nonroot`. C'est une amélioration réelle sur la surface CVE, mais **tu as résolu le mauvais problème avec le mauvais outil sur le mauvais container.**

Voici pourquoi, et ce qu'il faut faire à la place.

---

### Erreur 1 — Distroless sur une sandbox d'exécution de code arbitraire

Ce container Node n'est **pas** un runtime applicatif. Il sert à deux choses :
1. Exécuter des tools TypeScript/Node soumis par des agents IA
2. Permettre aux utilisateurs d'écrire, tester et modifier du code dans l'UI

Pour ce type de workload, distroless est le **mauvais choix** pour deux raisons indépendantes :

**Raison 1 — Debugging cassé.** Sans shell, les commandes suivantes ne fonctionnent plus :
```bash
# Ces commandes échouent silencieusement sur distroless
docker exec -it <container> /bin/sh     # exec: "sh": not found
docker exec -it <container> node        # impossible sans shell
docker exec -it <container> ls /sandbox # impossible
```
En phase de développement actif, c'est rédhibitoire. Tu ne peux pas inspecter l'environnement d'exécution, vérifier les modules disponibles, ou reproduire un bug interactif.

**Raison 2 — Distroless n'est pas le bon modèle de sécurité pour du code arbitraire.** Distroless réduit la surface CVE de l'image, mais le vrai vecteur d'attaque ici c'est le code exécuté à l'intérieur — pas les paquets de l'image. Un agent IA peut générer du code qui exploite les syscalls du kernel hôte, et distroless ne protège pas contre ça. C'est une fausse sécurité pour ce cas d'usage.

**Action requise :** Revenir à `node:22-bookworm-slim` pour les deux containers sandbox, avec durcissement ciblé :

```dockerfile
# docker/runtime/node/Dockerfile
FROM node:22-bookworm-slim

# Supprimer les paquets qui génèrent des CVE sans valeur fonctionnelle
RUN apt-get update && apt-get purge -y --auto-remove \
    perl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Utilisateur non-root — cohérent avec python-sandbox (UID 10001)
RUN useradd --uid 10001 --create-home \
    --home-dir /home/sandbox \
    --shell /usr/sbin/nologin sandbox \
    && mkdir -p /sandbox/workspace /sandbox/output /sandbox/tmp \
    && chown -R sandbox:sandbox /sandbox /home/sandbox

WORKDIR /sandbox/workspace
USER sandbox

ENV NODE_ENV=production \
    HOME=/home/sandbox

CMD ["node", "--version"]
```

Ce Dockerfile est délibérément symétrique avec `python-sandbox` : même UID, même structure de répertoires, même shell `nologin`. C'est voulu pour la cohérence opérationnelle.

---

### Erreur 2 — La vraie sécurité sandbox n'est pas dans l'image Docker

Le CVE Problems dans VS Code disparaît avec distroless, mais ce n'est pas l'indicateur de sécurité pertinent pour ce projet. La vraie architecture de sécurité cible est **Firecracker microVM**.

**Pourquoi Firecracker et pas juste Docker + seccomp :**

Docker containers partagent le kernel hôte. Plusieurs CVE runc récents (2024-2025) ont démontré des race conditions permettant d'écrire sur des chemins protégés de l'hôte depuis l'intérieur d'un container. Pour un workload qui exécute du code arbitraire généré par des agents IA, ce modèle de sécurité est insuffisant en production.

Firecracker crée une microVM légère avec son propre kernel guest via KVM — une frontière hardware, pas logicielle. C'est exactement pour ce cas d'usage qu'AWS l'a conçu (Lambda, Fargate).

**Contrainte connue et gérée :** Firecracker nécessite Linux + KVM. Sur Windows + Docker Desktop, KVM n'est pas disponible. C'est normal et anticipé. L'architecture utilise une factory d'abstraction :

```typescript
// services/sandbox/ISandboxRunner.ts
export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface ISandboxRunner {
  run(code: string, language: 'python' | 'node'): Promise<SandboxResult>;
  healthCheck(): Promise<{ available: boolean; mode: string }>;
}
```

```typescript
// services/sandbox/SandboxFactory.ts
import { DockerSandboxRunner } from './DockerSandboxRunner';
import { FirecrackerSandboxRunner } from './FirecrackerSandboxRunner';
import { detectRuntime } from '../runtime-health.service';
import { access } from 'fs/promises';

async function isKVMAvailable(): Promise<boolean> {
  return access('/dev/kvm').then(() => true).catch(() => false);
}

export async function createSandboxRunner(): Promise<ISandboxRunner> {
  const runtime = await detectRuntime();

  if (runtime.mode !== 'docker-desktop' && await isKVMAvailable()) {
    console.log('🔥 Sandbox : Firecracker microVM');
    return new FirecrackerSandboxRunner();
  }

  // Fallback explicite et documenté — pas un état dégradé silencieux
  console.warn('⚠️  Sandbox : Docker container — mode dev/Windows uniquement');
  return new DockerSandboxRunner();
}
```

```typescript
// services/sandbox/DockerSandboxRunner.ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class DockerSandboxRunner implements ISandboxRunner {
  private getImage(language: 'python' | 'node'): string {
    return language === 'python' ? 'python-sandbox:latest' : 'node-sandbox:latest';
  }

  async run(code: string, language: 'python' | 'node'): Promise<SandboxResult> {
    const start = Date.now();
    const image = this.getImage(language);
    const entrypoint = language === 'python' ? 'python3' : 'node';

    const args = [
      'run', '--rm',
      '--network=none',
      '--memory=128m',
      '--cpus=0.5',
      '--read-only',
      '--tmpfs', '/sandbox/tmp:size=64m,noexec',
      '--security-opt=no-new-privileges',
      '--cap-drop=ALL',
      image,
      entrypoint, '-c', code
    ];

    try {
      const { stdout, stderr } = await execFileAsync('docker', args, {
        timeout: 10000,
        maxBuffer: 1024 * 1024
      });
      return { stdout, stderr, exitCode: 0, durationMs: Date.now() - start };
    } catch (err: any) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message,
        exitCode: err.code ?? 1,
        durationMs: Date.now() - start
      };
    }
  }

  async healthCheck() {
    return { available: true, mode: 'docker' };
  }
}
```

```typescript
// services/sandbox/FirecrackerSandboxRunner.ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class FirecrackerSandboxRunner implements ISandboxRunner {
  async run(code: string, language: 'python' | 'node'): Promise<SandboxResult> {
    const start = Date.now();
    const image = language === 'python' ? 'python-sandbox:latest' : 'node-sandbox:latest';
    const entrypoint = language === 'python' ? 'python3' : 'node';

    // firecracker-containerd — runtime io.containerd.runtime.v2.firecracker
    const { stdout, stderr } = await execFileAsync('ctr', [
      'run', '--rm',
      '--runtime', 'aws.firecracker',
      '--memory-limit', '134217728',  // 128 MiB
      '--network-config', 'none',
      image,
      `sandbox-${Date.now()}`,
      entrypoint, '-c', code
    ], { timeout: 10000 });

    return {
      stdout, stderr,
      exitCode: 0,
      durationMs: Date.now() - start
    };
  }

  async healthCheck() {
    const available = await access('/dev/kvm').then(() => true).catch(() => false);
    return { available, mode: 'firecracker' };
  }
}
```

---

### Erreur 3 — Le statut `degraded` ne doit pas être silencieux

Le runtime `executionReady` avec `degraded` sur Windows est correct comme comportement, mais il doit être **explicitement documenté dans les logs et l'UI**, pas juste un état interne. Assure-toi que :

```typescript
// Dans runtime-health.service.ts — la réponse health doit indiquer clairement le mode
{
  status: 'ok',               // l'app tourne
  executionReady: true,       // le code peut s'exécuter
  mode: 'docker-desktop',     // pas rootless, pas Firecracker
  securityLevel: 'dev-only',  // explicite : ce niveau ne va pas en production
  warning: 'Docker Desktop détecté. Firecracker indisponible (pas de KVM). ' +
           'Ce mode est acceptable pour le développement local uniquement.'
}
```

---

### Résumé des directives

| Action | Priorité |
|---|---|
| Revenir à `node:22-bookworm-slim` + purge `perl xz-utils` | Immédiate |
| Aligner le Dockerfile Node sur la structure de Python sandbox (UID 10001, `/sandbox/*`) | Immédiate |
| Implémenter `ISandboxRunner` + `SandboxFactory` avec fallback Docker/Firecracker | Sprint en cours |
| Implémenter `DockerSandboxRunner` avec flags d'isolation (`--network=none`, `--cap-drop=ALL`, etc.) | Sprint en cours |
| Préparer `FirecrackerSandboxRunner` (testé en CI Linux) | Prochain sprint |
| Documenter explicitement `securityLevel: 'dev-only'` dans le health-check Windows | Immédiate |

Le warning VS Code Problems sur `node:22-bookworm-slim` reviendra — c'est **acceptable et documenté**. La sécurité réelle vient de l'isolation runtime (Firecracker/Docker flags), pas de l'absence de CVE dans l'image de base d'une sandbox.