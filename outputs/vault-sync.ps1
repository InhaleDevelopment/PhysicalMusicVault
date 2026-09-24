param(
  [string]$MusicRoot = (Join-Path $HOME "Music"),
  [string]$VaultPath = (Join-Path $PSScriptRoot "vault-data.json"),
  [switch]$Loop,
  [int]$IntervalSeconds = 600
)

$ErrorActionPreference = "Stop"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$syncScript = Join-Path $PSScriptRoot "vault-sync.js"

do {
  & $node $syncScript $MusicRoot $VaultPath
  if ($LASTEXITCODE -ne 0) {
    throw "Music folder sync failed with exit code $LASTEXITCODE."
  }
  if ($Loop) {
    Start-Sleep -Seconds $IntervalSeconds
  }
} while ($Loop)
