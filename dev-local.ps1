# Hexaequo - Local Development Script (PowerShell)
# Starts backend (port 3001) and frontend (port 8080) using portable Node.js

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = Join-Path $scriptDir "node-portable"
$nodeExe = Join-Path $nodePath "node.exe"
$npmCmd = Join-Path $nodePath "npm.cmd"

Write-Host "`n🎮 HEXAEQUO - Starting Local Development Servers`n" -ForegroundColor Green

# Check if node-portable exists
if (-not (Test-Path $nodeExe)) {
    Write-Host "❌ Error: node-portable folder not found!" -ForegroundColor Red
    Write-Host "   Please download Node.js portable and extract to: $nodePath" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Found portable Node.js at: $nodePath" -ForegroundColor Cyan

# Check if backend dependencies are installed
$backendNodeModules = Join-Path $scriptDir "backend\node_modules"
if (-not (Test-Path $backendNodeModules)) {
    Write-Host "📦 Installing backend dependencies..." -ForegroundColor Yellow
    Push-Location (Join-Path $scriptDir "backend")
    & $npmCmd install
    Pop-Location
}

# Check if .env exists
$envFile = Join-Path $scriptDir "backend\.env"
$envExample = Join-Path $scriptDir "backend\.env.example"
if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Write-Host "⚙️  Creating .env from .env.example..." -ForegroundColor Yellow
        Copy-Item $envExample $envFile
    }
}

# The frontend is plain ES modules with no build step: serve.py is all it needs.

Write-Host "`n🚀 Starting Backend on http://localhost:3001" -ForegroundColor Blue
Write-Host "🚀 Starting Frontend on http://localhost:8001" -ForegroundColor Blue
Write-Host "`nPress Ctrl+C to stop both servers`n" -ForegroundColor Gray

# Start backend in background job
$backendJob = Start-Job -ScriptBlock {
    param($nodeExe, $backendDir)
    Set-Location $backendDir
    & $nodeExe "server.js" 2>&1
} -ArgumentList $nodeExe, (Join-Path $scriptDir "backend")

# Start frontend in current process (so Ctrl+C works)
Push-Location $scriptDir
try {
    & python "serve.py"
} finally {
    # Cleanup: stop backend job when frontend exits
    Write-Host "`n🛑 Stopping servers..." -ForegroundColor Yellow
    Stop-Job $backendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob -ErrorAction SilentlyContinue
    Pop-Location
}
