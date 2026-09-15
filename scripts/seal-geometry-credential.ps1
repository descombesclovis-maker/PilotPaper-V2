$ErrorActionPreference = "Stop"

function Import-ProtectedDataAssembly {
  try {
    [void][System.Reflection.Assembly]::Load("System.Security.Cryptography.ProtectedData")
    return
  } catch {
    # Continue with explicit loading below. PowerShell 7 does not always preload this assembly.
  }

  try {
    Add-Type -AssemblyName "System.Security.Cryptography.ProtectedData" -ErrorAction Stop
    return
  } catch {
    # Continue with the restored NuGet package below.
  }

  $packageRoot = Join-Path $env:USERPROFILE ".nuget\packages\system.security.cryptography.protecteddata\8.0.0"
  $assemblyCandidates = @(
    (Join-Path $packageRoot "lib\net8.0\System.Security.Cryptography.ProtectedData.dll"),
    (Join-Path $packageRoot "lib\net6.0\System.Security.Cryptography.ProtectedData.dll"),
    (Join-Path $packageRoot "lib\netstandard2.0\System.Security.Cryptography.ProtectedData.dll")
  )

  $assemblyPath = $assemblyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $assemblyPath) {
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    $project = Join-Path (Get-Location) "desktop\PilotPaperLauncher\PilotPaperLauncher.csproj"
    if ($dotnet -and (Test-Path $project)) {
      & $dotnet.Source restore $project --nologo | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Le composant de chiffrement Windows n'a pas pu être restauré." }
      $assemblyPath = $assemblyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    }
  }

  if (-not $assemblyPath) {
    throw "Le composant de chiffrement Windows DPAPI est introuvable sur ce poste."
  }

  Add-Type -Path $assemblyPath -ErrorAction Stop
}

Import-ProtectedDataAssembly

$envPath = Join-Path (Get-Location) ".env.local"
if (-not (Test-Path $envPath)) {
  throw "Configuration locale introuvable. La connexion technique doit déjà avoir été validée sur ce poste."
}

$vars = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^([^#=]+)=(.*)$') { $vars[$Matches[1].Trim()] = $Matches[2].Trim() }
}

$token = [string]$vars["OPENSOLAR_BEARER_TOKEN"]
$orgId = [string]$vars["OPENSOLAR_ORG_ID"]
if ([string]::IsNullOrWhiteSpace($token) -or -not ($orgId -match '^\d+$')) {
  throw "La session technique existante est incomplète."
}

$headers = @{ Authorization = "Bearer $token" }
$session = Invoke-RestMethod -Method Get -Uri "https://api.opensolar.com/api/fetch_token/?org_id=$orgId" -Headers $headers
if ($session.token) {
  $token = [string]$session.token
  $headers = @{ Authorization = "Bearer $token" }
}

function Find-UserId([object]$node, [int]$depth = 0) {
  if ($null -eq $node -or $depth -gt 8) { return $null }
  if ($node -is [string]) {
    if ($node -match '/auth/users/(\d+)/?') { return [int]$Matches[1] }
    return $null
  }
  foreach ($property in $node.PSObject.Properties) {
    if ($property.Name -eq 'user') {
      if ($property.Value -is [string] -and $property.Value -match '/auth/users/(\d+)/?') { return [int]$Matches[1] }
      if ($property.Value.PSObject.Properties['id']) {
        $parsed = 0
        if ([int]::TryParse([string]$property.Value.id, [ref]$parsed) -and $parsed -gt 0) { return $parsed }
      }
    }
    $nested = Find-UserId $property.Value ($depth + 1)
    if ($nested) { return $nested }
  }
  return $null
}

$userId = Find-UserId $session
if (-not $userId) { throw "L'identifiant technique du compte n'a pas pu être déterminé." }

$machinePayload = @{ is_machine_user = $true } | ConvertTo-Json -Compress
Invoke-RestMethod `
  -Method Patch `
  -Uri "https://api.opensolar.com/auth/users/$userId/" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $machinePayload | Out-Null

Invoke-RestMethod -Method Get -Uri "https://api.opensolar.com/api/orgs/$orgId/projects/?limit=1&fieldset=list" -Headers $headers | Out-Null

$credential = @{
  Token = $token
  OrgId = [int]$orgId
  UserId = [int]$userId
  SchemaVersion = 1
} | ConvertTo-Json -Compress

$plain = [Text.Encoding]::UTF8.GetBytes($credential)
$entropy = [Text.Encoding]::UTF8.GetBytes("PilotPaper-V2-GeometryEngine-v1")
try {
  $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    $plain,
    $entropy,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $targetDir = Join-Path $env:LOCALAPPDATA "PilotPaper\V2"
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $targetDir "geometry-engine.bin"), $encrypted)
} finally {
  if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
}

$cleaned = Get-Content $envPath | Where-Object { $_ -notmatch '^OPENSOLAR_' }
Set-Content -Path $envPath -Value $cleaned -Encoding UTF8

Write-Host ""
Write-Host "Connexion permanente PilotPaper V2 activée." -ForegroundColor Green
Write-Host "Le jeton est désormais chiffré par Windows et n'est plus stocké en clair dans .env.local." -ForegroundColor DarkGray
Write-Host "Aucune reconnexion périodique ne sera nécessaire tant que l'accès n'est pas révoqué." -ForegroundColor Green
Write-Host ""
