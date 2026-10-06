-- =========================================================
-- Payroll statutory rules: GRATUITY and BONUS were seeded in db/074 with
-- correct citations but never actually confirmed (verified_on null, and
-- each row carried its own "not re-checked" note). CLAUDE.md flagged this
-- as a real compliance risk in the "known limits" list -- this migration
-- closes it for these two rules specifically.
--
-- Checked against the Payment of Gratuity Act 1972 (s.4: 15 days' wages
-- per completed year, wage/26 x 15, 5-year minimum service, round up a
-- part year of 6+ months; s.4(3) ceiling raised to Rs 20 lakh by
-- notification S.O. 1420(E) dated 29 Mar 2018, same date the income-tax
-- exemption cap under s.10(10) moved to match; Code on Social Security
-- 2020 s.53, in force nationwide from 21 Nov 2025, gives fixed-term
-- employees gratuity after 1 year pro-rata) and the Payment of Bonus Act
-- 1965 as amended in 2015 (s.2(13) eligibility raised to Rs 21,000/month;
-- s.12 calculation ceiling raised to Rs 7,000 or the minimum wage if
-- higher; ss.10-11 min/max 8.33%-20%; s.8 minimum 30 working days).
-- Every one of these figures has been stable since 2015-2018 -- this is
-- not a freshly-changed number being taken on faith.
--
-- Caveat, stated plainly rather than buried: this check was done against
-- trained legal knowledge, not a live fetch of a government source (this
-- environment's network access is restricted and could not reach
-- labour.gov.in or similar). Treat this as a strong second opinion, not
-- a substitute for a qualified advisor's sign-off before relying on it
-- for a real, large gratuity payment -- the note on each row says so.
--
-- Still open, deliberately NOT touched here: no Labour Welfare Fund (LWF)
-- rule exists for any state. LWF is state-specific (amounts and payable
-- months vary per state) and seeding all of them accurately needs real
-- per-state research this session could not do reliably without a live
-- source -- better to leave it visibly absent than seed a guess and mark
-- it verified. A business that needs LWF should add its own state's rule
-- as a tenant-level override (pay_rule() already prefers a tenant's own
-- row over the AUZslab-maintained one for the same scheme/region).
-- =========================================================

update pay_stat_rules
set verified_on = current_date,
    note = 'Verified 2026-10: figures unchanged since the 2018 gratuity-ceiling notification. Checked against trained legal knowledge, not a live government-site fetch (none was reachable from the build environment) -- confirm with your advisor before paying a large/disputed gratuity.'
where scheme = 'GRATUITY' and region = 'IN' and eff_from = '2018-03-29' and tenant_id is null;

update pay_stat_rules
set verified_on = current_date,
    note = 'Verified 2026-10: figures unchanged since the 2015 Bonus Act amendment. Checked against trained legal knowledge, not a live government-site fetch (none was reachable from the build environment) -- if your state''s minimum wage exceeds Rs 7,000, enter it as the calculation ceiling instead.'
where scheme = 'BONUS' and region = 'IN' and eff_from = '2016-01-01' and tenant_id is null;
