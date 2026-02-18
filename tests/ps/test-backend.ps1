$body = @{
    email = "testuser-$(Get-Random 100000)@example.com"
    password = "TestPassword123!"
    fullName = "Test User"
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
}

Write-Host "Testing POST /api/auth/register..." -ForegroundColor Cyan

try {
    $response = Invoke-WebRequest `
        -Uri "http://localhost:3001/api/auth/register" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop
    
    Write-Host "✅ SUCCESS - Status 201 Created" -ForegroundColor Green
    Write-Host "Backend is working correctly with JWT_SECRET and ENCRYPTION_KEY!" -ForegroundColor Green
    
} catch {
    $statusCode = $_.Exception.Response.StatusCode.Value__
    Write-Host "❌ ERROR - Status $statusCode" -ForegroundColor Red
    
    if ($statusCode -eq 500) {
        Write-Host "Backend crash detected! Variables d'environnement may be missing." -ForegroundColor Red
    }
}
