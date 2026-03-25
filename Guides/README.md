# Guides A-IR-DD2

> Documentation complète pour comprendre rapidement l'architecture et l'UX du système.

## 📁 Contenu

### 🎨 [UX_FEATURES_GUIDE.md](./UX_FEATURES_GUIDE.md)
**Guide de référence UX et Fonctionnalités**

Couvre :
- Vue d'ensemble de l'interface (Sidebar V2, Canvas, Nœuds agents)
- Système de capabilities LLM
- Workflows utilisateur détaillés (création agent, génération d'images, chat)
- Système de traduction i18n (5 langues)
- Style gaming et animations
- Pages spécialisées des 5 robots (Archi, Bos, Com, Phil, Tim)
- Sécurité et gouvernance
- Checklist onboarding agent IA

**Public cible** : Designers, Product Managers, Agents IA découvrant le projet

---

### 🏗️ [ARCHITECTURE_GUIDE.md](./ARCHITECTURE_GUIDE.md)
**Guide de référence Architecture SOLID & LLM**

Couvre :
- Architecture Domain-Driven Design (Design vs Runtime domains)
- Principes SOLID appliqués (S-O-L-I-D avec exemples)
- Patterns de conception (Factory, Strategy, Observer, Adapter)
- Gestion multi-LLM avec dispatcher centralisé
- Spécificités par provider (OpenAI, Gemini, Anthropic, DeepSeek, LMStudio, etc.)
- Structure des stores Zustand (Design & Runtime)
- Workflow d'exécution des tools Python
- Gouvernance et sécurité (creator_id, whitelist, sanitization)
- Organisation des fichiers
- Stratégie de testing (Vitest, Playwright)
- Optimisations performance

**Public cible** : Développeurs, Architectes logiciels, Agents IA travaillant sur le code

---

### 🧰 [Features/TOOLS/README.md](./Features/TOOLS/README.md)
**Synthèse Plan 1 Tools - 12 livrables et glossaire**

Couvre :
- Synthèse des 12 jalons/livrables du Plan 1 Tools
- Vocabulaire normatif `workspace / build / run / runtime / registry / output / health`
- Termes ambigus ou faux à purger
- Fichiers pivot à relire pour assimiler rapidement le chantier

**Public cible** : Architectes, Développeurs, Agents IA travaillant sur le chantier Tools

---

## 🎯 Utilisation

### Pour les Agents IA

**Lecture recommandée dans l'ordre** :

1. **Découverte** : `UX_FEATURES_GUIDE.md` → Comprendre ce que fait l'application
2. **Architecture** : `ARCHITECTURE_GUIDE.md` → Comprendre comment c'est construit
3. **Documentation complémentaire** :
   - `../documentation/PLAN_JALONS_SYNTHETIQUE.md` → Vision roadmap
   - `../types.ts` → Contrats de données
   - `../documentation/LLM_COMPATIBILITY_REPORT.md` → Détails compatibilité LLM

### Pour les Développeurs Humains

**Quick Start** :
- Lire `UX_FEATURES_GUIDE.md` section "Workflows Utilisateur"
- Consulter `ARCHITECTURE_GUIDE.md` sections "SOLID" et "Gestion Multi-LLM"
- Explorer le code avec la carte mentale de l'architecture

**Contribuer** :
- Suivre les principes SOLID documentés
- Respecter la séparation Design/Runtime domains
- Tester avec capabilities-driven rendering

---

## 🔄 Maintenance

Ces guides sont **vivants** et doivent être mis à jour à chaque changement architectural majeur :

- ✅ Ajout nouveau LLM → Mettre à jour section "Spécificités LLM"
- ✅ Nouveau robot → Mettre à jour tableau 5 robots + page spécialisée
- ✅ Nouveau pattern → Documenter dans section "Patterns de Conception"
- ✅ Refactoring stores → Mettre à jour "Structure des Stores"

**Dernière mise à jour** : 13 novembre 2025  
**Responsable maintenance** : ARC-1 (Agent IA Architecte)

---

## 📞 Ressources Complémentaires

### Documentation Projet
- [Plan de jalons](../documentation/PLAN_JALONS_SYNTHETIQUE.md)
- [Analyse initiale](../documentation/ANALYSE_INITIALE.md)
- [Spec N8N Workflow Editor](../documentation/N8N_WORKFLOW_EDITOR_SPEC.md)
- [LLM Compatibility Report](../documentation/LLM_COMPATIBILITY_REPORT.md)

### Code Source Clé
- [Types centralisés](../types.ts)
- [Configuration LLM](../llmModels.ts)
- [Navigation robots](../data/robotNavigation.ts)
- [Store Design](../stores/useDesignStore.ts)
- [Store Runtime](../stores/useRuntimeStore.ts)

### Backend
- [Server Express](../backend/src/server.ts)
- [Python Executor](../backend/src/pythonExecutor.ts)
- [Config Whitelist](../backend/src/config.ts)

---

**Note** : Ces guides sont optimisés pour la lecture par des agents IA. Ils utilisent des structures Markdown riches (tableaux, code blocks, listes) pour faciliter le parsing et la compréhension contextuelle.
