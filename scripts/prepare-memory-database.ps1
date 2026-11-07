param(
    [Parameter(Mandatory = $true)][string]$Node,
    [Parameter(Mandatory = $true)][string]$NodeMsi,
    [string]$OutputDirectory,
    [string]$Cache,
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'apps/stage-desktop/memory-database'
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root '.local/memory-database' }
$out = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $out) { throw 'Use a fresh resource directory' }
$nodeHash = (Get-FileHash -LiteralPath $Node).Hash
$msiHash = (Get-FileHash -LiteralPath $NodeMsi).Hash
if ($nodeHash -ne '2FFE3ACC0458FDDE999F50D11809BBE7C9B7EF204DCF17094E325D26ACE101D8' -or
    $msiHash -ne 'E3A50A907B6C71D9F3CB7571980CF3070EC0FADC6FB2A55516D5FF95083990F3') {
    throw 'Expected official Node.js 24.12.0 Windows x64 executable and MSI'
}

$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase((Resolve-Path -LiteralPath $NodeMsi).Path, 0)
$view = $database.OpenView('SELECT `Text` FROM `Control` WHERE `Dialog_` = ''LicenseAgreementDlg'' AND `Control` = ''LicenseText''')
$view.Execute()
try {
    $row = $view.Fetch()
    $license = $row.StringData(1)
    if ($license -notmatch 'Node.js is licensed' -or $license -notmatch 'Third-Party' -or $license -cmatch '[^\u0000-\u007F]') {
        throw 'Expected Node distribution license and third-party notices'
    }
}
finally { $view.Close() }

New-Item -ItemType Directory -Path (Join-Path $out 'runtime') | Out-Null
Copy-Item -LiteralPath $Node -Destination (Join-Path $out 'runtime/node.exe')
Set-Content -LiteralPath (Join-Path $out 'runtime/LICENSE.rtf') -Value $license -NoNewline -Encoding ascii
Copy-Item -LiteralPath (Join-Path $source 'package.json'), (Join-Path $source 'package-lock.json') -Destination $out

$installArgs = @('ci', '--prefix', $out, '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund')
if ($Cache) { $installArgs += @('--cache', $Cache) }
if ($Offline) { $installArgs += '--offline' }
& npm @installArgs
if ($LASTEXITCODE) { throw "Pinned Worker dependency installation failed ($LASTEXITCODE)" }

$addon = Join-Path $out 'node_modules/@ladybugdb/core-win32-x64/lbugjs.node'
$addonHash = (Get-FileHash -LiteralPath $addon).Hash
if ($addonHash -ne '2BD7B8487B1BDB20AA334718682724567BDFED5E2DD17592D4AC349C3D1B5E1C') {
    throw 'Expected the official LadybugDB 0.22.1 Windows x64 addon'
}
Copy-Item -LiteralPath $addon -Destination (Join-Path $out 'node_modules/@ladybugdb/core/lbugjs.node')
Copy-Item -LiteralPath (Join-Path $source 'adapter.cjs'), (Join-Path $source 'protocol.cjs'), (Join-Path $source 'worker.cjs'), (Join-Path $source 'note-v1.cjs'), (Join-Path $source 'erasure.cjs') -Destination $out
@{ node = '24.12.0'; nodeSha256 = $nodeHash; ladybug = '0.22.1'; addonSha256 = $addonHash
   nodeLicenseSha256 = (Get-FileHash -LiteralPath (Join-Path $out 'runtime/LICENSE.rtf')).Hash
   resourceDirectory = $out } | ConvertTo-Json
