# Start Billforce.exe in check mode (--smoke-test, see electron/smoke.ts) and fail if any check fails.
# Used by .github/workflows/desktop.yml on the unpacked app and on the app installed by Billforce-Setup.exe.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Name
)
$ErrorActionPreference = 'Stop'
$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$report = Join-Path $temp "billforce-smoke-$Name.json"
$data = Join-Path $temp "billforce-smoke-data-$Name"
Remove-Item -LiteralPath $report, $data -Recurse -Force -ErrorAction SilentlyContinue

$p = Start-Process -FilePath $Exe -ArgumentList "--smoke-test=$report", "--data-dir=$data" -PassThru
$null = $p.Handle # keeps the exit code readable after the app quits
if (-not $p.WaitForExit(240000)) {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  throw "Billforce ($Name) did not finish its checks within 4 minutes"
}
if (-not (Test-Path -LiteralPath $report)) { throw "Billforce ($Name) wrote no report (exit code $($p.ExitCode))" }
Get-Content -LiteralPath $report
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
if (-not $result.ok -or $p.ExitCode -ne 0) { throw "Billforce ($Name) checks failed: $($result.error)" }
Write-Host "All Billforce checks passed ($Name, Electron $($result.electron))"
