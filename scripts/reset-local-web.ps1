$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$processes = @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'")
# Only this repository's Next.js processes; leave MySQL, realtime and other apps alone.
$nextProcesses = @($processes | Where-Object {
    $_.CommandLine -and
    $_.CommandLine.Contains($repoRoot + '\node_modules\') -and
    $_.CommandLine -match 'next[\\/]dist[\\/](bin[\\/]next|server[\\/]lib[\\/]start-server\.js)'
})
foreach ($process in $nextProcesses) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped project Next.js PID $($process.ProcessId)."
}
# Stop-Process can return before the handles held by the process are released.
foreach ($process in $nextProcesses) {
    Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
}
$cachePath = [IO.Path]::GetFullPath((Join-Path $repoRoot '.next'))
if ($cachePath -ne ($repoRoot + '\.next')) {
    throw 'Refusing to remove a cache outside the repository.'
}
if (Test-Path -LiteralPath $cachePath) {
    $cache = Get-Item -LiteralPath $cachePath -Force
    if ($cache.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The .next directory is a link. Remove the link manually before resetting.'
    }
    $removed = $false
    for ($attempt = 1; $attempt -le 8 -and -not $removed; $attempt++) {
        try {
            Remove-Item -LiteralPath $cachePath -Recurse -Force -ErrorAction Stop
            $removed = $true
        } catch {
            if ($attempt -eq 8) { throw }
            Start-Sleep -Seconds 1
        }
    }
    Write-Host 'Removed project .next cache.'
}
Write-Host 'Ready. Run: npm run dev -- --port 3010'
