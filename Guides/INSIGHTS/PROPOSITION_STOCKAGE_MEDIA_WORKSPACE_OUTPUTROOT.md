# Proposition - Projection du stockage media workflow-scope vers Workspace.outputRoot

Date: 17 mars 2026
Statut: Proposition d'architecture, hors perimetre immediat du J4/J5

## Contexte

Pendant l'audit du J4, une piste d'alignement architectural a ete identifiee autour du stockage des medias workflow-scope.

L'application supporte aujourd'hui plusieurs modes de stockage:

1. stockage en base de donnees
2. stockage local sur systeme de fichiers
3. stockage cloud

Pour le stockage local, certains medias workflow-scope suivent un layout legacy de type:

```text
storage/users/{userId}/workflows/{workflowId}/agents/{agentInstanceId}/{YYYY-MM}/{filename}
```

En parallele, le Plan 1 a introduit un contrat workspace avec separation explicite:

1. `sourceRoot`
2. `manifestsRoot`
3. `buildRoot`
4. `outputRoot`

Le sujet remonte parce que `Workspace.outputRoot` devient la zone logique cible pour les outputs gouvernes, alors qu'une partie des medias continue a vivre sur un layout legacy distinct.

## Interet de la proposition

Cette piste n'est pas a implementer maintenant, mais elle presente un interet architectural reel:

1. reduire le nombre d'autorites concurrentes sur les chemins de sortie
2. aligner les outputs applicatifs sur le contrat workspace deja etabli par le J4
3. preparer une abstraction plus propre entre stockage local et stockage cloud
4. simplifier a terme les operations de lifecycle, cleanup, backup et restauration

## Pourquoi ce sujet est remis a plus tard

Ce point est volontairement sorti du chantier J4/J5 pour trois raisons:

1. il est un peu hors sujet par rapport a l'objectif immediat du J5, qui est le `BuildService` separe du run
2. il necessite une reflexion plus large car l'application propose deja trois strategies de stockage differentes
3. il ne doit pas provoquer de derive de perimetre alors que le plan officiel ne l'a pas explicitement inscrit comme livrable immediat

## Forme d'evolution envisageable

La bonne approche, si elle est retenue plus tard, serait une projection additive et non un cutover brutal:

1. conserver la compatibilite avec les chemins legacy existants
2. introduire une couche de resolution capable de projeter vers `Workspace.outputRoot`
3. eviter toute migration big bang des fichiers deja presents
4. laisser le frontend consommer un contrat stable, independant du layout physique reel

## Position par rapport au Plan 1

Cette idee est:

1. coherente avec le Plan 1
2. interessante pour la suite
3. non bloquante pour la cloture du J4
4. non prioritaire pour le demarrage du J5

## Conclusion

La proposition doit etre conservee comme insight de conception.

Elle pourra etre reouverte plus tard lorsqu'un chantier dedie au stockage des outputs et medias sera explicitement cadre, en tenant compte a la fois:

1. du contrat workspace
2. de la pluralite des backends de stockage
3. des contraintes de compatibilite legacy