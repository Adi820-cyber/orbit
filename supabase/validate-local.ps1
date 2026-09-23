# =============================================================================
# validate-local.ps1
#
# Applies the Orbit migrations to a THROWAWAY local database to check they are
# valid SQL and that constraints behave, without touching any Supabase project.
#
# WHY THIS EXISTS
#   `supabase test db` needs either a container runtime or a live linked
#   project. Neither is appropriate for a quick syntax check: the dev project
#   still has open items in ADR 0008 §4.1 (legacy keys enabled), and ADR 0009
#   §3 says the bootstrap migration should not be pushed yet. This gives a
#   local check with no cloud side effects.
#
# WHAT IT DOES NOT DO
#   Does not run the pgTAP suite -- that needs the pgTAP extension, which a
#   stock PostgreSQL install does not ship. Use `supabase test db --linked`
#   for the policy tests once ADR 0001/0008 gates are closed.
#
# USAGE
#   $env:PGPASSWORD = '<your local postgres password>'
#   ./supabase/validate-local.ps1
#
#   The password is read from the environment and never written to disk or
#   echoed. Unset it afterwards with:  Remove-Item Env:PGPASSWORD
#
# SAFETY
#   Creates a database named orbit_validate_scratch, applies migrations, then
#   DROPS it. No existing database is read or modified. Re-running is safe.
# =============================================================================

$ErrorActionPreference = 'Stop'

$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$scratchDb = 'orbit_validate_scratch'
$pgHost = 'localhost'
$pgUser = 'postgres'

if (-not (Test-Path $psql)) {
  Write-Error "psql not found at $psql. Adjust the path at the top of this script."
}
if (-not $env:PGPASSWORD) {
  Write-Error "Set `$env:PGPASSWORD before running. See the usage note in this file."
}

function Invoke-Psql {
  param([string]$Database, [string]$Command, [string]$File)
  # Deliberately NOT named $args: that is a PowerShell automatic variable in a
  # simple function, and overwriting it is a trap.
  $psqlArgs = @('-U', $pgUser, '-h', $pgHost, '-d', $Database, '-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q')
  if ($Command) { $psqlArgs += @('-c', $Command) }
  if ($File)    { $psqlArgs += @('-f', $File) }
  # No `return $LASTEXITCODE` -- that would append the exit code to the output
  # the caller captures. $LASTEXITCODE persists to the caller on its own.
  & $psql @psqlArgs 2>&1
}

Write-Host "`n=== Preparing throwaway database: $scratchDb ===" -ForegroundColor Cyan

# Verify credentials before doing anything else, so a wrong password fails with
# a clear message rather than a confusing cascade further down.
Invoke-Psql -Database 'postgres' -Command 'select 1;' | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Could not connect as '$pgUser' to $pgHost. Check `$env:PGPASSWORD."
}

# WITH (FORCE) terminates any leftover connections to the scratch database.
# Supported on PostgreSQL 13+; the local server is 18.
Invoke-Psql -Database 'postgres' -Command "drop database if exists $scratchDb with (force);" | Out-Null
Invoke-Psql -Database 'postgres' -Command "create database $scratchDb;" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Could not create $scratchDb."
}

# The bootstrap migration (orbit schema + orbit_app role) is authored by Aditya
# and lives on his branch, not in this one. Pull the real file rather than
# inventing a stand-in, so the sequence validated here is the sequence that
# will actually run.
$bootstrapRef = 'origin/aditya/db-roles-bootstrap:supabase/migrations/20260923000100_orbit_roles_and_schema.sql'
$bootstrapTmp = Join-Path $env:TEMP 'orbit_bootstrap_20260923000100.sql'

Write-Host "Fetching bootstrap migration from $bootstrapRef" -ForegroundColor DarkGray
$bootstrap = git show $bootstrapRef 2>$null
if ($LASTEXITCODE -ne 0 -or -not $bootstrap) {
  Write-Host "  Could not read it (branch not fetched?). Run: git fetch origin" -ForegroundColor Yellow
  Write-Host "  Falling back to a minimal stand-in so later migrations can still be checked." -ForegroundColor Yellow
  # Minimal stand-in: schema + role only. NOT a substitute for reviewing the
  # real migration -- just enough for the later files to compile.
  $bootstrap = @'
create schema if not exists orbit;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'orbit_app') then
    create role orbit_app with login noinherit nosuperuser nocreatedb
      nocreaterole noreplication nobypassrls;
  end if;
end $$;
grant usage on schema orbit to orbit_app;
'@
}
Set-Content -Path $bootstrapTmp -Value $bootstrap -Encoding UTF8

$migrations = @($bootstrapTmp) + (
  Get-ChildItem (Join-Path $PSScriptRoot 'migrations') -Filter '*.sql' |
    Sort-Object Name |
    Select-Object -ExpandProperty FullName
)

$failed = $false
foreach ($m in $migrations) {
  $name = Split-Path $m -Leaf
  Write-Host "`n--- applying $name" -ForegroundColor Cyan
  $out = Invoke-Psql -Database $scratchDb -File $m
  if ($LASTEXITCODE -ne 0) {
    $failed = $true
    Write-Host "FAILED: $name" -ForegroundColor Red
    $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    break
  }
  Write-Host "  ok" -ForegroundColor Green
}

if (-not $failed) {
  Write-Host "`n=== Structure created ===" -ForegroundColor Cyan
  Invoke-Psql -Database $scratchDb -Command @"
select table_name from information_schema.tables
where table_schema = 'orbit' order by table_name;
"@

  Write-Host "`n=== RLS status (rls_enabled / rls_forced must both be t) ===" -ForegroundColor Cyan
  Invoke-Psql -Database $scratchDb -Command @"
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policies p
         where p.schemaname = 'orbit' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'orbit' and c.relkind = 'r'
order by c.relname;
"@

  Write-Host "`n=== Policies (expect no USING(true)) ===" -ForegroundColor Cyan
  Invoke-Psql -Database $scratchDb -Command @"
select tablename, policyname, cmd, roles::text, coalesce(qual, '(none)') as using_expr
from pg_policies where schemaname = 'orbit' order by tablename, policyname;
"@

  Write-Host "`n=== orbit_app privileges (expect SELECT only) ===" -ForegroundColor Cyan
  Invoke-Psql -Database $scratchDb -Command @"
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where grantee = 'orbit_app' and table_schema = 'orbit'
group by table_name order by table_name;
"@
}

Write-Host "`n=== Dropping throwaway database ===" -ForegroundColor Cyan
Invoke-Psql -Database 'postgres' -Command "drop database if exists $scratchDb with (force);" | Out-Null
Remove-Item $bootstrapTmp -ErrorAction SilentlyContinue

if ($failed) {
  Write-Host "`nVALIDATION FAILED -- see the error above.`n" -ForegroundColor Red
  exit 1
}
Write-Host "`nVALIDATION PASSED -- migrations apply cleanly.`n" -ForegroundColor Green
