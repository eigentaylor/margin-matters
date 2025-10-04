Write-Host "Running critical path checks: unit tests (jest) then Playwright UI screenshot test..."

Write-Host "-> Running unit tests (jest)"
npm run test
if ($LASTEXITCODE -ne 0) { Write-Error "Unit tests failed (exit $LASTEXITCODE)"; exit $LASTEXITCODE }

Write-Host "-> Running Playwright tests"
npm run test:ui
if ($LASTEXITCODE -ne 0) { Write-Error "Playwright tests failed (exit $LASTEXITCODE)"; exit $LASTEXITCODE }

Write-Host "All critical checks passed."
exit 0
