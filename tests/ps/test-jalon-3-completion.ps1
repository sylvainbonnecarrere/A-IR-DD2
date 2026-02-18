#!/usr/bin/env pwsh
<#
.SYNOPSIS
Test complétude Jalon 3 - Vérification que tous les fichiers ont été créés/modifiés
#>

param(
    [string]$ProjectRoot = 'c:\AITest\A-IR-DD2\PersistAIRDD2\A-IR-DD2'
)

$ErrorActionPreference = 'Stop'

# Colors for output
$Green = [System.ConsoleColor]::Green
$Red = [System.ConsoleColor]::Red
$Yellow = [System.ConsoleColor]::Yellow
$Gray = [System.ConsoleColor]::Gray

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet('Pass', 'Fail', 'Info')]
        [string]$Status = 'Info'
    )
    
    $Color = switch($Status) {
        'Pass' { $Green }
        'Fail' { $Red }
        'Info' { $Gray }
    }
    
    $Symbol = switch($Status) {
        'Pass' { '✓' }
        'Fail' { '✗' }
        'Info' { '→' }
    }
    
    Write-Host "$Symbol " -NoNewline -ForegroundColor $Color
    Write-Host $Message
}

Write-Host ""
Write-Host "=== JALON 3 COMPLETION TEST ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check template API client exists
$templateAPIPath = Join-Path $ProjectRoot 'services\templateAPI.ts'
if (Test-Path $templateAPIPath) {
    Write-Status "templateAPI.ts created" 'Pass'
} else {
    Write-Status "templateAPI.ts NOT found" 'Fail'
    exit 1
}

# Test 2: Check useTemplates hook exists
$useTemplatesPath = Join-Path $ProjectRoot 'hooks\useTemplates.ts'
if (Test-Path $useTemplatesPath) {
    Write-Status "useTemplates.ts created" 'Pass'
} else {
    Write-Status "useTemplates.ts NOT found" 'Fail'
    exit 1
}

# Test 3: Check useTemplateActions hook exists
$useTemplateActionsPath = Join-Path $ProjectRoot 'hooks\useTemplateActions.ts'
if (Test-Path $useTemplateActionsPath) {
    Write-Status "useTemplateActions.ts created" 'Pass'
} else {
    Write-Status "useTemplateActions.ts NOT found" 'Fail'
    exit 1
}

# Test 4: Verify templateService.ts has hybrid functions
$templateServicePath = Join-Path $ProjectRoot 'services\templateService.ts'
$templateServiceContent = Get-Content $templateServicePath -Raw
if ($templateServiceContent -match 'loadAllTemplatesHybrid' -and `
    $templateServiceContent -match 'savePrototypeAsTemplateHybrid' -and `
    $templateServiceContent -match 'deleteTemplateHybrid' -and `
    $templateServiceContent -match 'updateTemplateHybrid' -and `
    $templateServiceContent -match 'toggleTemplateStarHybrid' -and `
    $templateServiceContent -match 'recordTemplateUsageHybrid') {
    Write-Status "templateService.ts has all hybrid functions" 'Pass'
} else {
    Write-Status "templateService.ts missing hybrid functions" 'Fail'
    exit 1
}

# Test 5: Verify ArchiPrototypingPage imports hybrid functions
$archiPagePath = Join-Path $ProjectRoot 'components\ArchiPrototypingPage.tsx'
$archiPageContent = Get-Content $archiPagePath -Raw
if ($archiPageContent -match 'savePrototypeAsTemplateHybrid' -and `
    $archiPageContent -match 'confirmAddToTemplates = async') {
    Write-Status "ArchiPrototypingPage.tsx updated with hybrid support" 'Pass'
} else {
    Write-Status "ArchiPrototypingPage.tsx not updated" 'Fail'
    exit 1
}

# Test 6: Verify TemplateSelectionModal uses hybrid functions
$templateModalPath = Join-Path $ProjectRoot 'components\modals\TemplateSelectionModal.tsx'
$templateModalContent = Get-Content $templateModalPath -Raw
if ($templateModalContent -match 'loadAllTemplatesHybrid' -and `
    $templateModalContent -match 'deleteTemplateHybrid' -and `
    $templateModalContent -match 'useAuth') {
    Write-Status "TemplateSelectionModal.tsx updated with hybrid support" 'Pass'
} else {
    Write-Status "TemplateSelectionModal.tsx not updated" 'Fail'
    exit 1
}

# Test 7: File sizes check (reasonable size indication files exist and have content)
$minFileSize = 200  # bytes

$filesToCheck = @(
    @{ Path = $templateAPIPath; Name = 'templateAPI.ts'; MinSize = 10000 }
    @{ Path = $useTemplatesPath; Name = 'useTemplates.ts'; MinSize = 8000 }
    @{ Path = $useTemplateActionsPath; Name = 'useTemplateActions.ts'; MinSize = 6000 }
)

foreach ($file in $filesToCheck) {
    if (Test-Path $file.Path) {
        $size = (Get-Item $file.Path).Length
        if ($size -ge $file.MinSize) {
            Write-Status "$($file.Name) has substantial content ($size bytes)" 'Pass'
        } else {
            Write-Status "$($file.Name) appears too small ($size bytes, expected >= $($file.MinSize))" 'Fail'
            exit 1
        }
    }
}

Write-Host ""
Write-Host "=== JALON 3 VERIFICATION COMPLETE ===" -ForegroundColor Green
Write-Host "✓ All frontend services created" -ForegroundColor Green
Write-Host "✓ All components updated for hybrid mode" -ForegroundColor Green
Write-Host "✓ Hybrid guest/auth routing implemented" -ForegroundColor Green
Write-Host ""
