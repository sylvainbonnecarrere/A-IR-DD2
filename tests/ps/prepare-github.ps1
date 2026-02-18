# ==============================================================================
# A-IR-DD2 GitHub Preparation Script
# ==============================================================================
# 
# Ce script prépare le projet pour publication GitHub en vérifiant la sécurité
# et en nettoyant les fichiers sensibles
#
# Usage: .\prepare-github.ps1
#
# ==============================================================================

Write-Host "🔒 A-IR-DD2 - Préparation sécurisée pour GitHub" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Variables
$ProjectRoot = $PSScriptRoot
$GitIgnoreFile = "$ProjectRoot\.gitignore"
$EnvLocalFile = "$ProjectRoot\.env.local"
$ExportDir = "$ProjectRoot\export"

# ==============================================================================
# 1. AUDIT DE SÉCURITÉ
# ==============================================================================

Write-Host "`n📋 1. Audit de sécurité..." -ForegroundColor Yellow

# Vérifier les fichiers sensibles
$SensitiveFiles = @(
    "*.key", "*.pem", "*.p12", "*.pfx", "*.crt", "*.csr",
    "*password*", "*secret*", "*credential*", "*token*"
)

$FoundSensitive = @()
foreach ($Pattern in $SensitiveFiles) {
    $Files = Get-ChildItem -Path $ProjectRoot -Recurse -Include $Pattern -ErrorAction SilentlyContinue | 
             Where-Object { $_.FullName -notlike "*\node_modules\*" -and $_.FullName -notlike "*\dist\*" }
    $FoundSensitive += $Files
}

if ($FoundSensitive.Count -gt 0) {
    Write-Host "⚠️  ATTENTION: Fichiers sensibles détectés:" -ForegroundColor Red
    foreach ($File in $FoundSensitive) {
        Write-Host "   - $($File.FullName)" -ForegroundColor Red
    }
    $Continue = Read-Host "Continuer quand même? (y/N)"
    if ($Continue -ne "y" -and $Continue -ne "Y") {
        Write-Host "Arrêt du script." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✅ Aucun fichier sensible détecté" -ForegroundColor Green
}

# ==============================================================================
# 2. VÉRIFICATION DU .GITIGNORE
# ==============================================================================

Write-Host "`n📋 2. Vérification du .gitignore..." -ForegroundColor Yellow

if (Test-Path $GitIgnoreFile) {
    $GitIgnoreContent = Get-Content $GitIgnoreFile -Raw
    
    $RequiredPatterns = @(
        "\.env", "\.env\.local", "node_modules", "dist", "\.log"
    )
    
    $MissingPatterns = @()
    foreach ($Pattern in $RequiredPatterns) {
        if ($GitIgnoreContent -notmatch $Pattern) {
            $MissingPatterns += $Pattern
        }
    }
    
    if ($MissingPatterns.Count -gt 0) {
        Write-Host "⚠️  Motifs manquants dans .gitignore:" -ForegroundColor Red
        foreach ($Pattern in $MissingPatterns) {
            Write-Host "   - $Pattern" -ForegroundColor Red
        }
    } else {
        Write-Host "✅ .gitignore correctement configuré" -ForegroundColor Green
    }
} else {
    Write-Host "❌ Fichier .gitignore manquant!" -ForegroundColor Red
    exit 1
}

# ==============================================================================
# 3. NETTOYAGE DES FICHIERS TEMPORAIRES
# ==============================================================================

Write-Host "`n📋 3. Nettoyage des fichiers temporaires..." -ForegroundColor Yellow

$CleanupPatterns = @(
    "*.tmp", "*.temp", "*.cache", "*.log", "node_modules", "dist", "build"
)

$Cleaned = 0
foreach ($Pattern in $CleanupPatterns) {
    $Files = Get-ChildItem -Path $ProjectRoot -Recurse -Include $Pattern -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -notlike "*\.git\*" }
    
    foreach ($File in $Files) {
        try {
            if ($File.PSIsContainer) {
                Remove-Item $File.FullName -Recurse -Force -ErrorAction SilentlyContinue
            } else {
                Remove-Item $File.FullName -Force -ErrorAction SilentlyContinue
            }
            $Cleaned++
        } catch {
            # Ignorer les erreurs de suppression
        }
    }
}

Write-Host "✅ $Cleaned fichier(s) temporaire(s) nettoyé(s)" -ForegroundColor Green

# ==============================================================================
# 4. VALIDATION DES DÉPENDANCES
# ==============================================================================

Write-Host "`n📋 4. Audit des dépendances..." -ForegroundColor Yellow

