J’ai examiné la branche main et ses manifestes npm à la date demandée, le 28/10/2026. Voici un premier triage, pas une certification d’absence de vulnérabilités : un package.json donne des plages de versions, alors que le risque réel dépend des versions exactes verrouillées et des dépendances transitives dans chaque package-lock.json.

Tailwind : version ancienne, mais pas une preuve de vulnérabilité. Le projet déclare tailwindcss 3.4.19 ; c’est la branche 3, alors que la documentation actuelle présente Tailwind 4.x. Une migration vers la version majeure actuelle peut être pertinente, mais elle peut entraîner des changements de configuration et n’est pas, à elle seule, un correctif de sécurité. Le point à contrôler est notamment PostCSS : l’avis CVE-2026-41305 concerne les versions antérieures à 8.5.10. Le manifeste racine déclare postcss ^8.5.26, donc la plage permet une version corrigée ; il faut néanmoins vérifier que le lockfile installe bien une version au moins égale à 8.5.10. 
GitHub

Dépendance transitive à vérifier : nanoid. L’avis CVE-2026-73086 affecte nanoid avant 3.3.12 et certaines versions 4.x, avec correctifs en 3.3.12 et 5.1.11. Comme nanoid peut apparaître dans l’arbre de dépendances de l’outillage CSS, vérifiez toutes ses occurrences, pas seulement les dépendances directes. Je ne peux pas confirmer à partir des extraits consultés quelle version exacte votre lockfile installe. 
GitHub

Backend : Mongoose. Le manifeste déclare mongoose ^8.24.1. L’avis CVE-2026-42334 concerne les versions 8 jusqu’à 8.22.0 ; la version correctrice de la branche 8 est 8.22.1. La plage déclarée est donc au-dessus de ce seuil, si la version effectivement installée suit bien cette plage. À noter qu’une version 8.24.7, publiée le 23 octobre, contient aussi des correctifs de sécurité pertinents autour des propriétés héritées et de mquery ; vérifiez la version résolue dans backend/package-lock.json et envisagez de mettre à jour le lockfile. 
GitHub
1

Je ne conclurais donc pas que Tailwind est vulnérable simplement parce qu’il est en v3, ni que toutes les dépendances sont à jour. Pour vérifier l’arbre npm complet réellement verrouillé, exécutez depuis une copie propre du dépôt :

bash


npm ci
npm audit --json
npm ls tailwindcss postcss nanoid mongoose

cd backend
npm ci
npm audit --json
npm ls postcss nanoid mongoose
Pour ne pas manquer les alertes de sévérité faible ou modérée, examinez aussi le rapport JSON complet, pas seulement le code de sortie d’un audit configuré avec un seuil high. N’appliquez pas npm audit fix --force sans revue : cela peut introduire des mises à niveau majeures incompatibles. Après correction, relancez les tests et reconstruisez les images Docker. Ces commandes vérifient les dépendances npm ; elles ne couvrent pas les paquets Python, les images de conteneurs ni les bibliothèques système.

En dehors des packages, un point mérite une vérification immédiate : la documentation de lancement du dépôt publie un compte de test avec un mot de passe par défaut. Assurez-vous qu’il ne peut pas être activé en production et qu’il est supprimé ou désactivé dans tout environnement exposé.