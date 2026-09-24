param([int]$Port = 8787)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$env:VAULT_PORT = "$Port"
& $node (Join-Path $here "vault-toggle.js") on
