# Fills DATABASE_URL and SUPABASE_SECRET_KEY in clinic-app\.env without opening the file.
# Run by double-clicking connect-supabase.bat. Nothing typed here is shown on screen or sent anywhere.
param([string]$Uri, [string]$Password, [string]$SecretKey)   # parameters only for testing; normally asked for below
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $PSScriptRoot '.env.example') $envFile }

function Plain($secure) { [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) }

Write-Host ''
Write-Host '  Connect CareDesk to Supabase' -ForegroundColor Cyan
Write-Host '  ----------------------------'
Write-Host '  1) In Supabase click "Connect" (top of the page) -> Connection String -> Type: URI -> Method: Session pooler'
Write-Host '     Copy the line that starts with postgresql:// (it still contains [YOUR-PASSWORD], that is fine).'
Write-Host '     To paste here: right-click in this window.'
Write-Host ''
if (-not $Uri) { $Uri = Read-Host '  Paste the connection string' }
$Uri = $Uri.Trim().Trim('"')
if ($Uri -notmatch '^postgres(ql)?://[^:]+:.+@[^/]+/\w+') { Write-Host '  That does not look like a postgresql:// connection string. Nothing was changed.' -ForegroundColor Red; exit 1 }
if ($Uri -match ':6543/') { Write-Host '  That is the "Transaction pooler" (port 6543). Please choose "Session pooler" (port 5432). Nothing was changed.' -ForegroundColor Red; exit 1 }

if ($Uri -match '\[YOUR-PASSWORD\]') {
  if (-not $Password) {
    Write-Host ''
    Write-Host '  2) Type your Supabase DATABASE password (letters are hidden while you type).'
    Write-Host '     Forgot it? Supabase -> Project Settings -> Database -> Reset database password.'
    $Password = Plain (Read-Host '  Database password' -AsSecureString)
  }
  if (-not $Password) { Write-Host '  No password typed. Nothing was changed.' -ForegroundColor Red; exit 1 }
  # symbols in passwords would break the address, so they are encoded safely
  $Uri = $Uri.Replace('[YOUR-PASSWORD]', [Uri]::EscapeDataString($Password))
}

if (-not $SecretKey) {
  Write-Host ''
  Write-Host '  3) In Supabase: Project Settings -> API Keys -> "Secret keys" -> copy the key starting with sb_secret_'
  Write-Host '     (NOT the "publishable" key). It is hidden while you paste.'
  Write-Host '     Optional for now: just press Enter to skip (photos are then kept on this PC).'
  $SecretKey = Plain (Read-Host '  Paste the secret key' -AsSecureString)
}
$SecretKey = $SecretKey.Trim()
if ($SecretKey -and $SecretKey -notmatch '^(sb_secret_|eyJ)') { Write-Host '  That is not a secret key (it should start with sb_secret_). Nothing was changed.' -ForegroundColor Red; exit 1 }

# replace (or add) the two lines, keeping everything else in .env as it is
$lines = [IO.File]::ReadAllLines($envFile)
$set = @{ 'DATABASE_URL' = $Uri; 'SUPABASE_SECRET_KEY' = $SecretKey }
foreach ($k in @($set.Keys)) {
  if (-not $set[$k]) { continue }
  $found = $false
  for ($i = 0; $i -lt $lines.Length; $i++) { if ($lines[$i] -match "^\s*#?\s*$k=") { $lines[$i] = "$k=$($set[$k])"; $found = $true; break } }
  if (-not $found) { $lines += "$k=$($set[$k])" }
}
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))
Write-Host ''
Write-Host '  Saved. Your Supabase details are now in clinic-app\.env' -ForegroundColor Green
Write-Host '  Go back to Claude and type: done'
Write-Host ''
