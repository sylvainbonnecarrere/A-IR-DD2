Je n’ai pas exécuté npm audit ni les tests, et je n’ai pas pu valider ici la version effectivement verrouillée de chaque dépendance.

Priorité critique — remplacer Node 25
Dans le README, .nvmrc, .node-version et les deux package.json, le projet est configuré pour Node 25.9.0. Or la branche Node 25 est EOL depuis le 1er juin 2026 et ne reçoit plus les correctifs de sécurité. Les dernières mises à jour Node.js du 21 octobre corrigent notamment une vulnérabilité haute du décodeur Brotli pouvant mener à une corruption mémoire, ainsi que des problèmes DNS et TLS. Mettre à jour npm ou Axios ne corrige pas une vulnérabilité intégrée au binaire Node. 
nodejs.org
nodejs.org

Je recommande de migrer vers Node 24.22.1 LTS, dernière version LTS indiquée au 27 octobre 2026, puis de modifier et tester tous les points de versionnement :

.nvmrc et .node-version ;
engines.node dans les deux package.json ;
le script de vérification ci:node25:runtime, les workflows CI et les images Docker ;
les consignes d’installation et les guides qui exigent Node 25.9.0 ;
les types Node du backend : @types/node est actuellement en version 26.x, à aligner avec le runtime retenu.
Il faut ensuite régénérer les deux lockfiles et exécuter les tests du dépôt sur le runtime cible.

Priorité élevée — renforcer les installations npm
Les manifestes contiennent des plages de versions (^) : c’est normal avec un lockfile, mais les installations et mises à jour doivent s’appuyer sur ce lockfile. Le README recommande actuellement npm install ; pour une installation reproductible, remplacez cette instruction par `npm ci à la racine et dans backend. Les scripts audit:root, audit:backend et audit:all existent déjà : assurez-vous que l’audit est exécuté en CI et bloque au minimum les vulnérabilités de sévérité élevée.

Ajoutez aussi un délai avant d’accepter les nouvelles versions npm, par exemple min-release-age=3 dans un .npmrc versionné. Cette option requiert npm 11.10.0 ou ultérieur ; vérifiez la version npm dans la CI, car une CLI plus ancienne pourrait ne pas appliquer le réglage. La documentation npm décrit ce délai en jours. 
npmjs.com

Pour réduire le risque d’une publication compromise avec un script d’installation :

faites examiner tout nouveau paquet introduit dans un lockfile, surtout s’il exécute un script d’installation ;
utilisez une politique d’autorisation explicite pour ces scripts plutôt que de les désactiver aveuglément : le backend dépend notamment de composants natifs susceptibles d’en avoir besoin ;
ajoutez une revue du lockfile et un contrôle des signatures/provenances disponibles.
Axios — vérifier le lockfile avant de décider d’un changement
Le manifeste racine déclare axios: ^1.16.0. Les versions Axios compromises signalées en mars 2026 étaient 1.14.1 et 0.30.4 ; cette plage déclarée ne les accepte pas. Je ne peux toutefois pas conclure que l’installation est saine sans confirmer les versions résolues dans les deux lockfiles et vérifier l’arbre installé. 
GitHub

À lancer dans les deux répertoires :

bash


npm ci
npm audit --audit-level=high
npm ls axios plain-crypto-js --all
npm audit signatures
Vérifiez aussi dans package-lock.json et backend/package-lock.json l’absence d’Axios 1.14.1/0.30.4 et de plain-crypto-js@4.2.1. Si une machine ou un runner a installé ces versions pendant la fenêtre de compromission du 31 mars, traitez cela comme un incident d’approvisionnement logiciel : enquête sur l’environnement et rotation des secrets potentiellement exposés.

En bref : migrer immédiatement hors de Node 25 vers Node 24.22.1 LTS ; remplacer les installations documentées par npm ci ; faire appliquer audits, délai de publication et revue des scripts en CI ; puis confirmer les versions Axios réelles dans les lockfiles. Cette revue est ciblée sur Node/npm : elle ne constitue pas un audit complet du backend ni de l’isolation Docker des fonctions utilisateur.