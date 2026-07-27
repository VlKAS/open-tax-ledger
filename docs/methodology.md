# Methodology and Assumptions

OpenTax Ledger prepares draft working papers from Interactive Brokers Activity
Statement CSV exports. It does not determine a final tax position and does not
file an ITR.

## Authoritative Inputs

Use these sources as the review baseline:

- IBKR Activity Statement CSV exported from Client Portal.
- Broker annual statement and dividend reports, when available.
- Bank remittance records and Form A2/LRS records.
- AIS/TIS/Form 26AS information downloaded directly by the taxpayer from the
  Income Tax Department portal.
- CA-reviewed final return position.

Official references:

- IBKR statement download guide:
  <https://www.ibkrguides.com/complianceportal/howtorunastatement.htm>
- Income Tax Department ITR utilities:
  <https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns>
- RBI Master Direction - Liberalised Remittance Scheme:
  <https://www.rbi.org.in/scripts/notificationuser.aspx?id=10192>

## Pipeline

The intended pipeline has five stages:

1. Import the IBKR CSV in the browser.
2. Parse raw sections and retain row lineage.
3. Normalize rows into a canonical ledger.
4. Map ledger entries into draft schedule tables.
5. Produce reconciliation checks and reviewer warnings.

Each computed value should be traceable back to source rows. When a value cannot
be supported by imported evidence, the app should show a warning instead of
guessing.

## Current Schedule Mapping

| Draft output | Purpose | Current basis |
| --- | --- | --- |
| Schedule CG | Capital gains working paper | Equity and ETF disposals from normalized trades |
| Schedule FA | Foreign assets working paper | Open-position rows as a closing-value seed; peak value and account disclosure fields remain manual review items |
| Schedule FSI | Foreign source income working paper | Dividends and other supported foreign income rows |
| Schedule TR | Foreign tax relief working paper | Withholding tax rows retained as unlinked draft inputs pending country and income matching |
| Checks | Reviewer reconciliation | Missing FX, duplicate rows, unsupported instruments, transfers, and corporate actions |

These are draft working papers. Reviewers must compare them with the relevant
assessment-year ITR utility and final return instructions.

## Assumptions

Default assumptions should be visible in the output:

- Financial year means India financial year, April 1 through March 31.
- IBKR CSV dates and settlement details are parsed as reported by IBKR.
- Unsupported instruments are excluded from computed schedules and listed in
  checks.
- Ambiguous corporate actions are review items until explicitly supported by
  tests.
- Foreign tax withheld is treated as a draft Schedule TR input only when it can
  be linked to supported foreign income.
- FX conversion must be reviewable and should identify the source and date basis
  used by the implementation.
- Rounding must be deterministic and visible in exported outputs.

## Unsupported Cases

Do not rely on OpenTax Ledger for:

- Options, futures, crypto, bonds, mutual funds, CFDs, or complex derivatives.
- Margin interest or securities lending unless explicitly added and tested.
- Corporate actions such as mergers, spin-offs, splits, return of capital, and
  delistings unless explicitly added and tested.
- Multi-broker consolidation.
- Resident status determination.
- Treaty eligibility determination.
- Final ITR form selection.

Unsupported rows should remain visible in the checks output.

## Review Principle

Prefer a visible warning over a hidden assumption. Every calculation that affects
a draft schedule should be explainable from:

- Imported source rows.
- A documented assumption.
- A deterministic calculation rule.
- A test fixture with expected output.
