$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
    python tools/build_harureader_manifest.py
    if ($LASTEXITCODE -ne 0) { throw "Manifest generation failed." }

    python tools/check_harureader.py
    if ($LASTEXITCODE -ne 0) { throw "HaruReader validation failed." }

    python -m unittest discover -s tools -p "test_*.py"
    if ($LASTEXITCODE -ne 0) { throw "Manifest builder tests failed." }

    node --check assets/app.js
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed." }

    git diff --check
    if ($LASTEXITCODE -ne 0) { throw "Git whitespace validation failed." }

    Write-Host "HaruReader is ready to commit and push."
} finally {
    Pop-Location
}
