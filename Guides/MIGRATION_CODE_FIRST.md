# 🔄 Guide de Transition - Migration vers Architecture Code-First

**Date**: January 16, 2026  
**Objet**: Migration complète du système d'initialisation MongoDB  
**Impact**: Tous les développeurs doivent effectuer la procédure de reset une seule fois

---

## 📌 Résumé Exécutif

### Avant (Problématique) ❌
- Initialisation MongoDB via volume Docker (`init-collections.js`)
- Dépendance sur la mécanique interne de MongoDB
- Problèmes d'authentification et de timing au démarrage
- Volumes persistants corrompus
- **Résultat**: Installation échouée, state incohérent

### Après (Solution) ✅
- Initialisation gérée par Node.js backend (`databaseInit.ts`)
- Idempotent: Sûr de relancer plusieurs fois
- Cross-platform: Identique Windows/Mac/Linux
- **Résultat**: Installation robuste et déterministe

---

## 🎯 Actions Requises par Développeur

### ⏱️ Estimation Temps
- **Temps total**: ~10 minutes
- Windows: 8 min
- macOS: 8 min
- Linux: 8 min

### 📋 Procédure (One-Time Setup)

#### Étape 1: Nettoyage du Volume Existant (CRITIQUE!)

**Important**: Ce nettoyage est **obligatoire et ne doit être fait qu'une seule fois**.

```bash
cd backend/docker

# Détruire le volume MongoDB existant (perte de données intentionnelle)
docker-compose down -v

# Vérifier que le volume est supprimé
docker volume ls | grep mongodb
# Doit afficher: (nothing)
```

**Confirmation**: Le volume `backend_docker_mongodb_data` ne doit plus apparaître.

#### Étape 2: Démarrer MongoDB (Moteur Seul)

```bash
# Toujours depuis backend/docker
docker-compose up -d

# Vérifier que le conteneur est sain
docker ps | grep a-ir-dd2-mongodb
# Doit afficher: a-ir-dd2-mongodb ... healthy

# Attendre la santé du conteneur
docker-compose logs -f mongodb
# Chercher: "CONTAINER HEALTHY" dans les logs
# Appuyer sur Ctrl+C pour quitter
```

#### Étape 3: Configurer le Backend

```bash
cd backend

# Copier le template .env
cp docker/.env.docker .env

# Générer les clés de sécurité (exécuter dans le même terminal)
$jwtSecret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$encryptionKey = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Éditer backend/.env et coller:
# JWT_SECRET=<le_secret_généré_à_l'étape_1>
# ENCRYPTION_KEY=<la_clé_générée_à_l'étape_2>

# Sur Windows avec PowerShell:
notepad .env
# macOS/Linux:
nano .env
```

#### Étape 4: Démarrer le Backend (Amorce l'Initialisation)

```bash
cd backend

# Installer les dépendances (première fois uniquement)
npm install

# Démarrer le serveur
npm run dev
```

**Regarder les logs pour**:
```
✨ ===== A-IR-DD2 BACKEND DÉMARRÉ ===== ✨
🔧 Starting database initialization...
📋 Creating collections with schema validation...
🗂️  Creating indexes for performance...
👤 Creating test user...
🎯 Database initialization complete!
✅ Backend listening on port 3001
```

**Si vous voyez** `✅ Database already initialized` → C'est normal et bon signe!

#### Étape 5: Vérifier l'Installation

```bash
# Test 1: Backend health check
curl http://localhost:3001/api/health
# Réponse attendue: {"status":"OK","message":"Backend is running"}

# Test 2: Collections MongoDB
docker exec -it a-ir-dd2-mongodb mongosh \
  --username admin \
  --password SecurePassword123! \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "show collections"

# Réponse attendue (9 collections):
# agent_instances
# agent_prototypes
# agents
# llm_configs
# user_settings
# users
# workflow_edges
# workflow_nodes
# workflows

# Test 3: Utilisateur de test créé
docker exec -it a-ir-dd2-mongodb mongosh \
  --username admin \
  --password SecurePassword123! \
  --authenticationDatabase admin \
  a-ir-dd2-dev \
  --eval "db.users.countDocuments()"

# Réponse attendue: 1 (le user test@example.com)
```

---

## 🧪 Test Fonctionnel Complet

Après les étapes 1-5, testez le workflow complet:

```bash
# Terminal 1: MongoDB déjà en cours d'exécution
docker-compose ps  # Doit montrer: a-ir-dd2-mongodb ... Up

# Terminal 2: Backend déjà en cours d'exécution
curl http://localhost:3001/api/health

# Terminal 3: Frontend
npm run dev  # Depuis racine du projet

# Terminal 4: Ouvrez le navigateur
# Allez à http://localhost:5173
# Cliquez sur "Connexion"
# Identifiants:
# Email: test@example.com
# Mot de passe: TestPassword123
# 
# ✅ Vous devriez être connecté
# ✅ La page settings doit charger
# ✅ Les données persistent dans MongoDB
```

---

## 🔧 Procédure de Reset Ultérieurs (Si Nécessaire)

Si vous devez recommencer une fois (ex: tests, changements de schéma):

```bash
# Option 1: Reset complet (données perdues)
cd backend/docker
docker-compose down -v
docker-compose up -d
cd ../.. && npm run dev  # Redémarre l'initialisation

# Option 2: Restart simple (garde les données)
cd backend/docker
docker-compose restart
# Les données persistent, juste container restart
```

