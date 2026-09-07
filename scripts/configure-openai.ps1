$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DevVars = Join-Path $ProjectRoot ".dev.vars"

function Read-SecretValue([string]$Prompt) {
  $Secure = Read-Host $Prompt -AsSecureString
  $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

$Key = Read-SecretValue "Collez la clé OpenAI du projet PilotPaper (elle ne sera pas affichée)"
if ([string]::IsNullOrWhiteSpace($Key) -or -not $Key.StartsWith("sk-")) {
  throw "La clé OpenAI paraît invalide. Aucun fichier n'a été modifié."
}
$Content = @"
OPENAI_API_KEY=$Key
DP_ANALYSIS_MODEL=gpt-5.6-sol
DP_JUDGE_MODEL=gpt-5.6-sol
DP_IMAGE_MODEL=gpt-image-2
DP_IMAGE_PROVIDER=openai
DP_MAX_RETRIES=5
DP_QA_PASS_SCORE=0.96
DP_REALISM_PASS_SCORE=0.97
"@
$Utf8WithoutBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($DevVars, $Content.Trim() + [Environment]::NewLine, $Utf8WithoutBom)
$Key = $null
Write-Host "[PilotPaper] Clé enregistrée localement dans .dev.vars. Elle est ignorée par Git."
