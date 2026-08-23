param(
    [Parameter(Mandatory = $true)]
    [string]$OutputCsv
)

$source = Resolve-Path -LiteralPath $OutputCsv -ErrorAction Stop
$destination = Join-Path $PSScriptRoot "data\output.csv"
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host "MOSAIC replay copied to $destination"
