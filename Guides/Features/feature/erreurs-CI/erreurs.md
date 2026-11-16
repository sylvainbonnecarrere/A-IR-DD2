## État au 16 novembre 2026

Le workflow Runtime a réussi après correction : [exécution GitHub Actions](https://github.com/sylvainbonnecarrere/A-IR-DD2/actions/runs/43883144675). Le rapport `runtime-scan-report` est conservé comme artefact pendant 14 jours.

- [x] Reproduire les scans des trois images : CVE-2026-109518 affectait `apt` et `libapt-pkg6.0t64` en version `2.8.3`.
- [x] Actualiser les digests et les paquets concernés vers `2.8.4ubuntu0.1`, puis reconstruire et rescanner.
- [x] Conserver les détails du scan dans les workflows Runtime et de déploiement, sans baisser le seuil HIGH.
- [x] Corriger les avis élevés Mongoose : `8.24.4` vers `8.24.9`.
- [x] Vérifier le workflow Runtime GitHub : build et scan des images, rapport et tranche Node 24 réussis.

Le message et le diagnostic ci-dessous sont conservés comme historique : le rapport initial ne permettait pas, à lui seul, d'identifier les CVE.

## Erreur initiale

Message d'erreur : 16s
Run npm --prefix backend run runtime:scan

> llm-agent-workflow-backend@1.0.0 runtime:scan
> node scripts/runtime/scan-runtime.cjs --fail-on-severity=high

◇ injected env (0) from .env // tip: ◈ secrets for agents [www.dotenvx.com]
Runtime scan: unhealthy
- [healthy] Docker CLI: Docker disponible (29.4.2)
- [healthy] Scanner local: Trivy détecté
- [unhealthy] Node.js runtime: CVE critical/high détectées via Trivy.
- [unhealthy] Python runtime: CVE critical/high détectées via Trivy.
- [unhealthy] Python provisioning image: CVE critical/high détectées via Trivy.
Error: Process completed with exit code 1.


Diagnostic : La CI échoue parce que le scanner a trouvé des vulnérabilités HIGH ou CRITICAL dans trois cibles : le runtime Node.js, le runtime Python et l’image de provisioning Python. Le script est configuré pour faire échouer le job à ce seuil ; le code de sortie 1 est donc le comportement attendu du garde-fou, pas la cause première. Trivy permet explicitement de faire échouer une analyse selon les sévérités configurées. 
trivy.dev

Le rapport fourni ne contient ni identifiants CVE, ni versions de paquets, ni image/tag concerné. Il ne permet donc pas de désigner précisément les dépendances à mettre à jour. Le README du projet décrit une application Node.js avec des fonctions Python et des sandboxes Docker : il faut vérifier les images et dépendances effectivement scannées, pas se limiter aux dépendances npm de l’application.

Brief à transmettre à l’agent d’implémentation
text


Objectif : corriger l’échec de `npm --prefix backend run runtime:scan` sans affaiblir la politique de sécurité.

1. Examiner `backend/scripts/runtime/scan-runtime.cjs` et retrouver, pour chacune des trois cibles en échec (Node.js runtime, Python runtime, Python provisioning image) :
   - la commande Trivy exacte ;
   - le nom et le tag ou digest de l’image, s’il s’agit d’une image ;
   - le rapport Trivy détaillé, notamment CVE, sévérité, paquet, version installée et version corrigée ;
   - si le finding vient d’un paquet OS, d’une dépendance applicative ou d’une image de base.

2. Reproduire le scan et conserver les rapports détaillés comme artefacts/logs CI si le script ne les rend pas déjà accessibles. Ne pas déduire les CVE à partir du résumé « CVE critical/high ».

3. Corriger les vulnérabilités à leur source :
   - mettre à jour les images de base Node/Python vers des versions maintenues et corrigées, en respectant le runtime Node déclaré par le projet ;
   - mettre à jour les paquets OS dans les Dockerfiles/images si les findings les concernent ;
   - mettre à jour les dépendances npm/pip et leurs lockfiles si les findings proviennent de ces dépendances ;
   - reconstruire les images et vérifier qu’elles utilisent bien les versions corrigées.

4. Ne pas contourner le contrôle :
   - ne pas supprimer `--fail-on-severity=high` ;
   - ne pas ignorer globalement les CVE, ni masquer les findings avec un changement de configuration ;
   - si une exception est réellement nécessaire faute de correctif, la limiter aux CVE précises, documenter la justification, le périmètre et une date d’expiration, et la faire approuver.

5. Validation :
   - relancer `npm --prefix backend run runtime:scan` et vérifier que les trois cibles passent ;
   - exécuter les tests/runtime checks pertinents et les vérifications CI existantes ;
   - fournir dans le PR les CVE traitées, les versions avant/après et les sorties de validation.
En bref : le correctif attendu est de mettre à jour les images et/ou dépendances vulnérables identifiées dans les rapports détaillés, puis de rescanner. Un changement de seuil pourrait rendre le job vert tout en laissant les vulnérabilités présentes ; ce n’est pas une résolution.