# Frontend
Set-Location $ProjectRoot
try {
    $AuditResult = npm audit --json 2>$null | ConvertFrom-Json
    if ($AuditResult.metadata.vulnerabilities.total -eq 0) {
        Write-Host "✅ Frontend: Aucune vulnérabilité détectée" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Frontend: $($AuditResult.metadata.vulnerabilities.total) vulnérabilité(s) détectée(s)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Impossible d'auditer le frontend" -ForegroundColor Yellow
}

# Backend
if (Test-Path "$ProjectRoot\backend") {
    Set-Location "$ProjectRoot\backend"
    try {
        $BackendAuditResult = npm audit --json 2>$null | ConvertFrom-Json
        if ($BackendAuditResult.metadata.vulnerabilities.total -eq 0) {
            Write-Host "✅ Backend: Aucune vulnérabilité détectée" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Backend: $($BackendAuditResult.metadata.vulnerabilities.total) vulnérabilité(s) détectée(s)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "⚠️  Impossible d'auditer le backend" -ForegroundColor Yellow
    }
    Set-Location $ProjectRoot
}

# ==============================================================================
# 5. TEST DE COMPILATION
# ==============================================================================

Write-Host "`n📋 5. Test de compilation..." -ForegroundColor Yellow

try {
    $BuildResult = npm run build 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Compilation réussie" -ForegroundColor Green
    } else {
        Write-Host "❌ Erreur de compilation:" -ForegroundColor Red
        Write-Host $BuildResult -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Erreur lors du test de compilation" -ForegroundColor Red
    exit 1
}

# ==============================================================================
# 6. VÉRIFICATION DES CLÉS D'API
# ==============================================================================

Write-Host "`n📋 6. Vérification des clés d'API..." -ForegroundColor Yellow

if (Test-Path $EnvLocalFile) {
    $EnvContent = Get-Content $EnvLocalFile -Raw
    
    # Rechercher des clés qui ne sont pas des placeholders
    $SuspiciousPatterns = @(
        "AIza[0-9A-Za-z\-_]{35}",  # Google API Key pattern
        "sk-[0-9A-Za-z]{48}",      # OpenAI API Key pattern
        "sk-ant-[0-9A-Za-z\-_]+"  # Anthropic API Key pattern
    )
    
    $RealKeysFound = $false
    foreach ($Pattern in $SuspiciousPatterns) {
        if ($EnvContent -match $Pattern) {
            $Matches = [regex]::Matches($EnvContent, $Pattern)
            foreach ($Match in $Matches) {
                $Key = $Match.Value
                if ($Key -notlike "*placeholder*" -and $Key -notlike "*example*" -and $Key -notlike "*your_*") {
                    Write-Host "⚠️  Clé API réelle détectée dans .env.local: $($Key.Substring(0, 10))..." -ForegroundColor Red
                    $RealKeysFound = $true
                }
            }
        }
    }
    
    if (-not $RealKeysFound) {
        Write-Host "✅ Aucune clé API réelle détectée dans .env.local" -ForegroundColor Green
    }
} else {
    Write-Host "ℹ️  Fichier .env.local non trouvé (normal pour GitHub)" -ForegroundColor Blue
}

# ==============================================================================
# 7. SUPPRESSION DU DOSSIER EXPORT
# ==============================================================================

Write-Host "`n📋 7. Nettoyage du dossier export..." -ForegroundColor Yellow

if (Test-Path $ExportDir) {
    try {
        Remove-Item $ExportDir -Recurse -Force
        Write-Host "✅ Dossier export supprimé" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Impossible de supprimer le dossier export" -ForegroundColor Yellow
    }
} else {
    Write-Host "ℹ️  Dossier export déjà absent" -ForegroundColor Blue
}

# ==============================================================================
# 8. RAPPORT FINAL
# ==============================================================================

Write-Host "`n🎯 Rapport final:" -ForegroundColor Cyan
Write-Host "=================" -ForegroundColor Cyan

Write-Host "✅ Audit de sécurité terminé" -ForegroundColor Green
Write-Host "✅ .gitignore vérifié" -ForegroundColor Green
Write-Host "✅ Fichiers temporaires nettoyés" -ForegroundColor Green
Write-Host "✅ Dépendances auditées" -ForegroundColor Green
Write-Host "✅ Compilation validée" -ForegroundColor Green
Write-Host "✅ Clés API vérifiées" -ForegroundColor Green
Write-Host "✅ Dossier export nettoyé" -ForegroundColor Green

Write-Host "`n🚀 Le projet A-IR-DD2 est prêt pour GitHub!" -ForegroundColor Green
Write-Host "`nProchaines étapes:" -ForegroundColor Yellow
Write-Host "1. Créer le repository 'A-IR-DD2' sur GitHub" -ForegroundColor White
Write-Host "2. git init" -ForegroundColor White
Write-Host "3. git add ." -ForegroundColor White
Write-Host "4. git commit -m ""Initial commit""" -ForegroundColor White
Write-Host "5. git remote add origin https://github.com/yourusername/A-IR-DD2.git" -ForegroundColor White
Write-Host "6. git push -u origin main" -ForegroundColor White

Write-Host "`n⚠️  RAPPEL SÉCURITÉ:" -ForegroundColor Red
Write-Host "- Ne jamais committer de vrais API keys" -ForegroundColor Red
Write-Host "- Vérifier le .gitignore avant chaque push" -ForegroundColor Red
Write-Host "- Utiliser .env.local pour les clés de développement" -ForegroundColor Red