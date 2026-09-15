$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "PilotPaper V2 - Configuration OpenSolar" -ForegroundColor Cyan
Write-Host "Le token restera uniquement dans .env.local et ne sera jamais affiche." -ForegroundColor DarkGray
Write-Host ""

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

function Add-OrgCandidate([System.Collections.Generic.List[string]]$ids, [object]$value) {
  if ($null -eq $value) { return }
  $text = [string]$value
  if ($text -match '^\d+$') {
    if (-not $ids.Contains($text)) { $ids.Add($text) }
    return
  }
  if ($text -match '/api/orgs/(\d+)/?') {
    $id = $Matches[1]
    if (-not $ids.Contains($id)) { $ids.Add($id) }
  }
}

function Find-OrgCandidates([object]$node, [System.Collections.Generic.List[string]]$ids, [int]$depth = 0) {
  if ($null -eq $node -or $depth -gt 7) { return }

  if ($node -is [string] -or $node -is [ValueType]) {
    Add-OrgCandidate $ids $node
    return
  }

  if ($node -is [System.Collections.IEnumerable] -and -not ($node -is [System.Collections.IDictionary]) -and -not ($node -is [pscustomobject])) {
    foreach ($item in $node) { Find-OrgCandidates $item $ids ($depth + 1) }
    return
  }

  foreach ($property in $node.PSObject.Properties) {
    $name = [string]$property.Name
    $value = $property.Value
    if ($name -match '^(org_id|orgId|organization_id|organisation_id)$') {
      Add-OrgCandidate $ids $value
    } elseif ($name -match '^(org|organization|organisation)$') {
      Add-OrgCandidate $ids $value
      Find-OrgCandidates $value $ids ($depth + 1)
    } elseif ($name -match '^(orgs|organizations|organisations|user|role|roles|data|results)$') {
      Find-OrgCandidates $value $ids ($depth + 1)
    }
  }
}

$orgIds = New-Object 'System.Collections.Generic.List[string]'
try {
  $session = Invoke-RestMethod -Method Get -Uri "https://api.opensolar.com/api/fetch_token/" -Headers $headers
  if ($session.token) {
    $bearer = [string]$session.token
    $headers = @{ Authorization = "Bearer $bearer" }
  }
  Find-OrgCandidates $session $orgIds
} catch {
  Write-Host "Detection automatique de l'organisation indisponible. PilotPaper demandera l'ID manuellement." -ForegroundColor Yellow
}

$validOrgs = @()
foreach ($candidateId in $orgIds) {
  try {
    $candidateOrg = Invoke-RestMethod -Method Get -Uri "https://api.opensolar.com/api/orgs/$candidateId/" -Headers $headers
    $validOrgs += [pscustomobject]@{ id = [string]$candidateId; name = [string]$candidateOrg.name; data = $candidateOrg }
  } catch {
    # Ignore candidates that are not actual accessible organisations.
  }
}

if ($validOrgs.Count -eq 1) {
  $orgId = $validOrgs[0].id
  $org = $validOrgs[0].data
  Write-Host ("Organisation detectee automatiquement : {0} (ID {1})" -f $validOrgs[0].name, $orgId) -ForegroundColor Green
} elseif ($validOrgs.Count -gt 1) {
  Write-Host "Plusieurs organisations OpenSolar sont accessibles :" -ForegroundColor Yellow
  for ($i = 0; $i -lt $validOrgs.Count; $i++) {
    Write-Host ("  [{0}] {1} (ID {2})" -f ($i + 1), $validOrgs[$i].name, $validOrgs[$i].id)
  }
  $choice = Read-Host "Numero de l'organisation a utiliser"
  $choiceIndex = [int]$choice - 1
  if ($choiceIndex -lt 0 -or $choiceIndex -ge $validOrgs.Count) { throw "Choix d'organisation invalide." }
  $orgId = $validOrgs[$choiceIndex].id
  $org = $validOrgs[$choiceIndex].data
} else {
  $orgId = Read-Host "ID de votre organisation OpenSolar (detection automatique impossible)"
  if (-not ($orgId -match '^\d+$')) { throw "ID organisation invalide. Il doit contenir uniquement des chiffres." }
  try {
    $org = Invoke-RestMethod -Method Get -Uri "https://api.opensolar.com/api/orgs/$orgId/" -Headers $headers
  } catch {
    throw "Le token est valide mais l'organisation $orgId n'est pas accessible avec ce compte."
  }
}

# Validate that the enabled organisation can at least reach its Projects endpoint.
try {
  $null = Invoke-RestMethod -Method Get -Uri "https://api.opensolar.com/api/orgs/$orgId/projects/?limit=1&fieldset=list" -Headers $headers
} catch {
  throw "Connexion OpenSolar valide, mais l'API de l'organisation n'est pas encore accessible. Attendez quelques minutes puis relancez cette commande."
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
Write-Host "Raw Data reste en observation : OPENSOLAR_ENABLED=false tant que le POC n'est pas valide." -ForegroundColor Yellow
Write-Host "Le token a ete enregistre localement dans .env.local et n'a pas ete affiche." -ForegroundColor DarkGray
Write-Host ""
