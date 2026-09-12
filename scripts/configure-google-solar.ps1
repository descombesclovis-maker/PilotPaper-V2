$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DevVars = Join-Path $ProjectRoot ".dev.vars"

function Read-SecretValue([string]$Prompt) {
  $Secure = Read-Host $Prompt -AsSecureString
  $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

$Key = Read-SecretValue "Collez la clé Google Cloud autorisée pour Solar API (elle ne sera pas affichée)"
if ([string]::IsNullOrWhiteSpace($Key) -or $Key.Length -lt 20) {
  throw "La clé Google Solar API paraît invalide. Aucun fichier n'a été modifié."
}

$Lines = @()
if (Test-Path $DevVars) {
  $Lines = Get-Content $DevVars | Where-Object { $_ -notmatch '^GOOGLE_SOLAR_API_KEY=' }
}
$Lines += "GOOGLE_SOLAR_API_KEY=$Key"
$Utf8WithoutBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($DevVars, (($Lines -join [Environment]::NewLine).Trim() + [Environment]::NewLine), $Utf8WithoutBom)
$Key = $null
Write-Host "[PilotPaper] Clé Google Solar API enregistrée localement dans .dev.vars. Elle est ignorée par Git."
