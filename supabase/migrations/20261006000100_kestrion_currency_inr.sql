-- ============================================================================
-- 20261006000100_kestrion_currency_inr.sql
--
-- Kestrion Health Group reports in Indian rupees (product owner, 2026-10-06,
-- ADR 0022). The ERP bills in rupees with prices taken from the reference
-- hospital dataset's own amounts, so KPIs and bills share one currency and no
-- exchange rate is invented.
--
-- The KPI data is regenerated with INR units (packages/data-gen manifest; seed
-- files 0005-0007, a new dataset checksum). This sets the organization's own
-- reporting currency to match. The test-fixture organization is unchanged.
-- ============================================================================

update orbit.organizations
   set currency = 'INR'
 where slug = 'kestrion'
   and currency = 'USD';
