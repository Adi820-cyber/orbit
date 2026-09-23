# =============================================================================
# validate-local.ps1
#
# Applies the Orbit migrations to a THROWAWAY local database, then runs the
# pgTAP suite against it. No container runtime, no Supabase project, no cost.
#
# WHY THIS EXISTS
#   The RLS policy tests are vanilla PostgreSQL -- no Supabase Auth, no
#   PostgREST, no Supabase-specific extensions. So the cheapest disposable test
#   database is a local one. Confirmed with Aditya: Supabase free tier allows
#   2 active projects and pauses free projects after a week of inactivity, so
#   spending a project slot on a test database would force the production
#   project (ADR 0008 §4.2) onto a paid plan.
#
# pgTAP WITHOUT A COMPILER
#   pgTAP is pure SQL and PL/pgSQL -- there is no C module. Its build step is
#   two text substitutions (`__OS__` and `__VERSION__`, both cosmetic reporting
#   functions), which this script does in PowerShell. Verified against the
#   1.3.3 Makefile: MODULE_PATHNAME does not appear in pgtap.sql.in at all.
#
#   It is loaded as plain functions into the scratch database, NOT installed as
#   an extension. Nothing is written to Program Files and no admin rights are
#   needed. The scratch database is dropped at the end, so pgTAP's few hundred
#   functions never touch a real database.
#
# USAGE
#   $env:PGPASSWORD = '<local postgres password>'
#   ./supabase/validate-local.ps1
#   Remove-Item Env:PGPASSWORD
#
#   Skip the suite and only check that migrations apply:
#   ./supabase/validate-local.ps1 -SkipTests
#
# SAFETY
#   Creates orbit_validate_scratch, works only in it, drops it at the end. No
#   existing database is read or modified. Re-running is safe.
# =============================================================================

param(
  [switch]$SkipTests,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgHost = 'localhost',
  [string]$PgUser = 'postgres'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest progress floods the console.

$scratchDb  = 'orbit_validate_scratch'
$pgtapVer   = '1.3.3'
$pgtapNum   = '1.3'        # Makefile NUMVERSION: first two components only.
$cacheDir   = Join-Path $PSScriptRoot '.pgtap-cache'
$pgtapSql   = Join-Path $cacheDir "pgtap-$pgtapVer.sql"

if (-not (Test-Path $PsqlPath)) {
  Write-Error "psql not found at $PsqlPath. Pass -PsqlPath to override."
}
if (-not $env:PGPASSWORD) {
  Write-Error 'Set $env:PGPASSWORD before running. See the usage note in this file.'
}

function Invoke-Psql {
  param([string]$Database, [string]$Command, [string]$File)
  # Deliberately NOT named $args: that is a PowerShell automatic variable in a
  # simple function, and overwriting it is a trap.
  $psqlArgs = @('-U', $PgUser, '-h', $PgHost, '-d', $Database, '-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q')
  if ($Command) { $psqlArgs += @('-c', $Command) }
  if ($File)    { $psqlArgs += @('-f', $File) }
  # No `return $LASTEXITCODE` -- that would append the exit code to the output
  # the caller captures. $LASTEXITCODE persists to the caller on its own.
  & $PsqlPath @psqlArgs 2>&1
}

# ---------------------------------------------------------------------------
# 1. Credentials and scratch database
# ---------------------------------------------------------------------------
Write-Host "`n=== Connecting as '$PgUser' ===" -ForegroundColor Cyan
Invoke-Psql -Database 'postgres' -Command 'select 1;' | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Could not connect as '$PgUser' to $PgHost. Check `$env:PGPASSWORD."
}
Write-Host '  ok' -ForegroundColor Green

Write-Host "=== Preparing throwaway database: $scratchDb ===" -ForegroundColor Cyan
# WITH (FORCE) terminates leftover connections. PostgreSQL 13+.
Invoke-Psql -Database 'postgres' -Command "drop database if exists $scratchDb with (force);" | Out-Null
Invoke-Psql -Database 'postgres' -Command "create database $scratchDb;" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Could not create $scratchDb." }
Write-Host '  ok' -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Migrations
#
# Applied straight from supabase/migrations in filename order, which is the
# same order `supabase db push` uses. Aditya's 20260923000100 bootstrap is on
# main, so it is picked up like any other file -- no stand-in needed.
# ---------------------------------------------------------------------------
$migrations = Get-ChildItem (Join-Path $PSScriptRoot 'migrations') -Filter '*.sql' |
  Sort-Object Name

if (-not $migrations) { Write-Error 'No migrations found.' }

$failed = $false
foreach ($m in $migrations) {
  Write-Host "--- applying $($m.Name)" -ForegroundColor Cyan
  $out = Invoke-Psql -Database $scratchDb -File $m.FullName
  if ($LASTEXITCODE -ne 0) {
    $failed = $true
    Write-Host "FAILED: $($m.Name)" -ForegroundColor Red
    $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    break
  }
  Write-Host '  ok' -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 3. Structure inventory
# ---------------------------------------------------------------------------
if (-not $failed) {
  Write-Host "`n=== RLS status (rls_enabled and rls_forced must both be t) ===" -ForegroundColor Cyan
  Invoke-Psql -Database $scratchDb -Command @'
select c.relname as table_name,
       c.relrowsecurity     as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policies p
         where p.schemaname = 'orbit' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'orbit' and c.relkind = 'r'
order by c.relname;
'@

  Write-Host "=== Policies (any USING(true) here is a defect) ===" -ForegroundColor Cyan
  Invoke-Psql -Database $scratchDb -Command @'
select tablename, policyname, cmd, coalesce(qual, '(none)') as using_expr
from pg_policies where schemaname = 'orbit' order by tablename, policyname;
'@

  Write-Host "=== orbit_app privileges (expect SELECT only) ===" -ForegroundColor Cyan
  Invoke-Psql -Database $scratchDb -Command @'
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where grantee = 'orbit_app' and table_schema = 'orbit'
group by table_name order by table_name;
'@

  Write-Host "=== orbit_app role attributes (all must be f except rolcanlogin) ===" -ForegroundColor Cyan
  Invoke-Psql -Database $scratchDb -Command @'
select rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
       rolinherit, rolreplication, rolconnlimit
from pg_roles where rolname = 'orbit_app';
'@
}

