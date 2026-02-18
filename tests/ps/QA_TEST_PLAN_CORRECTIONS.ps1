#!/usr/bin/env pwsh
<#
.SYNOPSIS
Plan de test pour valider les 3 corrections QA appliquées à Jalon 3
.DESCRIPTION
Teste:
1. Erreur 1 fix: WorkflowValidationModal - useLocalization
2. Erreur 2 fix: TemplateSelectionModal - LLM filtering logic
3. Erreur 3 fix: AgentTemplate model - llmProvider enum match

.EXAMPLE
PS> .\QA_TEST_PLAN_CORRECTIONS.ps1

#>

Write-Host ""
Write-Host "╔═════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  JALON 3 QA - PLAN DE TEST CORRECTIONS                  ║" -ForegroundColor Cyan
Write-Host "║  3 Erreurs détectées → 3 Corrections appliquées        ║" -ForegroundColor Cyan
Write-Host "╚═════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$testResults = @()

# ============================================
# TEST 1: WorkflowValidationModal - useLocalization
# ============================================
Write-Host "TEST 1️⃣: WorkflowValidationModal - useLocalization Hook" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "Vérifications:"
Write-Host "  ✓ File: components/modals/WorkflowValidationModal.tsx"
Write-Host "  ✓ Fix: Ajout de 'const { t } = useLocalization();' ligne 77"
Write-Host ""

$test1Path = 'c:\AITest\A-IR-DD2\PersistAIRDD2\A-IR-DD2\components\modals\WorkflowValidationModal.tsx'
if (Test-Path $test1Path) {
    $content = Get-Content $test1Path -Raw
    if ($content -match 'const \{ t \} = useLocalization\(\);') {
        Write-Host "  ✅ useLocalization hook appelé - PASS" -ForegroundColor Green
        $testResults += @{ Test = "Erreur 1 - useLocalization"; Status = "PASS" }
    } else {
        Write-Host "  ❌ useLocalization hook NOT found - FAIL" -ForegroundColor Red
        $testResults += @{ Test = "Erreur 1 - useLocalization"; Status = "FAIL" }
    }
} else {
    Write-Host "  ❌ File not found - FAIL" -ForegroundColor Red
    $testResults += @{ Test = "Erreur 1 - useLocalization"; Status = "FAIL" }
}

Write-Host ""
Write-Host "Scénario de test (manuel):"
Write-Host "  1. npm run dev (frontend)"
Write-Host "  2. Mode GUEST (pas connecté)"
Write-Host "  3. Créer un prototype"
Write-Host "  4. Cliquer 'Ajouter aux workflow'"
Write-Host "  5. ✓ Pas de ReferenceError dans console"
Write-Host "  6. ✓ Modal s'ouvre normalement"
Write-Host ""

# ============================================
# TEST 2: TemplateSelectionModal - LLM Filtering
# ============================================
Write-Host "TEST 2️⃣: TemplateSelectionModal - LLM Filtering Logic" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "Vérifications:"
Write-Host "  ✓ File: components/modals/TemplateSelectionModal.tsx"
Write-Host "  ✓ Fix: Amélioration getLocalCompatibleTemplates() lignes 64-101"
Write-Host ""

$test2Path = 'c:\AITest\A-IR-DD2\PersistAIRDD2\A-IR-DD2\components\modals\TemplateSelectionModal.tsx'
if (Test-Path $test2Path) {
    $content = Get-Content $test2Path -Raw
    $checks = @(
        @{ Pattern = 'if \(enabledProviders\.length === 0\)'; Name = "No providers check" },
        @{ Pattern = 'return allTemplates;'; Name = "Return all templates" },
        @{ Pattern = 'if \(!template\.template\.capabilities'; Name = "Empty capabilities check" },
        @{ Pattern = 'const templateProvider = template\.template\.llmProvider'; Name = "Provider matching" }
    )
    
    $allPassed = $true
    foreach ($check in $checks) {
        if ($content -match $check.Pattern) {
            Write-Host "  ✓ $($check.Name) - found" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $($check.Name) - NOT found" -ForegroundColor Red
            $allPassed = $false
        }
    }
    
    if ($allPassed) {
        $testResults += @{ Test = "Erreur 2 - LLM Filtering"; Status = "PASS" }
    } else {
        $testResults += @{ Test = "Erreur 2 - LLM Filtering"; Status = "FAIL" }
    }
} else {
    Write-Host "  ❌ File not found - FAIL" -ForegroundColor Red
    $testResults += @{ Test = "Erreur 2 - LLM Filtering"; Status = "FAIL" }
}

Write-Host ""
Write-Host "Scénario de test (manuel):"
Write-Host "  1. Mode GUEST"
Write-Host "  2. Créer prototype (ex: Assistant)"
Write-Host "  3. Ajouter aux templates"
Write-Host "  4. Cliquer bouton 'Templates'"
Write-Host "  5. ✓ Template créé apparaît dans la liste"
Write-Host "  6. ✓ Pas de message 'masqué(s)'"
Write-Host ""

