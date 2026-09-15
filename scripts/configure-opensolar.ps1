$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "PilotPaper V2 - Configuration OpenSolar" -ForegroundColor Cyan
Write-Host "Le token restera uniquement dans .env.local et ne sera jamais affiche." -ForegroundColor DarkGray
Write-Host ""

$orgId = Read-Host "ID de votre organisation OpenSolar"
if (-not ($orgId -match '^\d+$')) {
  throw "ID organisation invalide. Il doit contenir uniquement des chiffres."
}

$email = Read-Host "E-mail OpenSolar"
if ([string]::IsNullOrWhiteSpace($email)) {
  throw "E-mail OpenSolar requis."
}

$securePassword = Read-Host "Mot de passe OpenSolar" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$mfa = Read-Host "Code MFA actuel si votre compte l'utilise (Entrée sinon)"
$payload = @{
  username = $email
  password = $password
}
if (-not [string]::IsNullOrWhiteSpace($mfa)) {
  $payload.token = $mfa
}

try {
  $auth = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.opensolar.com/api-token-auth/" `
    -ContentType "application/json" `
    -Body ($payload | ConvertTo-Json -Compress)
} finally {
  $password = $null
  $payload.password = $null
}

$bearer = [string]$auth.token
if ([string]::IsNullOrWhiteSpace($bearer)) {
  throw "OpenSolar n'a retourne aucun Bearer token. Verifiez vos identifiants/MFA."
}

$headers = @{ Authorization = "Bearer $bearer" }
try {
  $org = Invoke-RestMethod -Method Get -Uri "https://api.opensolar.com/api/orgs/$orgId/" -Headers $headers
} catch {
  throw "Le token est valide mais l'organisation $orgId n'est pas accessible avec ce compte."
}

$envPath = Join-Path (Get-Location) ".env.local"
$existing = @()
if (Test-Path $envPath) {
  $existing = Get-Content $envPath | Where-Object {
    $_ -notmatch '^OPENSOLAR_ENABLED=' -and
    $_ -notmatch '^OPENSOLAR_ORG_ID=' -and
    $_ -notmatch '^OPENSOLAR_BEARER_TOKEN='
  }
}

$newLines = @(
  $existing
  "OPENSOLAR_ENABLED=false"
  "OPENSOLAR_ORG_ID=$orgId"
  "OPENSOLAR_BEARER_TOKEN=$bearer"
)
Set-Content -Path $envPath -Value $newLines -Encoding UTF8

Write-Host ""
Write-Host "Connexion OpenSolar validee." -ForegroundColor Green
Write-Host ("Organisation : {0} (ID {1})" -f [string]$org.name, $orgId) -ForegroundColor Green
Write-Host "PilotPaper V2 reste volontairement en mode POC : OPENSOLAR_ENABLED=false." -ForegroundColor Yellow
Write-Host "Le token a ete enregistre localement dans .env.local et n'a pas ete affiche." -ForegroundColor DarkGray
Write-Host ""
