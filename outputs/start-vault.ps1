param([int]$Port = 8787)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$projectRoot = Split-Path -Parent $here
if (-not (Test-Path (Join-Path $projectRoot "node_modules\cheerio\package.json"))) {
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  & $npm install --prefix $projectRoot --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "Free search dependencies could not be installed." }
}
$env:VAULT_PORT = "$Port"
& $node (Join-Path $here "vault-toggle.js") on
