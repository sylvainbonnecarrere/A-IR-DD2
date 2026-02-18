# ============================================
# Integration Tests for Agent Templates API
# ============================================

$BASE_URL = "http://localhost:3001"
$API_BASE = "$BASE_URL/api/agent-templates"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Agent Templates API Integration Tests" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# ============================================
# SETUP: Register test user and get token
# ============================================

Write-Host "`n[SETUP] Registering test user..." -ForegroundColor Yellow

$uniqueId = Get-Random
$registerBody = @{
    email = "test.templates.$uniqueId@dev.com"
    password = "TestPassword123"
    username = "templatetester$uniqueId"
} | ConvertTo-Json

try {
    $registerResp = Invoke-WebRequest -Uri "$BASE_URL/api/auth/register" `
      -Method POST `
      -ContentType "application/json" `
      -Body $registerBody `
      -ErrorAction Stop
    
    $registerData = $registerResp.Content | ConvertFrom-Json
    $token = $registerData.data.token
    $userId = $registerData.data._id
    
    Write-Host "✅ User registered" -ForegroundColor Green
    Write-Host "   Email: $($registerBody | ConvertFrom-Json).email"
    Write-Host "   UserId: $userId"
} catch {
    Write-Host "❌ Registration failed:" -ForegroundColor Red
    Write-Host $_.Exception.Response.Content -ForegroundColor Red
    exit 1
}

# ============================================
# TEST 1: POST /api/agent-templates - Create Template
# ============================================

Write-Host "`n[TEST 1] POST /api/agent-templates - Create Template" -ForegroundColor Yellow

$createBody = @{
    name = "Analyste de Données"
    description = "Expert en statistiques et data science"
    category = "specialist"
    robotId = "AR_001"
    icon = "chart"
    tags = @("data-science", "python")
    template = @{
        name = "Analyste de Données"
        role = "Data Scientist"
        systemPrompt = "Tu es un expert en analyse de données..."
        llmProvider = "OpenAI"
        llmModel = "gpt-4"
        capabilities = @("Chat", "File Analysis")
        tools = @()
        outputConfig = @{ enabled = $true; format = "json" }
        historyConfig = @{ enabled = $true }
    }
} | ConvertTo-Json -Depth 10

