param(
  [switch]$Post,
  [string]$WeekId,
  [string]$Token,
  [string]$Site = 'https://iryspredict.xyz'
)

if (-not $Token) {
  if ($env:SNAPSHOT_TOKEN) { $Token = $env:SNAPSHOT_TOKEN } else { Write-Error "Provide -Token or set SNAPSHOT_TOKEN env var"; exit 1 }
}

try {
  if ($Post) {
    $resp = Invoke-RestMethod -Uri "$Site/api/snapshot_week" -Method Post -Headers @{ 'x-snapshot-token' = $Token }
    $weekId = $resp.weekId
    if (-not $weekId) { Write-Error "No weekId in response"; exit 2 }
  } else {
    if (-not $WeekId) { Write-Error "Provide -WeekId for GET mode"; exit 3 }
    $weekId = $WeekId
    $resp = Invoke-RestMethod -Uri "$Site/api/snapshot_week?weekId=$WeekId" -Method Get -Headers @{ 'x-snapshot-token' = $Token }
  }

  $dir = Join-Path (Get-Location) 'snapshots'
  if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory | Out-Null }
  $outPath = Join-Path $dir "$weekId.json"
  $json = $resp | ConvertTo-Json -Depth 10
  Set-Content -Path $outPath -Value $json -Encoding utf8
  Write-Host "Saved snapshot to $outPath"
} catch {
  Write-Error "Failed: $_"
  exit 4
}