---

## 📁 Fichiers Modifiés (Documentation)

| Fichier | Rôle | Statut |
|---------|------|--------|
| `backend/src/services/databaseInit.ts` | **NOUVEAU** - Initialisation idempotente | ✅ Créé |
| `backend/src/server.ts` | Appel du service après connexion | ✅ Modifié |
| `backend/docker/docker-compose.yml` | Volumes épurés, moteur seul | ✅ Nettoyé |
| `backend/docker/README.md` | Nouvelle documentation | ✅ Mis à jour |
| `backend/docker/SETUP_NOTES.md` | Notes techniques | ✅ Mis à jour |
| `backend/docker/init-collections.js` | Référence uniquement | 📚 Conservé |
| `backend/docker/init-mongo.sh` | Deprecated | ❌ Pas d'utilisation |

---

## ❌ Erreurs Courantes & Solutions

### ❌ Erreur: "Port 27017 already in use"
```bash
# Diagnostic
lsof -i :27017  # macOS/Linux
netstat -ano | findstr :27017  # Windows

# Solution
# 1. Arrêter le processus existant
docker ps | grep mongo
docker-compose down

# 2. Ou changer le port dans docker-compose.yml
# ports: ["27018:27017"]
```

### ❌ Erreur: "Connection refused"
```bash
# Vérifier que le conteneur court
docker ps | grep a-ir-dd2-mongodb
# Si absent: docker-compose up -d

# Vérifier la santé
docker-compose ps
# Status doit être: "Up (healthy)"
```

### ❌ Erreur: "Collections not found"
```bash
# Le backend ne s'est pas exécuté correctement
# 1. Vérifier les logs backend
npm run dev
# Chercher: "Database initialization complete"

# 2. Si problème, reset complet
docker-compose down -v
docker-compose up -d
npm run dev
```

### ❌ Erreur: "Authentication failed"
```bash
# Vérifier les identifiants
# Docker compose MongoDB user: admin / SecurePassword123!
# Backend test user: test@example.com / TestPassword123

# Tester manuellement
docker exec -it a-ir-dd2-mongodb mongosh \
  --username admin \
  --password SecurePassword123! \
  --authenticationDatabase admin
```

---

## ℹ️ FAQ

### Q: Puis-je garder mon ancien volume?
**R**: Non, pas recommandé. L'ancien format n'est pas compatible. Une fois `docker-compose down -v`, un nouveau volume propre est créé.

### Q: Dois-je faire ça sur tous les postes?
**R**: Oui, chaque poste doit exécuter les étapes 1-5 une seule fois. C'est une migration unique.

### Q: Combien de temps avant de recommencer?
**R**: Après ce setup, vous ne devriez pas avoir besoin de reremaker. Seuls les `docker-compose restart` occasionnels suffisent.

### Q: Mes données vont être perdues?
**R**: Oui à l'étape 1 (destruction du volume). Après, les données persistent normalement avec `docker-compose stop/start`.

### Q: Peut-on paralléliser le démarrage (plusieurs terminaux)?
**R**: Oui! Après `docker-compose up -d`, vous pouvez lancer `npm run dev` immédiatement. Le backend attend MongoDB automatiquement.

### Q: Le test user est-il créé automatiquement?
**R**: Oui! À chaque démarrage du backend en mode développement, le service vérifie et crée si absent.

---

## 📊 Architecture: Avant vs Après

### AVANT (Problématique)
```
docker-compose.yml
  ├─ volumes: init-collections.js
  └─ container startup
       ├─ Wait for auth
       ├─ Execute init-collections.js
       └─ ❌ Race conditions!
```

### APRÈS (Robuste)
```
docker-compose.yml (moteur seul)
  └─ container startup
       └─ MongoDB ready

backend/src/server.ts
  ├─ connectDatabase()
  ├─ initializeDatabase() ← CODE-FIRST!
  │  ├─ Phase 1: Check
  │  └─ Phase 2: Create if absent
  └─ Routes registered
```

---

## 🎓 Apprentissages Clés

1. **Code-First Initialization**: La logique d'initialisation vit dans l'application, pas Docker
2. **Idempotent Operations**: Peut être relancé sans danger (check-before-create)
3. **Non-Blocking Errors**: Les erreurs de BD ne crashent pas le démarrage (mode guest fallback)
4. **Cross-Platform Consistency**: Windows/Mac/Linux identical

---

## 📞 Support

Si vous rencontrez des problèmes:

1. Vérifiez la **section "Erreurs Courantes"** ci-dessus
2. Consultez `backend/docker/README.md` pour plus de détails
3. Consultez `backend/docker/SETUP_NOTES.md` pour la théorie
4. Vérifiez les logs avec `docker-compose logs`

---

## ✅ Checklist Finale

- [ ] Volume ancien supprimé: `docker volume ls | grep mongodb` (vide)
- [ ] MongoDB lancé: `docker-compose ps` (healthy)
- [ ] Backend .env configuré avec clés générées
- [ ] Backend lancé: `npm run dev` (initialization complete)
- [ ] Collections vérifiées: `show collections` (9 collections)
- [ ] Test user exists: `db.users.countDocuments()` (1)
- [ ] Frontend lancé: `npm run dev`
- [ ] Login fonctionne: test@example.com / TestPassword123 ✅

---

**🎉 Migration Code-First Complete!**

Bienvenue dans l'architecture nouvelle, robuste et cross-platform.

Last Updated: January 16, 2026
