# Bilan et Instructions pour les POCs de Pages Robots

Ce document synthétise les apprentissages issus des premiers POCs (Menus, Bases de Données, API) et définit le protocole strict pour la réalisation des prochaines pages de l'application.

## 1. Résumé des Réalisations

*   **Menus Robots** : Mise en place de la navigation contextuelle par robot avec icônes et descriptions.
*   **COM > Bases de Données** : Interface de configuration multi-provider (Oracle, Mongo, etc.) avec formulaires dynamiques.
*   **COM > Connexions API** : Interface avancée type "N8N" avec vue scindée (Config / Réponse) et visualisation JSON.

## 2. Retrospective : Erreurs et Réussites

### ✅ Ce qui fonctionne bien
*   **Inspiration Métier** : S'appuyer sur des références solides (N8N, Postman) permet d'avoir une UX pertinente immédiatement.
*   **Interactivité** : L'usage de formulaires dynamiques et de feedbacks visuels (toasts, états de chargement) rend le POC crédible.
*   **Architecture Modulaire** : La séparation des composants (ex: `JsonViewer`, `ConfigPanel`) facilite la maintenance.

### ⚠️ Points de vigilance (Erreurs rencontrées)
*   **Layout Bloquant (Critique)** : L'utilisation de positionnement `fixed` ou `absolute inset-0` a parfois recouvert le Header et la Sidebar, bloquant la navigation globale.
*   **Incohérence Graphique** : Disparités de styles (boutons, inputs) entre les pages.
*   **Oubli des Traductions** : Textes hardcodés au lieu d'utiliser le système `i18n`.
*   **Manque de Scroll** : Contenu tronqué sur petits écrans par manque de gestion de l'overflow.

---

## 3. Protocole pour les Futurs POCs

Pour garantir la qualité et la cohérence des prochaines pages, l'agent développeur doit suivre impérativement ces règles :

### 🎨 Phase 1 : Analyse & Design
1.  **Analyse de l'existant** : Avant de coder, analyser les standards du marché (ex: pour une page "Logs", voir Datadog/Splunk ; pour "Fichiers", voir S3/Drive).
2.  **Charte Graphique Commune** :
    *   Se référer strictement à `Guides\UX\APP_DESIGN.md`.
    *   Style : **Cyberpunk/Space** (Fonds `slate-900`, Bordures Néon, Glassmorphism).
3.  **Identité Visuelle du Robot** : La page doit utiliser la couleur d'accentuation du robot concerné :
    *   🤖 **Archi** : Cyan (`cyan-500`)
    *   📊 **Bos** : Rouge (`red-500`)
    *   🔌 **Com** : Bleu (`blue-500`)
    *   🧠 **Phil** : Violet (`purple-500`)
    *   ⏱️ **Tim** : Orange (`orange-500`)

### 🛠️ Phase 2 : Développement Technique
1.  **Layout "Safe"** :
    *   ⛔ **INTERDIT** : `fixed inset-0`, `w-screen`, `h-screen` sur la racine de la page.
    *   ✅ **OBLIGATOIRE** : Le conteneur principal doit être `relative`, `w-full`, `h-full` et gérer son propre scroll (`overflow-y-auto`) pour s'intégrer dans le layout global (Sidebar + Header).
2.  **Internationalisation (i18n)** :
    *   Aucun texte brut dans le JSX.
    *   Ajouter les clés dans `i18n/fr.ts` (et autres langues si possible) dès la création.
3.  **Composants Réutilisables** :
    *   Utiliser les composants UI existants (Boutons, Inputs stylisés) pour éviter les "anomalies graphiques".

### ✅ Phase 3 : Checklist de Validation
*   [ ] **Navigation** : La Sidebar et le Header restent-ils accessibles et fonctionnels ?
*   [ ] **Scroll** : Le contenu est-il accessible si la fenêtre est réduite ?
*   [ ] **Traduction** : Tous les textes sont-ils issus de `t('key')` ?
*   [ ] **Couleur** : La page respecte-t-elle la couleur du robot (ex: bordures, icônes) ?
*   [ ] **Feedback** : Les actions (boutons) donnent-elles un retour visuel (toast, loader) ?

---

*Ce document doit être consulté avant chaque nouvelle création de page pour un robot.*