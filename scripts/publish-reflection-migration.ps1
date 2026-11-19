param([Parameter(Mandatory=$true)][string]$PlanFile)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedPlan=(Resolve-Path -LiteralPath $PlanFile).Path
$artifactRoot=[IO.Path]::GetFullPath((Join-Path $repoRoot 'artifacts/memory-v0.4.0-p4b'))
if(-not $resolvedPlan.StartsWith($artifactRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'P4-B artifact plan required'}
$plan=Get-Content -LiteralPath $resolvedPlan -Raw | ConvertFrom-Json
$package=Get-Content -LiteralPath (Join-Path $repoRoot 'apps/stage-desktop/package.json') -Raw | ConvertFrom-Json
$expectedProfile=[IO.Path]::GetFullPath((Join-Path $env:APPDATA ($package.name+'-note-v2')))
if($plan.profile -cne $expectedProfile){throw 'Plan does not name the actual P2 formal Profile'}
$runtime=Join-Path $plan.resources 'runtime/node.exe'
$manifest=& $runtime -e 'const fs=require("node:fs"),c=require("node:crypto"),plan=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(fs.realpathSync(plan.profile)!==plan.profile||fs.lstatSync(plan.profile).isSymbolicLink())throw Error("Noncanonical formal Profile");process.stdout.write(c.createHash("sha256").update(JSON.stringify(plan)).digest("hex"))' $resolvedPlan
if($LASTEXITCODE -or $manifest -notmatch '^[a-f0-9]{64}$'){throw 'Cannot freeze publish manifest'}
function Assert-Offline {
 $active=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(electron|Aisling)(\.exe)?$' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($repoRoot))})
 if($active.Count){throw 'Application/Worker active; close normally before maintenance'}
}
Assert-Offline
$guardFile=Join-Path $plan.profile 'memory-maintenance.v1.json'
if(Test-Path -LiteralPath $guardFile){
 $guard=Get-Content -LiteralPath $guardFile -Raw | ConvertFrom-Json
 if($guard.id -ne $plan.id -or $guard.kind -ne $plan.kind -or $guard.manifest -ne $manifest){throw 'Different/unknown maintenance lock; do not remove it'}
}else{
 $guard=@{id=$plan.id;kind=$plan.kind;manifest=$manifest;token=[Guid]::NewGuid().ToString()}
 $handle=[IO.File]::Open($guardFile,'CreateNew','Write','None')
 try{$bytes=[Text.Encoding]::UTF8.GetBytes(($guard|ConvertTo-Json -Compress));$handle.Write($bytes);$handle.Flush($true)}finally{$handle.Dispose()}
}
$held=[Collections.Generic.List[IDisposable]]::new()
$previousToken=$env:AISLING_P4B_OFFLINE_LOCK
try{
 Assert-Offline
 foreach($file in Get-ChildItem -LiteralPath $plan.profile -File -Force -Recurse){
  $relative=[IO.Path]::GetRelativePath($plan.profile,$file.FullName)
  if($relative -match '^memory-note-v2\\' -or ($plan.postCommit.registerImportedNotes -and $relative -eq 'note-formation-jobs.v1.json')){
   $probe=[IO.File]::Open($file.FullName,'Open','Read','None');$probe.Dispose()
  }elseif($relative -match '(^|\\)(aisling-|memory-|note-formation)'){
   $held.Add([IO.File]::Open($file.FullName,'Open','Read','Read'))
  }
 }
 $env:AISLING_P4B_OFFLINE_LOCK=$guard.token
 & $runtime (Join-Path $PSScriptRoot 'publish-reflection-migration.cjs') $resolvedPlan publish
 if($LASTEXITCODE){throw 'Publish incomplete: keep the maintenance lock and resume using this exact plan'}
 # Remove only this run's guard after its Worker has closed and its receipt journal is complete.
 $current=Get-Content -LiteralPath $guardFile -Raw | ConvertFrom-Json
 if($current.id -ne $plan.id -or $current.manifest -ne $manifest){throw 'Maintenance lock changed'}
 foreach($handle in $held){$handle.Dispose()};$held.Clear()
 Remove-Item -LiteralPath $guardFile
}finally{
 foreach($handle in $held){$handle.Dispose()}
 $env:AISLING_P4B_OFFLINE_LOCK=$previousToken
}
