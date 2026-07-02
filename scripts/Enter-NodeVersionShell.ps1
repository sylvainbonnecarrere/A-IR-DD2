param(
    [string]$Version = '25.9.0',
    [switch]$InstallIfMissing
)

$nvmHome = 'C:\Users\Sylvain\AppData\Local\nvm'
$nvmSymlink = 'C:\nvm4w\nodejs'
$nvmExe = Join-Path $nvmHome 'nvm.exe'

if (-not (Test-Path $nvmExe)) {
    throw "nvm.exe introuvable a l'emplacement attendu: $nvmExe"
}

$env:NVM_HOME = $nvmHome
$env:NVM_SYMLINK = $nvmSymlink

$pathEntries = @($env:NVM_HOME, $env:NVM_SYMLINK) + ($env:Path -split ';' | Where-Object { $_ })
$env:Path = ($pathEntries | Select-Object -Unique) -join ';'

$installedVersions = & $nvmExe list 2>$null
$versionPattern = [regex]::Escape($Version)
$hasExactVersion = $installedVersions -match "(^|\s)$versionPattern(\s|$)"
$versionRoot = Join-Path $nvmHome ("v{0}" -f $Version)

if (-not $hasExactVersion -and $InstallIfMissing) {
    Write-Host "Installing Node $Version via nvm..."
    & $nvmExe install $Version
    if ($LASTEXITCODE -ne 0) {
        throw "nvm install $Version a echoue."
    }
} elseif (-not $hasExactVersion) {
    throw "Node $Version n'est pas installe. Relance avec -InstallIfMissing ou execute 'nvm install $Version'."
}

& $nvmExe use $Version
if ($LASTEXITCODE -ne 0) {
    throw "nvm use $Version a echoue."
}

$nodeExe = Join-Path $versionRoot 'node.exe'
$npmCmd = Join-Path $versionRoot 'npm.cmd'
$npxCmd = Join-Path $versionRoot 'npx.cmd'

if (-not (Test-Path $nodeExe)) {
    throw "node.exe introuvable apres activation de Node ${Version}: ${nodeExe}"
}

Set-Alias -Scope Global node $nodeExe
if (Test-Path $npmCmd) {
    Set-Alias -Scope Global npm $npmCmd
}
if (Test-Path $npxCmd) {
    Set-Alias -Scope Global npx $npxCmd
}

Write-Host "Node shell ready"
Write-Host "  version : $(& $nodeExe -v)"
Write-Host "  npm     : $(& $npmCmd -v)"
Write-Host "  nvm     : $(& $nvmExe version)"
Write-Host ""
Write-Host "Dot-source this script to affect the current shell:"
Write-Host "  . .\scripts\Enter-NodeVersionShell.ps1 -Version $Version"
Write-Host ""
Write-Host "This PowerShell session now targets Node $Version."