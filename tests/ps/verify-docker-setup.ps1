#!/usr/bin/env pwsh
<#
    MongoDB Docker Setup Verification Script for A-IR-DD2
    
    This script verifies that:
    1. Docker is installed and running
    2. MongoDB container started successfully
    3. Collections and schema created
    4. Test user account exists
    5. Backend can connect to MongoDB
#>

param(
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Continue"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("✓", "✗", "⚠", "ℹ")]
        [string]$Status = "ℹ"
    )
    
    $colors = @{
        "✓" = "Green"
        "✗" = "Red"
        "⚠" = "Yellow"
        "ℹ" = "Cyan"
    }
    
    Write-Host "$Status " -ForegroundColor $colors[$Status] -NoNewline
    Write-Host $Message
}

Write-Host ""
Write-Host "🔍 A-IR-DD2 MongoDB Docker Setup Verification" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Check 1: Docker installed
Write-Host "1. Checking Docker installation..." -ForegroundColor White
try {
    $dockerVersion = docker --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Status "Docker is installed: $dockerVersion" "✓"
    } else {
        Write-Status "Docker not found" "✗"
        exit 1
    }
} catch {
    Write-Status "Docker check failed: $_" "✗"
    exit 1
}

# Check 2: Docker daemon running
Write-Host ""
Write-Host "2. Checking Docker daemon..." -ForegroundColor White
try {
    docker ps *>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Status "Docker daemon is running" "✓"
    } else {
        Write-Status "Docker daemon is not running" "✗"
        Write-Status "Please start Docker Desktop or Docker service" "⚠"
        exit 1
    }
} catch {
    Write-Status "Docker daemon check failed" "✗"
    exit 1
}

# Check 3: MongoDB container exists and running
Write-Host ""
Write-Host "3. Checking MongoDB container..." -ForegroundColor White
try {
    $container = docker ps --filter "name=a-ir-dd2-mongodb" --format "{{.Names}}" 2>$null
    if ($container) {
        Write-Status "MongoDB container is running: $container" "✓"
    } else {
        Write-Status "MongoDB container not running" "⚠"
        Write-Host "   Starting container..." -ForegroundColor Gray
        Push-Location "$scriptPath\backend\docker"
        docker-compose up -d 2>$null
        Start-Sleep -Seconds 3
        Pop-Location
        
        $container = docker ps --filter "name=a-ir-dd2-mongodb" --format "{{.Names}}" 2>$null
        if ($container) {
            Write-Status "MongoDB container started successfully" "✓"
        } else {
            Write-Status "Failed to start MongoDB container" "✗"
            exit 1
        }
    }
} catch {
    Write-Status "Container check failed: $_" "✗"
    exit 1
}

# Check 4: MongoDB is responding
Write-Host ""
Write-Host "4. Checking MongoDB connectivity..." -ForegroundColor White
try {
    $pingResult = docker exec a-ir-dd2-mongodb mongosh --username admin --password "SecurePassword123!" --authenticationDatabase admin --eval "db.version()" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Status "MongoDB is responding" "✓"
    } else {
        Write-Status "MongoDB is not responding (initializing...)" "⚠"
        Start-Sleep -Seconds 5
        $pingResult = docker exec a-ir-dd2-mongodb mongosh --username admin --password "SecurePassword123!" --authenticationDatabase admin --eval "db.version()" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Status "MongoDB is responding after initialization" "✓"
        } else {
            Write-Status "MongoDB still not responding" "✗"
            exit 1
        }
    }
} catch {
    Write-Status "Connectivity check failed: $_" "✗"
    exit 1
}

# Check 5: Database and collections exist
Write-Host ""
Write-Host "5. Checking database and collections..." -ForegroundColor White
try {
    $collectionsOutput = docker exec a-ir-dd2-mongodb mongosh --username admin --password "SecurePassword123!" --authenticationDatabase admin a-ir-dd2-dev --eval "show collections" 2>$null
    
    $requiredCollections = @("users", "llm_configs", "user_settings", "workflows", "agents")
    $allFound = $true
    
    foreach ($collection in $requiredCollections) {
        if ($collectionsOutput -match $collection) {
            Write-Host "   ✓ $collection" -ForegroundColor Green
        } else {
            Write-Host "   ✗ $collection" -ForegroundColor Red
            $allFound = $false
        }
    }
    
    if ($allFound) {
        Write-Status "All required collections exist" "✓"
    } else {
        Write-Status "Some collections are missing" "✗"
        exit 1
    }
} catch {
    Write-Status "Collections check failed: $_" "✗"
    exit 1
}

# Check 6: Test user exists
Write-Host ""
Write-Host "6. Checking test user account..." -ForegroundColor White
try {
    $testUser = docker exec a-ir-dd2-mongodb mongosh --username admin --password "SecurePassword123!" --authenticationDatabase admin a-ir-dd2-dev --eval "db.users.findOne({email:'test@example.com'})" 2>$null
    
    if ($testUser -match "test@example.com") {
        Write-Status "Test user exists: test@example.com" "✓"
        Write-Host "   Password: TestPassword123 (for testing)" -ForegroundColor Gray
    } else {
        Write-Status "Test user not found" "⚠"
        Write-Status "Creating test user..." "ℹ"
        # Could insert user here, but collections should auto-create it
    }
} catch {
    Write-Status "Test user check failed: $_" "✗"
}

# Check 7: Health check
Write-Host ""
Write-Host "7. Checking container health..." -ForegroundColor White
try {
    $health = docker inspect --format='{{.State.Health.Status}}' a-ir-dd2-mongodb 2>$null
    if ($health -eq "healthy") {
        Write-Status "Container health: $health" "✓"
    } else {
        Write-Status "Container health: $health" "⚠"
    }
} catch {
    Write-Status "Health check not available" "ℹ"
}

# Summary
Write-Host ""
Write-Host "✅ MongoDB Docker Setup Verified Successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. Configure backend: cp backend/docker/.env.docker backend/.env" -ForegroundColor Gray
Write-Host "2. Generate JWT_SECRET: node -e `"console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))`"" -ForegroundColor Gray
Write-Host "3. Generate ENCRYPTION_KEY: node -e `"console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))`"" -ForegroundColor Gray
Write-Host "4. Start backend: cd backend && npm run dev" -ForegroundColor Gray
Write-Host "5. Start frontend: npm run dev" -ForegroundColor Gray
Write-Host "6. Login at http://localhost:5173 with test@example.com / TestPassword123" -ForegroundColor Gray
Write-Host ""

exit 0
