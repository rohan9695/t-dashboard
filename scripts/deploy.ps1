<#
.SYNOPSIS
    Deploys the trader dashboard to Cloudflare Workers and the Supabase Edge Functions.

.DESCRIPTION
    Runs the whole live-deploy sequence in one go:
      1. npm run cf:build
      2. wrangler deploy   (with the open-next.config.ts rename workaround)
      3. supabase functions deploy batch-update
      4. supabase functions deploy sync-accounts
      5. a post-deploy health check

    Netlify is NOT handled here — it auto-deploys from main via its GitHub link.

.EXAMPLE
    npm run deploy

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -SkipSupabase
#>

[CmdletBinding()]
param(
    [switch] $SkipCloudflare,
    [switch] $SkipSupabase,
    [switch] $SkipHealthCheck,
    [string] $ProjectRef = 'gvbtnsktudmgmpamkhnl',
    [string] $DashboardUrl = 'https://t-dashboard.rohan9695.workers.dev'
)

$ErrorActionPreference = 'Stop'

# Always operate on the repo root, whatever directory this was launched from.
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -Path $RepoRoot

function Write-Step { param([string] $Message) Write-Host "`n=== $Message ===" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Message) Write-Host "  OK      $Message" -ForegroundColor Green }
function Write-Warn { param([string] $Message) Write-Host "  WARN    $Message" -ForegroundColor Yellow }

# npm/npx signal failure through the exit code, not through exceptions, so every
# external call has to be checked explicitly or a failed deploy looks like a pass.
function Invoke-Checked {
    param([string] $Label, [scriptblock] $Command)
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed (exit code $LASTEXITCODE)"
    }
}

$started = Get-Date
Write-Host "Trader Dashboard deploy" -ForegroundColor White
Write-Host "  repo: $RepoRoot"

# ── Cloudflare ───────────────────────────────────────────────────────────────
if (-not $SkipCloudflare) {
    Write-Step 'Building for Cloudflare Workers'
    Invoke-Checked 'npm run cf:build' { npm run cf:build }
    Write-Ok 'build complete'

    Write-Step 'Deploying to Cloudflare Workers'

    # Plain `npx wrangler deploy` dies on this machine with ERR_RUNTIME_FAILURE
    # (a workerd access violation) because wrangler delegates to
    # `opennextjs-cloudflare deploy` when it finds open-next.config.ts. Hiding
    # the file for the duration of the deploy stops that delegation.
    #
    # The rename MUST be undone even if the deploy throws or the run is
    # interrupted: leaving the file as .bak silently breaks every later
    # `npm run cf:build`, which is a nasty thing to discover mid-incident.
    $configName = 'open-next.config.ts'
    $backupName = 'open-next.config.ts.bak'
    $configPath = Join-Path $RepoRoot $configName
    $backupPath = Join-Path $RepoRoot $backupName

    # Recover from an earlier interrupted run before starting a new one.
    if ((Test-Path $backupPath) -and -not (Test-Path $configPath)) {
        Rename-Item -Path $backupPath -NewName $configName
        Write-Warn 'restored open-next.config.ts left renamed by a previous run'
    }

    $renamed = $false
    try {
        if (Test-Path $configPath) {
            Rename-Item -Path $configPath -NewName $backupName
            $renamed = $true
        }
        Invoke-Checked 'wrangler deploy' { npx wrangler deploy }
        Write-Ok 'Cloudflare Workers deployed'
    }
    finally {
        if ($renamed -and (Test-Path $backupPath)) {
            Rename-Item -Path $backupPath -NewName $configName
            Write-Ok 'open-next.config.ts restored'
        }
    }
}
else {
    Write-Warn 'skipping Cloudflare (-SkipCloudflare)'
}

# ── Supabase Edge Functions ──────────────────────────────────────────────────
if (-not $SkipSupabase) {
    Write-Step 'Deploying Supabase Edge Functions'

    # sync-accounts is included because it imports _shared/trading-logic.ts —
    # whenever that file changes both functions have to go out together, or the
    # two ingestion paths run different logic.
    foreach ($fn in @('batch-update', 'sync-accounts', 'keep-warm')) {
        Invoke-Checked "supabase functions deploy $fn" {
            npx supabase functions deploy $fn --no-verify-jwt --project-ref $ProjectRef
        }
        Write-Ok "$fn deployed"
    }
}
else {
    Write-Warn 'skipping Supabase (-SkipSupabase)'
}

# ── Health check ─────────────────────────────────────────────────────────────
if (-not $SkipHealthCheck) {
    Write-Step 'Health check'

    try {
        $ks = Invoke-RestMethod -Uri "$DashboardUrl/api/killswitch" -TimeoutSec 20
        if ($ks.killswitch) {
            Write-Warn 'KILLSWITCH IS ON — every /api/* route returns 503, so NT8 data will not land.'
            Write-Warn 'Clear it with the red Reset banner on the dashboard before trading.'
        }
        else {
            Write-Ok 'killswitch off'
        }
    }
    catch {
        Write-Warn "could not reach $DashboardUrl/api/killswitch : $($_.Exception.Message)"
    }
}

$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds)
Write-Host "`nDone in ${elapsed}s." -ForegroundColor Green
Write-Host @"

Next:
  * Open the dashboard and confirm the numbers match NinjaTrader.
  * To see which fields NT8 actually reports, open (while logged in):
        $DashboardUrl/api/data
    and look at "nt_fields" for an account. Anything missing there is being
    filled in by the fallback profile table, not by NT8.
"@ -ForegroundColor DarkGray