# ============================================
# TEST 3: AgentTemplate Model - llmProvider Enum
# ============================================
Write-Host "TEST 3️⃣: AgentTemplate Model - llmProvider Enum Match" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "Vérifications:"
Write-Host "  ✓ File: backend/src/models/AgentTemplate.model.ts"
Write-Host "  ✓ Fix: Mise à jour enum llmProvider lignes 59-61"
Write-Host ""

$test3Path = 'c:\AITest\A-IR-DD2\PersistAIRDD2\A-IR-DD2\backend\src\models\AgentTemplate.model.ts'
if (Test-Path $test3Path) {
    $content = Get-Content $test3Path -Raw
    $providers = @('Gemini', 'OpenAI', 'Mistral', 'Anthropic', 'Grok', 'Perplexity', 'Qwen', 'Kimi K2', 'DeepSeek', 'LLM local', 'Arc-LLM', 'Mock')
    
    $allFound = $true
    foreach ($provider in $providers) {
        if ($content -match [regex]::Escape($provider)) {
            Write-Host "  ✓ Provider: $provider" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Provider NOT found: $provider" -ForegroundColor Red
            $allFound = $false
        }
    }
    
    if ($allFound) {
        $testResults += @{ Test = "Erreur 3 - llmProvider Enum"; Status = "PASS" }
    } else {
        $testResults += @{ Test = "Erreur 3 - llmProvider Enum"; Status = "FAIL" }
    }
} else {
    Write-Host "  ❌ File not found - FAIL" -ForegroundColor Red
    $testResults += @{ Test = "Erreur 3 - llmProvider Enum"; Status = "FAIL" }
}

Write-Host ""
Write-Host "Scénario de test (manuel):"
Write-Host "  1. npm run dev (backend)"
Write-Host "  2. npm run dev (frontend)"
Write-Host "  3. Mode AUTHENTIFIÉ (login)"
Write-Host "  4. Créer prototype (ex: Gemini provider)"
Write-Host "  5. Cliquer 'Ajouter aux templates'"
Write-Host "  6. Valider"
Write-Host "  7. ✓ Response 201 (pas 500) dans Network tab"
Write-Host "  8. ✓ Template créé dans MongoDB agent_templates"
Write-Host "  9. ✓ Cliquer Templates modal: template visible"
Write-Host ""

# ============================================
# ACCEPTANCE CRITERIA
# ============================================
Write-Host ""
Write-Host "ACCEPTANCE CRITERIA - All Must Pass:" -ForegroundColor Cyan
Write-Host ""

$criteria = @(
    @{ Number = "1.1"; Description = "No console errors (ReferenceError)"; Manual = $true },
    @{ Number = "1.2"; Description = "WorkflowValidationModal opens"; Manual = $true },
    @{ Number = "2.1"; Description = "Guest templates visible after save"; Manual = $true },
    @{ Number = "2.2"; Description = "No 'incompatible' message for valid templates"; Manual = $true },
    @{ Number = "3.1"; Description = "POST /api/agent-templates returns 201"; Manual = $true },
    @{ Number = "3.2"; Description = "Template created in MongoDB"; Manual = $true },
    @{ Number = "3.3"; Description = "Template visible in auth modal"; Manual = $true }
)

foreach ($crit in $criteria) {
    $status = if ($crit.Manual) { "MANUAL TEST REQUIRED" } else { "AUTO CHECK" }
    Write-Host "  [$($crit.Number)] $($crit.Description)" -NoNewline
    Write-Host " [$status]" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# SUMMARY
# ============================================
Write-Host ""
Write-Host "╔═════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  TEST RESULTS SUMMARY                                   ║" -ForegroundColor Cyan
Write-Host "╚═════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$passCount = ($testResults | Where-Object { $_.Status -eq "PASS" }).Count
$failCount = ($testResults | Where-Object { $_.Status -eq "FAIL" }).Count
$totalTests = $testResults.Count

foreach ($result in $testResults) {
    $symbol = if ($result.Status -eq "PASS") { "✅" } else { "❌" }
    $color = if ($result.Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host "$symbol $($result.Test): $($result.Status)" -ForegroundColor $color
}

Write-Host ""
Write-Host "Code-level checks: $passCount/$totalTests PASSED" -ForegroundColor $(if ($passCount -eq $totalTests) { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "📋 Manual Testing Required:" -ForegroundColor Cyan
Write-Host "   • Start frontend: npm run dev"
Write-Host "   • Start backend: cd backend && npm run dev"
Write-Host "   • Test scenarios above"
Write-Host ""
Write-Host "✅ If all tests pass → Jalon 3 QA validation complete" -ForegroundColor Green
Write-Host ""