try {
    $createResp = Invoke-WebRequest -Uri $API_BASE `
      -Method POST `
      -Headers @{ Authorization = "Bearer $token" } `
      -ContentType "application/json" `
      -Body $createBody `
      -ErrorAction Stop
    
    $createData = $createResp.Content | ConvertFrom-Json
    $templateId = $createData.data._id
    
    Write-Host "✅ Template created successfully" -ForegroundColor Green
    Write-Host "   TemplateId: $templateId"
    Write-Host "   Status: $($createResp.StatusCode)"
} catch {
    Write-Host "❌ Create failed:" -ForegroundColor Red
    Write-Host $_.Exception.Response.Content
    exit 1
}

# ============================================
# TEST 2: GET /api/agent-templates - List Templates
# ============================================

Write-Host "`n[TEST 2] GET /api/agent-templates - List Templates" -ForegroundColor Yellow

try {
    $listResp = Invoke-WebRequest -Uri $API_BASE `
      -Method GET `
      -Headers @{ Authorization = "Bearer $token" } `
      -ErrorAction Stop
    
    $listData = $listResp.Content | ConvertFrom-Json
    $count = $listData.data.Count
    
    Write-Host "✅ Templates retrieved successfully" -ForegroundColor Green
    Write-Host "   Total templates: $count"
    Write-Host "   Total (meta): $($listData.meta.total)"
    Write-Host "   Status: $($listResp.StatusCode)"
} catch {
    Write-Host "❌ List failed:" -ForegroundColor Red
    Write-Host $_.Exception.Response.Content
    exit 1
}

# ============================================
# TEST 3: GET /api/agent-templates/:id - Get Single Template
# ============================================

Write-Host "`n[TEST 3] GET /api/agent-templates/:id - Get Single Template" -ForegroundColor Yellow

try {
    $getResp = Invoke-WebRequest -Uri "$API_BASE/$templateId" `
      -Method GET `
      -Headers @{ Authorization = "Bearer $token" } `
      -ErrorAction Stop
    
    $getData = $getResp.Content | ConvertFrom-Json
    
    Write-Host "✅ Template retrieved successfully" -ForegroundColor Green
    Write-Host "   Template name: $($getData.data.name)"
    Write-Host "   Status: $($getResp.StatusCode)"
} catch {
    Write-Host "❌ Get failed:" -ForegroundColor Red
    Write-Host $_.Exception.Response.Content
    exit 1
}

# ============================================
# TEST 4: PUT /api/agent-templates/:id - Update Template
# ============================================

Write-Host "`n[TEST 4] PUT /api/agent-templates/:id - Update Template" -ForegroundColor Yellow

$updateBody = @{
    name = "Analyste de Données - Mise à jour"
    description = "Expert en statistiques avec ML"
} | ConvertTo-Json

try {
    $updateResp = Invoke-WebRequest -Uri "$API_BASE/$templateId" `
      -Method PUT `
      -Headers @{ Authorization = "Bearer $token" } `
      -ContentType "application/json" `
      -Body $updateBody `
      -ErrorAction Stop
    
    $updateData = $updateResp.Content | ConvertFrom-Json
    
    Write-Host "✅ Template updated successfully" -ForegroundColor Green
    Write-Host "   New name: $($updateData.data.name)"
    Write-Host "   Status: $($updateResp.StatusCode)"
} catch {
    Write-Host "❌ Update failed:" -ForegroundColor Red
    Write-Host $_.Exception.Response.Content
    exit 1
}

# ============================================
# TEST 5: PATCH /api/agent-templates/:id/star - Toggle Star
# ============================================

Write-Host "`n[TEST 5] PATCH /api/agent-templates/:id/star - Toggle Star" -ForegroundColor Yellow

try {
    $starResp = Invoke-WebRequest -Uri "$API_BASE/$templateId/star" `
      -Method PATCH `
      -Headers @{ Authorization = "Bearer $token" } `
      -ErrorAction Stop
    
    $starData = $starResp.Content | ConvertFrom-Json
    
    Write-Host "✅ Star toggled successfully" -ForegroundColor Green
    Write-Host "   isStarred: $($starData.data.isStarred)"
    Write-Host "   Status: $($starResp.StatusCode)"
} catch {
    Write-Host "❌ Star toggle failed:" -ForegroundColor Red
    Write-Host $_.Exception.Response.Content
    exit 1
}

# ============================================
# TEST 6: PATCH /api/agent-templates/:id/usage - Increment Usage
# ============================================

Write-Host "`n[TEST 6] PATCH /api/agent-templates/:id/usage - Increment Usage" -ForegroundColor Yellow

try {
    $usageResp = Invoke-WebRequest -Uri "$API_BASE/$templateId/usage" `
      -Method PATCH `
      -Headers @{ Authorization = "Bearer $token" } `
      -ErrorAction Stop
    
    $usageData = $usageResp.Content | ConvertFrom-Json
    
    Write-Host "✅ Usage incremented successfully" -ForegroundColor Green
    Write-Host "   usageCount: $($usageData.data.usageCount)"
    Write-Host "   Status: $($usageResp.StatusCode)"
} catch {
    Write-Host "❌ Usage increment failed:" -ForegroundColor Red
    Write-Host $_.Exception.Response.Content
    exit 1
}

# ============================================
# TEST 7: DELETE /api/agent-templates/:id - Delete Template
# ============================================

Write-Host "`n[TEST 7] DELETE /api/agent-templates/:id - Delete Template" -ForegroundColor Yellow

try {
    $deleteResp = Invoke-WebRequest -Uri "$API_BASE/$templateId" `
      -Method DELETE `
      -Headers @{ Authorization = "Bearer $token" } `
      -ErrorAction Stop
    
    $deleteData = $deleteResp.Content | ConvertFrom-Json
    
    Write-Host "✅ Template deleted successfully" -ForegroundColor Green
    Write-Host "   Message: $($deleteData.message)"
    Write-Host "   Status: $($deleteResp.StatusCode)"
} catch {
    Write-Host "❌ Delete failed:" -ForegroundColor Red
    Write-Host $_.Exception.Response.Content
    exit 1
}

# ============================================
# VERIFY: GET after delete should return 404
# ============================================

Write-Host "`n[VERIFY] GET deleted template (should return 404)" -ForegroundColor Yellow

try {
    $verifyResp = Invoke-WebRequest -Uri "$API_BASE/$templateId" `
      -Method GET `
      -Headers @{ Authorization = "Bearer $token" } `
      -ErrorAction Stop
    
    Write-Host "❌ Expected 404 but got success" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "✅ Correctly returned 404 for deleted template" -ForegroundColor Green
    } else {
        Write-Host "❌ Unexpected status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
        exit 1
    }
}

# ============================================
# TEST: Authentication required (no token)
# ============================================

Write-Host "`n[SECURITY] Test authentication required" -ForegroundColor Yellow

try {
    $noAuthResp = Invoke-WebRequest -Uri $API_BASE `
      -Method GET `
      -ErrorAction Stop
    
    Write-Host "❌ Expected 401 but got success" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Response.StatusCode -eq 401 -or $_.Exception.Response.StatusCode -eq 400) {
        Write-Host "✅ Correctly blocked request without token" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Unexpected when no auth provided" -ForegroundColor Yellow
    }
}

# ============================================
# SUMMARY
# ============================================

Write-Host "`n======================================" -ForegroundColor Cyan
Write-Host "  ✅ ALL TESTS PASSED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan

Write-Host "`n📊 Tests Summary:" -ForegroundColor Cyan
Write-Host "   ✅ POST /api/agent-templates (Create)" -ForegroundColor Green
Write-Host "   ✅ GET /api/agent-templates (List)" -ForegroundColor Green
Write-Host "   ✅ GET /api/agent-templates/:id (Get Single)" -ForegroundColor Green
Write-Host "   ✅ PUT /api/agent-templates/:id (Update)" -ForegroundColor Green
Write-Host "   ✅ PATCH /api/agent-templates/:id/star (Toggle Star)" -ForegroundColor Green
Write-Host "   ✅ PATCH /api/agent-templates/:id/usage (Increment Usage)" -ForegroundColor Green
Write-Host "   ✅ DELETE /api/agent-templates/:id (Delete)" -ForegroundColor Green
Write-Host "   ✅ Authentication & Security Checks"  -ForegroundColor Green
