# Delegates filesystem operations to the cross-platform installer; no execution-policy changes.
& node (Join-Path $PSScriptRoot 'scripts/install.mjs') @args
exit $LASTEXITCODE
