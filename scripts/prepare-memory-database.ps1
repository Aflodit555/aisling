[CmdletBinding(DefaultParameterSetName = 'Refresh')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Install')][string]$Node,
    [Parameter(Mandatory, ParameterSetName = 'Install')][string]$NodeMsi,
    [string]$OutputDirectory,
    [string]$OpenSslDirectory,
    [Parameter(ParameterSetName = 'Install')][string]$Cache,
    [Parameter(ParameterSetName = 'Install')][switch]$Offline
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'apps/stage-desktop/memory-database'
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root '.local/memory-database' }
$out = [System.IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\', '/')
$manifests = @('package.json', 'package-lock.json')
$workerFiles = @('adapter.cjs', 'protocol.cjs', 'worker.cjs', 'note-v1.cjs', 'erasure.cjs')
$nodeHash = '2FFE3ACC0458FDDE999F50D11809BBE7C9B7EF204DCF17094E325D26ACE101D8'
$addonHash = '2BD7B8487B1BDB20AA334718682724567BDFED5E2DD17592D4AC349C3D1B5E1C'
$msiHash = 'E3A50A907B6C71D9F3CB7571980CF3070EC0FADC6FB2A55516D5FF95083990F3'
$nativePackage = 'node_modules/@ladybugdb/core-win32-x64/lbugjs.node'
$nativeLoaded = 'node_modules/@ladybugdb/core/lbugjs.node'

function Assert-Hash($File, $Expected) {
    $item = Get-Item -LiteralPath $File
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Resource cannot be a link: $File" }
    if ((Get-FileHash -LiteralPath $File).Hash -ne $Expected) { throw "Resource hash mismatch: $File" }
}

function Test-SourceCopies($Directory, $Files) {
    foreach ($file in $Files) {
        $copy = Join-Path $Directory $file
        if (!(Test-Path -LiteralPath $copy -PathType Leaf) -or
            (Get-FileHash -LiteralPath $copy).Hash -ne (Get-FileHash -LiteralPath (Join-Path $source $file)).Hash) { return $false }
    }
    return $true
}

function Assert-Runtime($Directory) {
    $ssl = Join-Path $Directory 'runtime/libssl-3-x64.dll'
    $crypto = Join-Path $Directory 'runtime/libcrypto-3-x64.dll'
    if ((Test-Path -LiteralPath $ssl) -or (Test-Path -LiteralPath $crypto)) {
        Assert-Hash $ssl 'E028A7F4FC1E4E197DFAE99F7DF5E14F57FB7E0282D03E903521FC99C0C76D89'
        Assert-Hash $crypto '3B65CFD779E238A2947A0AA8911CC67AAEF866977AF6A69B4D39E7D587EBF262'
    }
    Assert-Hash (Join-Path $Directory 'runtime/node.exe') $nodeHash
    Assert-Hash (Join-Path $Directory $nativePackage) $addonHash
    Assert-Hash (Join-Path $Directory $nativeLoaded) $addonHash
    $notice = Get-Content -LiteralPath (Join-Path $Directory 'runtime/LICENSE.rtf') -Raw
    if ($notice -notmatch 'Node.js is licensed' -or $notice -notmatch 'Third-Party' -or $notice -cmatch '[^\u0000-\u007F]') {
        throw 'Expected Node distribution license and third-party notices'
    }
    & (Join-Path $Directory 'runtime/node.exe') --no-global-search-paths -e "const a=require('node:assert/strict');const r=require('node:module').createRequire(process.argv[1]);a.equal(process.arch,'x64');a.equal(process.platform,'win32');a.equal(process.versions.node,'24.12.0');a.equal(r('@ladybugdb/core').VERSION,'0.22.1')" (Join-Path $Directory 'package.json')
    if ($LASTEXITCODE) { throw "Pinned Worker runtime failed validation ($LASTEXITCODE)" }
}

function Assert-WorkerStopped {
    $expected = Join-Path $out 'runtime/node.exe'
    foreach ($process in @(Get-Process -Name node -ErrorAction SilentlyContinue)) {
        if (!$process.HasExited -and (!$process.Path -or $process.Path -ieq $expected)) {
            throw "Close Desktop and any Worker using these resources, then retry (Node PID $($process.Id))."
        }
    }
}

$parent = Split-Path -Parent $out
if (!(Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
$lockPath = "$out.update.lock"
try { $lock = [IO.File]::Open($lockPath, 'CreateNew', 'Write', 'None') }
catch { throw "Cannot acquire resource update lock at $lockPath. Stop the active updater or Worker startup before retrying." }
$stage = "$out.stage-$([Guid]::NewGuid().ToString('N'))"
$backup = $null
$status = 'current'
try {
    if ($PSCmdlet.ParameterSetName -eq 'Refresh') {
        $existing = Get-Item -LiteralPath $out
        if (!$existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Expected an existing, ordinary Worker resource directory'
        }
        if (!(Test-SourceCopies $out $manifests)) {
            throw 'Pinned dependency manifests differ. Prepare a fresh directory with -Node and -NodeMsi.'
        }
        Assert-Runtime $out
        if (!(Test-SourceCopies $out $workerFiles) -or $OpenSslDirectory) {
            Assert-WorkerStopped
            New-Item -ItemType Directory -Path $stage | Out-Null
            foreach ($directory in @('runtime', 'node_modules') + @(if (Test-Path -LiteralPath (Join-Path $out '.lbdb')) { '.lbdb' })) {
                $inputTree = Get-Item -LiteralPath (Join-Path $out $directory)
                if (($inputTree.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
                    (Get-ChildItem -LiteralPath $inputTree.FullName -Recurse -Force -Attributes ReparsePoint | Select-Object -First 1)) {
                    throw "Resource directory contains links: $directory"
                }
                Copy-Item -LiteralPath $inputTree.FullName -Destination $stage -Recurse
            }
            $backup = "$out.previous-$([Guid]::NewGuid().ToString('N'))"
            $status = 'refreshed'
        }
    }
    else {
        if (Test-Path -LiteralPath $out) { throw 'Use a fresh resource directory for installation, or refresh without -Node and -NodeMsi' }
        Assert-Hash $Node $nodeHash
        Assert-Hash $NodeMsi $msiHash
        $installer = New-Object -ComObject WindowsInstaller.Installer
        $database = $installer.OpenDatabase((Resolve-Path -LiteralPath $NodeMsi).Path, 0)
        $view = $database.OpenView('SELECT `Text` FROM `Control` WHERE `Dialog_` = ''LicenseAgreementDlg'' AND `Control` = ''LicenseText''')
        $view.Execute()
        try { $license = $view.Fetch().StringData(1) }
        finally { $view.Close() }
        New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') | Out-Null
        Copy-Item -LiteralPath $Node -Destination (Join-Path $stage 'runtime/node.exe')
        Set-Content -LiteralPath (Join-Path $stage 'runtime/LICENSE.rtf') -Value $license -NoNewline -Encoding ascii
        $manifests | ForEach-Object { Copy-Item -LiteralPath (Join-Path $source $_) -Destination $stage }
        $installArgs = @('ci', '--prefix', $stage, '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund')
        if ($Cache) { $installArgs += @('--cache', $Cache) }
        if ($Offline) { $installArgs += '--offline' }
        & npm @installArgs
        if ($LASTEXITCODE) { throw "Pinned Worker dependency installation failed ($LASTEXITCODE)" }
        Assert-Hash (Join-Path $stage $nativePackage) $addonHash
        Copy-Item -LiteralPath (Join-Path $stage $nativePackage) -Destination (Join-Path $stage $nativeLoaded)
        $status = 'installed'
    }

    if ($status -ne 'current') {
        if ($OpenSslDirectory) {
            foreach ($dependency in @(@('libssl-3-x64.dll','E028A7F4FC1E4E197DFAE99F7DF5E14F57FB7E0282D03E903521FC99C0C76D89'),@('libcrypto-3-x64.dll','3B65CFD779E238A2947A0AA8911CC67AAEF866977AF6A69B4D39E7D587EBF262'))) {
                $inputFile = Join-Path $OpenSslDirectory $dependency[0]
                Assert-Hash $inputFile $dependency[1]
                if ((Get-AuthenticodeSignature -LiteralPath $inputFile).Status -ne 'Valid') { throw 'OpenSSL signature invalid' }
                Copy-Item -LiteralPath $inputFile -Destination (Join-Path $stage ('runtime/' + $dependency[0]))
            }
        }
        foreach ($file in $manifests + $workerFiles) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination $stage -Force }
        Assert-Runtime $stage
        if (!(Test-SourceCopies $stage ($manifests + $workerFiles))) { throw 'Staged Worker files differ from source' }
        if ($backup) {
            Assert-WorkerStopped
            [IO.Directory]::Move($out, $backup)
        }
        try { [IO.Directory]::Move($stage, $out) }
        catch {
            if ($backup) {
                try { [IO.Directory]::Move($backup, $out) }
                catch { throw "Resource switch and rollback failed. Restore $backup to $out after closing Desktop." }
            }
            throw
        }
    }
    @{ status = $status; node = '24.12.0'; nodeSha256 = $nodeHash; ladybug = '0.22.1'; addonSha256 = $addonHash
       nodeLicenseSha256 = (Get-FileHash -LiteralPath (Join-Path $out 'runtime/LICENSE.rtf')).Hash
       resourceDirectory = $out; backupDirectory = $backup } | ConvertTo-Json
}
finally {
    $lock.Dispose()
    Remove-Item -LiteralPath $lockPath
}
