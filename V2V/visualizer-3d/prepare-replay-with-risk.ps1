param(
    [Parameter(Mandatory = $true)] [string]$OutputCsv,
    [Parameter(Mandatory = $true)] [string]$MosaicLogDirectory
)

$sourceCsv = (Resolve-Path -LiteralPath $OutputCsv -ErrorAction Stop).Path
$logRoot = (Resolve-Path -LiteralPath $MosaicLogDirectory -ErrorAction Stop).Path
$dataDirectory = Join-Path $PSScriptRoot "data"
$replayDestination = Join-Path $dataDirectory "output.csv"
$riskDestination = Join-Path $dataDirectory "safety-events.csv"
Copy-Item -LiteralPath $sourceCsv -Destination $replayDestination -Force

$pattern = 'RX DENM: time=(?<time>\d+), receiver=(?<receiver>[^,]+),.*?ttc=(?<ttc>Infinity|[-+0-9.Ee]+) s, risk=(?<risk>[A-Z_]+)'
$records = foreach ($logFile in Get-ChildItem -LiteralPath (Join-Path $logRoot "apps") -Filter "HardBrakeSafetyApp.log" -File -Recurse) {
    foreach ($line in Get-Content -LiteralPath $logFile.FullName) {
        if ($line -match $pattern) {
            [pscustomobject]@{ time=$Matches.time; receiver=$Matches.receiver; ttc=$Matches.ttc; risk=$Matches.risk }
        }
    }
}

"time;receiver;ttc;risk" | Set-Content -LiteralPath $riskDestination
$records | Sort-Object { [long]$_.time }, receiver -Unique | ForEach-Object {
    "$($_.time);$($_.receiver);$($_.ttc);$($_.risk)"
} | Add-Content -LiteralPath $riskDestination
Write-Host "Replay: $replayDestination"
Write-Host "Risk telemetry: $riskDestination ($($records.Count) records)"
