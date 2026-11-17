param(
    [Parameter(Mandatory)][ValidateSet('backup','verify','publish')][string]$Mode,
    [Parameter(Mandatory)][string]$InputFile
)
$ErrorActionPreference = 'Stop'
$arguments = Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
$repository = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $arguments.resources 'runtime/node.exe'
$held = [Collections.Generic.List[IDisposable]]::new()
try {
    # Query failure is a blocker. Never stop an app on the user's behalf.
    $active = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '^(electron|Aisling)(\.exe)?$' -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($repository) -and
        $_.CommandLine -notmatch 'unify-memory-profile|profile-unification.test')
    })
    if ($active.Count) { throw "Close Desktop, launcher and Worker before transfer (PIDs $($active.ProcessId -join ', '))." }
    foreach ($root in @($arguments.source, $arguments.legacy)) {
        foreach ($file in Get-ChildItem -LiteralPath $root -File -Recurse -Force) {
            $relative = [IO.Path]::GetRelativePath($root, $file.FullName)
            if ($relative -match '^(aisling-|memory-|note-formation)') {
                $held.Add([IO.File]::Open($file.FullName, 'Open', 'Read', 'Read'))
            }
        }
    }
    & $runtime (Join-Path $PSScriptRoot 'unify-memory-profile.cjs') $Mode $InputFile
    if ($LASTEXITCODE) { throw "Profile operation failed ($LASTEXITCODE); preserve backup and staged files." }
} finally { foreach ($handle in $held) { $handle.Dispose() } }
