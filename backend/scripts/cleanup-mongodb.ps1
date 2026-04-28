# Script de Nettoyage des Collections en Double
# Supprime les collections créées avec la mauvaise convention de nommage

$envFile = Join-Path $PSScriptRoot '..\.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -notmatch '=') {
            return
        }

        $name, $value = $_ -split '=', 2
        if (-not [string]::IsNullOrWhiteSpace($name) -and $null -eq (Get-Item "env:$name" -ErrorAction SilentlyContinue)) {
            [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
        }
    }
}

$mongoUser = $env:MONGO_USER
$mongoPassword = $env:MONGO_PASSWORD
$mongoDatabase = if ($env:MONGO_INITDB_DATABASE) { $env:MONGO_INITDB_DATABASE } else { 'a-ir-dd2-dev' }

if ([string]::IsNullOrWhiteSpace($mongoUser) -or [string]::IsNullOrWhiteSpace($mongoPassword)) {
    Write-Host "[X] Variables MongoDB manquantes. Renseignez MONGO_USER et MONGO_PASSWORD dans backend/.env." -ForegroundColor Red
    exit 1
}

Write-Host "Nettoyage des Collections MongoDB en Double" -ForegroundColor Cyan
Write-Host ""

Write-Host "ATTENTION : Ce script va supprimer les collections en double" -ForegroundColor Yellow
Write-Host "Collections a supprimer : llmconfigs, agentprototypes, agentinstances, workflownodes, workflowedges" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Continuer ? (O/N)"

if ($confirm -eq "O" -or $confirm -eq "o") {
    Write-Host ""
    Write-Host "1. Verification des collections existantes..." -ForegroundColor Yellow
    
    docker exec a-ir-dd2-mongodb mongosh -u $mongoUser -p $mongoPassword --authenticationDatabase admin --quiet --eval "use $mongoDatabase; db.getCollectionNames()" 2>$null
    
    Write-Host ""
    Write-Host "2. Suppression des collections en double..." -ForegroundColor Yellow
    
    # Supprimer chaque collection individuellement
    $collectionsToDelete = @('llmconfigs', 'agentprototypes', 'agentinstances', 'workflownodes', 'workflowedges')
    
    foreach ($col in $collectionsToDelete) {
        Write-Host "   - Suppression de '$col'..." -NoNewline
        $result = docker exec a-ir-dd2-mongodb mongosh -u $mongoUser -p $mongoPassword --authenticationDatabase admin --quiet --eval "use $mongoDatabase; db.getCollection('$col').drop()" 2>$null
        if ($result -match "true") {
            Write-Host " [OK]" -ForegroundColor Green
        } else {
            Write-Host " [N/A - Collection inexistante]" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
    Write-Host "3. Verification finale des collections..." -ForegroundColor Yellow
    docker exec a-ir-dd2-mongodb mongosh -u $mongoUser -p $mongoPassword --authenticationDatabase admin --quiet --eval "use $mongoDatabase; db.getCollectionNames()" 2>$null
    
    Write-Host ""
    Write-Host "[OK] Nettoyage termine !" -ForegroundColor Green
    Write-Host ""
    Write-Host "Prochaines etapes :" -ForegroundColor Cyan
    Write-Host "   1. Redemarrer le backend : npm run dev" -ForegroundColor White
    Write-Host "   2. Executer les tests : .\scripts\test-sync.ps1" -ForegroundColor White
    Write-Host "   3. Verifier qu'aucune collection en double n'est recree" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "[X] Nettoyage annule." -ForegroundColor Red
}
