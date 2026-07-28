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
- Retained SBI TT buying-rate evidence for the prescribed Rule 115 dates.

Official references:

- IBKR statement download guide:
  <https://www.ibkrguides.com/complianceportal/howtorunastatement.htm>
- Income Tax Department ITR utilities:
  <https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns>
- RBI Master Direction - Liberalised Remittance Scheme:
  <https://www.rbi.org.in/scripts/notificationuser.aspx?id=10192>
- Income Tax Rule 115:
  <https://www.incometaxindia.gov.in/w/rule-115-2>
- Income Tax Rule 26:
  <https://www.incometaxindia.gov.in/w/rule-26-8>
- Income Tax Rule 128:
  <https://www.incometaxindia.gov.in/w/rule-128-1>

## Pipeline

The intended pipeline has eight stages:

1. Import the IBKR CSV in the browser.
2. Parse raw sections and retain row lineage.
3. Normalize rows into a canonical ledger.
4. Enrich supported tickers from the bundled offline SEC reference snapshot.
5. Derive supported Rule 115 specified dates and Rule 128 foreign-tax rate
   dates from statement events.
6. Apply a local USD evidence row when it is exact or when it is the latest
   published source observation on or before the prescribed date within the
   configured review window.
7. Map ledger entries into draft schedule tables and INR previews, rounding
   converted income and tax rows per source row to whole rupees before totals.
8. Produce reconciliation checks and reviewer warnings.

Each computed value should be traceable back to source rows. When a value cannot
be supported by imported evidence, the app should show a warning instead of
guessing.

## Current Schedule Mapping

| Draft output | Purpose | Current basis |
| --- | --- | --- |
| Schedule CG | Capital gains working paper | Equity and ETF disposals matched to earlier buy lots using FIFO; STCG/LTCG is based on the matched holding period |
| Schedule FA | Foreign assets working paper | Calendar-year securities grouped by entity, latest imported statement snapshot for holdings, and snapshot-limited peak/closing evidence statuses |
| Schedule FSI | Foreign source income working paper | Supported dividend and interest rows after summary/no-date rows are excluded |
| Schedule TR | Foreign tax relief working paper | Negative withholding tax rows grouped by country and compared with estimated Indian tax at the user marginal rate |
| Checks | Reviewer reconciliation | Missing FX, duplicate rows, unsupported instruments, cash movements, securities transfers, corporate actions, and evidence gaps |

These are draft working papers. Reviewers must compare them with the relevant
assessment-year ITR utility and final return instructions.

## Assumptions

Default assumptions should be visible in the output:

- Financial year means India financial year, April 1 through March 31. Buy lots
  before the selected financial year are retained when they are needed to match
  an in-year disposal.
- IBKR CSV dates and settlement details are parsed as reported by IBKR.
- Unsupported instruments are excluded from computed schedules and listed in
  checks.
- Ambiguous corporate actions are review items until explicitly supported by
  tests.
- Foreign tax withheld is treated as a draft Schedule TR input only when it can
  be linked to supported foreign income. Positive WHT reversals and summary rows
  without event dates are excluded from tax-paid totals and shown for audit.
- FX conversion must be reviewable and should identify the source and date basis
  used by the implementation.
- The bundled USD TT BUY table is community-maintained reference material, not
  an official SBI historical feed. Exact or prior-observation matches can
  populate draft INR previews, but reviewers must retain and verify primary SBI
  evidence for material dates.
- For capital gains, the app derives the last calendar day of the month before
  the statement transfer month. It converts the matched net foreign-currency
  gain at that transfer prescribed date; it does not convert buy and sell legs
  separately for the draft gain.
- For dividends, the app uses the IBKR statement payment date and derives the
  last calendar day of the preceding month. Confirm the applicable
  declaration, distribution, or payment event when those events fall in
  different months.
- IBKR Interest rows default to other-source interest and therefore use the
  Indian financial-year end. This classification remains an explicit reviewer
  check because interest on securities follows a different Rule 115 date.
- Foreign tax rows use the last calendar day of the month before payment or
  deduction for the draft Rule 128 conversion preview.
- USD rate lookup keeps the statutory prescribed date visible. If the bundled
  archive has no row on that date, the app may use the latest published source
  observation on or before the prescribed date within the configured review
  window. That is evidence handling, not a statutory prior-business-day
  substitution. Missing, stale, or conflicting observations remain manual review
  items; the app does not use RBI rates, broker rates, or market-rate vendors.
- SEC ticker matches enrich display and audit fields only. They do not establish
  issuer residence, instrument type, treaty eligibility, or tax treatment.
- Dividends, withholding tax, and similar income/tax conversions are rounded per
  row to whole rupees before totals are added.
- Schedule FA values are evidence-labelled. Snapshot-limited peak or closing
  values are draft review items until supported by stronger statement or market
  evidence.
- If a latest imported holding may pre-date the Schedule FA year but the import
  has no in-year trade or position snapshot, the app retains it as a review-only
  entity and flags calendar-year evidence as incomplete.

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
- Final classification of IBKR Interest rows as other-source interest or
  interest on securities.

Unsupported rows should remain visible in the checks output.

## Review Principle

Prefer a visible warning over a hidden assumption. Every calculation that affects
a draft schedule should be explainable from:

- Imported source rows.
- A documented assumption.
- A deterministic calculation rule.
- A test fixture with expected output.

Reference snapshot provenance and refresh rules are maintained in
[data-sources.md](data-sources.md).
