# Local equivalents of CI, install, and uninstall.
# Recipes forward to the Node scripts. They do not copy files themselves.
# Windows has no sh on PATH; Unix keeps just's default shell.

set windows-shell := ["pwsh.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]

# Syntax check, coverage tests, and installer dry-run. Matches .github/workflows/ci.yml.
ci:
    npm run check
    npm run test:coverage
    node scripts/install.mjs --dry-run

# Install into HERDR_APP_HOME or ~/.config/herdr-app. Forwards extra arguments.
install *ARGS:
    node scripts/install.mjs {{ARGS}}

# Move an installer-owned Mod to a backup. Preferences and history stay.
uninstall *ARGS:
    node scripts/install.mjs --uninstall {{ARGS}}
