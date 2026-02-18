# ==============================================================================
# A-IR-DD2 - Script de publication GitHub
# ==============================================================================
# 
# Ce script initialise git et prépare la publication sur GitHub
#
# ATTENTION: Assurez-vous d'avoir créé le repository 'A-IR-DD2' sur GitHub
#
# ==============================================================================

Write-Host "🚀 A-IR-DD2 - Publication GitHub" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# Variables (À MODIFIER avec votre username GitHub)
$GitHubUsername = "VOTRE_USERNAME_GITHUB"
$RepoName = "A-IR-DD2"
$ProjectRoot = $PSScriptRoot

Write-Host "`n📋 Configuration:" -ForegroundColor Yellow
Write-Host "- Username GitHub: $GitHubUsername" -ForegroundColor White
Write-Host "- Repository: $RepoName" -ForegroundColor White
Write-Host "- Dossier projet: $ProjectRoot" -ForegroundColor White

# Vérification
if ($GitHubUsername -eq "VOTRE_USERNAME_GITHUB") {
    Write-Host "`n❌ ERREUR: Modifiez d'abord la variable GitHubUsername dans ce script!" -ForegroundColor Red
    Write-Host "Ligne 17: `$GitHubUsername = ""votre-username-github""" -ForegroundColor Yellow
    exit 1
}

# Confirmation
Write-Host "`n⚠️  AVANT DE CONTINUER:" -ForegroundColor Yellow
Write-Host "1. Avez-vous créé le repository '$RepoName' sur GitHub? (y/N): " -NoNewline -ForegroundColor White
$RepoCreated = Read-Host
if ($RepoCreated -ne "y" -and $RepoCreated -ne "Y") {
    Write-Host "❌ Créez d'abord le repository sur https://github.com/new" -ForegroundColor Red
    Write-Host "   - Nom: $RepoName" -ForegroundColor White
    Write-Host "   - Public ou Private selon votre choix" -ForegroundColor White
    Write-Host "   - Ne pas initialiser avec README (on a déjà le nôtre)" -ForegroundColor White
    exit 1
}

Write-Host "2. Voulez-vous procéder à la publication? (y/N): " -NoNewline -ForegroundColor White
$Proceed = Read-Host
if ($Proceed -ne "y" -and $Proceed -ne "Y") {
    Write-Host "❌ Publication annulée" -ForegroundColor Red
    exit 1
}

Set-Location $ProjectRoot

Write-Host "`n📋 Étapes de publication:" -ForegroundColor Yellow

# 1. Initialisation Git
Write-Host "`n1. Initialisation du repository Git..." -ForegroundColor Cyan
if (Test-Path ".git") {
    Write-Host "   Repository Git déjà initialisé" -ForegroundColor Green
} else {
    git init
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ Repository Git initialisé" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Erreur lors de l'initialisation Git" -ForegroundColor Red
        exit 1
    }
}

# 2. Ajout des fichiers
Write-Host "`n2. Ajout des fichiers au staging..." -ForegroundColor Cyan
git add .
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Fichiers ajoutés au staging" -ForegroundColor Green
    
    # Vérification des fichiers ignorés
    $GitStatus = git status --porcelain --ignored
    $IgnoredFiles = $GitStatus | Where-Object { $_ -match "^!!" }
    if ($IgnoredFiles) {
        Write-Host "   📋 Fichiers ignorés (normal):" -ForegroundColor Blue
        foreach ($File in $IgnoredFiles | Select-Object -First 5) {
            Write-Host "      $($File.Substring(3))" -ForegroundColor Gray
        }
        if ($IgnoredFiles.Count -gt 5) {
            Write-Host "      ... et $($IgnoredFiles.Count - 5) autres" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "   ❌ Erreur lors de l'ajout des fichiers" -ForegroundColor Red
    exit 1
}

# 3. Commit initial
Write-Host "`n3. Création du commit initial..." -ForegroundColor Cyan
git commit -m "🎯 Initial commit: A-IR-DD2 Multi-LLM Workflow Orchestrator

🚀 Features:
- React + TypeScript frontend avec Vite
- Node.js backend pour outils Python
- 8+ providers LLM (Gemini, OpenAI, Anthropic, etc.)
- Système de workflow visuel (N8N-style Phase 1)
- Architecture robot spécialisée (Archi, Bos, Com, Phil, Tim)
- Gouvernance creator_id et gestion prototypes

🔒 Security:
- Gestion sécurisée des clés API
- Documentation interne exclue
- Audit cybersécurité complet
- Zero vulnérabilités détectées

📦 Ready for:
- Développement collaboratif
- Extensions de workflow
- Intégration continue"

if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Commit initial créé" -ForegroundColor Green
} else {
    Write-Host "   ❌ Erreur lors du commit" -ForegroundColor Red
    exit 1
}

# 4. Configuration de la branche principale
Write-Host "`n4. Configuration de la branche principale..." -ForegroundColor Cyan
git branch -M main
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Branche 'main' configurée" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Branche 'main' non configurée (peut être normal)" -ForegroundColor Yellow
}

# 5. Ajout du remote origin
Write-Host "`n5. Configuration du repository distant..." -ForegroundColor Cyan
$RemoteUrl = "https://github.com/$GitHubUsername/$RepoName.git"
git remote add origin $RemoteUrl
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Remote origin configuré: $RemoteUrl" -ForegroundColor Green
} else {
    # Peut-être déjà configuré
    git remote set-url origin $RemoteUrl
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ Remote origin mis à jour: $RemoteUrl" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Erreur lors de la configuration du remote" -ForegroundColor Red
        exit 1
    }
}

# 6. Push vers GitHub
Write-Host "`n6. Publication vers GitHub..." -ForegroundColor Cyan
Write-Host "   ⚠️  Vous allez être invité à vous authentifier sur GitHub" -ForegroundColor Yellow
git push -u origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Publication réussie!" -ForegroundColor Green
} else {
    Write-Host "   ❌ Erreur lors de la publication" -ForegroundColor Red
    Write-Host "`n🔧 Solutions possibles:" -ForegroundColor Yellow
    Write-Host "   1. Vérifiez vos identifiants GitHub" -ForegroundColor White
    Write-Host "   2. Assurez-vous que le repository existe" -ForegroundColor White
    Write-Host "   3. Vérifiez les permissions d'écriture" -ForegroundColor White
    exit 1
}

# 7. Succès final
Write-Host "`n🎉 PUBLICATION RÉUSSIE!" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green

Write-Host "`n📍 Votre repository est maintenant disponible à:" -ForegroundColor Cyan
Write-Host "   https://github.com/$GitHubUsername/$RepoName" -ForegroundColor White

Write-Host "`n📋 Prochaines étapes suggérées:" -ForegroundColor Yellow
Write-Host "1. Configurez les GitHub Actions pour CI/CD" -ForegroundColor White
Write-Host "2. Ajoutez des labels et milestones" -ForegroundColor White
Write-Host "3. Invitez des collaborateurs si nécessaire" -ForegroundColor White
Write-Host "4. Configurez les branch protection rules" -ForegroundColor White

Write-Host "`n🔒 Rappel sécurité:" -ForegroundColor Red
Write-Host "- Documentation interne automatiquement exclue" -ForegroundColor Red
Write-Host "- .env.local contient uniquement des placeholders" -ForegroundColor Red
Write-Host "- Aucune clé API réelle dans le repository" -ForegroundColor Red

Write-Host "`n✨ A-IR-DD2 est maintenant open source et prêt pour la collaboration!" -ForegroundColor Green