# ---------------------------------------------------------------------------
# 4. pgTAP suite
# ---------------------------------------------------------------------------
if (-not $failed -and -not $SkipTests) {
  if (-not (Test-Path $pgtapSql)) {
    Write-Host "`n=== Fetching pgTAP $pgtapVer (one-time, cached) ===" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
    $zip     = Join-Path $cacheDir 'pgtap.zip'
    $extract = Join-Path $cacheDir 'src'
    Invoke-WebRequest -Uri "https://github.com/theory/pgtap/archive/refs/tags/v$pgtapVer.zip" `
                      -OutFile $zip -UseBasicParsing -TimeoutSec 120
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $template = Join-Path $extract "pgtap-$pgtapVer\sql\pgtap.sql.in"
    if (-not (Test-Path $template)) { Write-Error "pgtap.sql.in not found in the download." }

    # The entire build step. Both markers feed cosmetic reporting functions
    # (os_name(), pgtap_version()); there is no C module to compile.
    (Get-Content $template -Raw).
      Replace('__OS__', 'win32').
      Replace('__VERSION__', $pgtapNum) |
      Set-Content -Path $pgtapSql -Encoding UTF8
    Remove-Item $zip, $extract -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  ok' -ForegroundColor Green
  }

  Write-Host "=== Loading pgTAP into $scratchDb ===" -ForegroundColor Cyan
  $out = Invoke-Psql -Database $scratchDb -File $pgtapSql
  if ($LASTEXITCODE -ne 0) {
    $failed = $true
    Write-Host 'FAILED to load pgTAP' -ForegroundColor Red
    $out | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  } else {
    Write-Host '  ok' -ForegroundColor Green

    foreach ($t in (Get-ChildItem (Join-Path $PSScriptRoot 'tests') -Filter '*.sql' | Sort-Object Name)) {
      Write-Host "`n--- $($t.Name)" -ForegroundColor Cyan
      $tap = Invoke-Psql -Database $scratchDb -File $t.FullName
      $tapText = $tap | Out-String

      # TAP: failures are lines beginning "not ok".
      $notOk = ([regex]::Matches($tapText, '(?m)^\s*not ok\b')).Count
      $ok    = ([regex]::Matches($tapText, '(?m)^\s*ok\b')).Count

      $tap | ForEach-Object {
        $line = "$_"
        if ($line -match '^\s*not ok\b')      { Write-Host "  $line" -ForegroundColor Red }
        elseif ($line -match '^\s*#\s*Looks') { Write-Host "  $line" -ForegroundColor Yellow }
        elseif ($line -match '^\s*ok\b')      { Write-Host "  $line" -ForegroundColor DarkGray }
        else                                   { Write-Host "  $line" }
      }

      if ($notOk -gt 0 -or $LASTEXITCODE -ne 0) {
        $failed = $true
        Write-Host "  => $notOk FAILED, $ok passed" -ForegroundColor Red
      } else {
        Write-Host "  => $ok passed" -ForegroundColor Green
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 5. Teardown
# ---------------------------------------------------------------------------
Write-Host "`n=== Dropping throwaway database ===" -ForegroundColor Cyan
Invoke-Psql -Database 'postgres' -Command "drop database if exists $scratchDb with (force);" | Out-Null

if ($failed) {
  Write-Host "`nVALIDATION FAILED -- see the errors above.`n" -ForegroundColor Red
  exit 1
}
Write-Host "`nVALIDATION PASSED -- migrations apply and the pgTAP suite is green.`n" -ForegroundColor Green
