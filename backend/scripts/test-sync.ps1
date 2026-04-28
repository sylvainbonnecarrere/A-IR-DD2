# Script de Validation de Synchronisation MongoDB ↔ Mongoose
# Vérifie que les collections utilisent bien les conventions snake_case

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

Write-Host "Test de Synchronisation MongoDB <-> Mongoose" -ForegroundColor Cyan
Write-Host ""

# Configuration
$baseUrl = "http://localhost:3001"
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'

# 1. Register
Write-Host "1 - Creation utilisateur test..." -ForegroundColor Yellow
$registerBody = @{
    email = "sync-test-$timestamp@example.com"
    password = "SyncTest123!"
} | ConvertTo-Json

try {
    $registerResponse = Invoke-RestMethod -Uri "$baseUrl/api/auth/register" `
        -Method POST `
        -ContentType "application/json" `
        -Body $registerBody
    Write-Host "[OK] Utilisateur cree : $($registerResponse.user.email)" -ForegroundColor Green
} catch {
    Write-Host "[X] Erreur creation utilisateur : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
    exit 1
}

# 2. Login
Write-Host "2 - Login..." -ForegroundColor Yellow
$loginBody = @{
    email = $registerResponse.user.email
    password = "SyncTest123!"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "$baseUrl/api/auth/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody
    
    $headers = @{
        "Authorization" = "Bearer $($loginResponse.accessToken)"
        "Content-Type" = "application/json"
    }
    Write-Host "[OK] Token obtenu" -ForegroundColor Green
} catch {
    Write-Host "[X] Erreur login : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 3. Workflow
Write-Host "3 - Creation workflow..." -ForegroundColor Yellow
$workflowBody = @{
    name = "Workflow Test Sync $timestamp"
    description = "Validation persistance collections snake_case"
} | ConvertTo-Json

try {
    $workflow = Invoke-RestMethod -Uri "$baseUrl/api/workflows" `
        -Method POST `
        -Headers $headers `
        -Body $workflowBody
    Write-Host "[OK] Workflow cree : $($workflow._id)" -ForegroundColor Green
} catch {
    Write-Host "[X] Erreur creation workflow : $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host "    Details : $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    Write-Host "    Verifier les logs backend pour details" -ForegroundColor Yellow
    exit 1
}

# 4. Prototype
Write-Host "4 - Creation agent prototype..." -ForegroundColor Yellow
$prototypeBody = @{
    name = "Agent Sync Test $timestamp"
    role = "Test assistant"
    systemPrompt = "You are a test agent for schema synchronization"
    llmProvider = "OpenAI"
    llmModel = "gpt-4"
    capabilities = @("chat")
    robotId = "AR_001"
} | ConvertTo-Json

try {
    $prototype = Invoke-RestMethod -Uri "$baseUrl/api/agent-prototypes" `
        -Method POST `
        -Headers $headers `
        -Body $prototypeBody
    Write-Host "[OK] Prototype cree : $($prototype._id)" -ForegroundColor Green
} catch {
    Write-Host "[X] Erreur creation prototype : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 5. Instance
Write-Host "5 - Creation agent instance..." -ForegroundColor Yellow
$instanceBody = @{
    workflowId = $workflow._id
    prototypeId = $prototype._id
    name = "Instance Sync Test $timestamp"
    role = "Test assistant instance"
    systemPrompt = "You are a test instance for validation"
    llmProvider = "OpenAI"
    llmModel = "gpt-4"
    capabilities = @("chat")
    robotId = "AR_001"
    position = @{
        x = 100
        y = 100
    }
} | ConvertTo-Json -Depth 3

try {
    $instance = Invoke-RestMethod -Uri "$baseUrl/api/workflows/$($workflow._id)/instances" `
        -Method POST `
        -Headers $headers `
        -Body $instanceBody
    Write-Host "[OK] Instance creee : $($instance._id)" -ForegroundColor Green
} catch {
    Write-Host "[X] Erreur creation instance : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
    exit 1
}

# 6. Vérification MongoDB
Write-Host ""
Write-Host "6 - Verification collections MongoDB..." -ForegroundColor Yellow
Write-Host ""

$mongoCheck = @"
docker exec -it a-ir-dd2-mongodb mongosh -u $mongoUser -p $mongoPassword --authenticationDatabase admin --eval "
    use $mongoDatabase;
    print('Collections existantes :');
    db.getCollectionNames().forEach(function(col) { print('   - ' + col); });
    print('');
    print('[OK] Verifications :');
    
    // Verifier workflows
    const workflowsCount = db.workflows.countDocuments();
    print('   workflows: ' + workflowsCount + ' documents');
    
    // Verifier agent_prototypes (PAS agentprototypes)
    const prototypesCount = db.agent_prototypes.countDocuments();
    print('   agent_prototypes: ' + prototypesCount + ' documents');
    
    // Verifier agent_instances (PAS agentinstances)
    const instancesCount = db.agent_instances.countDocuments();
    print('   agent_instances: ' + instancesCount + ' documents');
    
    print('');
    
    // Verifier absence de doublons
    const badCollections = [];
    if (db.getCollection('agentprototypes').countDocuments() > 0) {
        badCollections.push('agentprototypes');
    }
    if (db.getCollection('agentinstances').countDocuments() > 0) {
        badCollections.push('agentinstances');
    }
    if (db.getCollection('llmconfigs').countDocuments() > 0) {
        badCollections.push('llmconfigs');
    }
    
    if (badCollections.length > 0) {
        print('[X] Collections en double detectees : ' + badCollections.join(', '));
        print('   Executez le script de nettoyage.');
    } else {
        print('[OK] Aucune collection en double detectee !');
    }
"
"@

Invoke-Expression $mongoCheck

Write-Host ""
Write-Host "[OK] Tests de synchronisation termines !" -ForegroundColor Green
Write-Host ""
Write-Host "Resume :" -ForegroundColor Cyan
Write-Host "   - Utilisateur : $($registerResponse.user.email)" -ForegroundColor White
Write-Host "   - Workflow ID : $($workflow._id)" -ForegroundColor White
Write-Host "   - Prototype ID : $($prototype._id)" -ForegroundColor White
Write-Host "   - Instance ID : $($instance._id)" -ForegroundColor White
Write-Host ""
Write-Host "Verifiez manuellement dans MongoDB que les collections respectent snake_case :" -ForegroundColor Cyan
Write-Host "   [OK] workflows" -ForegroundColor Green
Write-Host "   [OK] agent_prototypes (pas 'agentprototypes')" -ForegroundColor Green
Write-Host "   [OK] agent_instances (pas 'agentinstances')" -ForegroundColor Green
Write-Host "   [OK] llm_configs (pas 'llmconfigs')" -ForegroundColor Green
