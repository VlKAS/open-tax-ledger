# Data Sources

OpenTax Ledger uses local reference data only. The browser loads the bundled
tables from the static app assets and does not call SBI, SEC, market-data
vendors, analytics providers, or project servers while processing taxpayer
statements.

This document records provenance and review limits for bundled data. It is not
tax advice.

## SBI TT Buying Rate

Indian income tax conversion for foreign-currency income depends on the
telegraphic transfer buying rate on the specified date under Rule 115.

Official references:

- Income Tax Rule 115:
  <https://www.incometaxindia.gov.in/w/rule-115-2>
- Income Tax Rule 26 explanation defining telegraphic transfer buying rate:
  <https://www.incometaxindia.gov.in/w/rule-26-8>
- Income Tax Rule 128 governing foreign tax credit conversion:
  <https://www.incometaxindia.gov.in/w/rule-128-1>
- SBI current Forex Card Rates PDF:
  <https://sbi.bank.in/documents/16012/1400784/FOREX_CARD_RATES.pdf>

The SBI PDF is the official current rate card, but it is mutable. It is not an
official historical archive and it is not an official CSV feed. The app must not
present a historical table as an official SBI-published archive unless SBI
publishes one.

## Bundled USD TTBR Table

The bundled USD table is derived from the community-maintained
`sahilgupta/sbi-fx-ratekeeper` repository:

- Repository: <https://github.com/sahilgupta/sbi-fx-ratekeeper>
- Source file:
  `csv_files/SBI_REFERENCE_RATES_USD.csv`
- Repository license: MIT

The current full source commit, upstream SHA-256, normalized SHA-256, record
count, and coverage dates are recorded in
[`reference-data/manifest.json`](../reference-data/manifest.json). Row-level
evidence links are rewritten to that immutable source commit during each
refresh.

Use this table as a convenience reference only. It is community-derived from
saved SBI rate evidence, so reviewers should verify material dates against the
retained SBI PDF or other primary evidence before relying on the result.

The app intentionally excludes USD rows where `TT BUY` is zero. Zero-rate rows
are treated as unusable source records, not as valid exchange rates.

The upstream repository declares the MIT license for its repository. The rate
values remain a community archive derived from SBI-published evidence; that
license does not make the table an official SBI source. OpenTax Ledger does not
bundle SBI PDF files.

For supported USD rows, the app derives the prescribed statutory calendar date
and keeps that date visible in the audit output. It then uses the bundled table
to create a draft INR preview when rate evidence is usable:

- exact: one unambiguous observation exists on the prescribed date;
- prior observation: no exact row exists, but the latest published source
  observation on or before the prescribed date is within the configured review
  window; or
- review required: the observation is missing, stale, or ambiguous.

The prior-observation status is not a statutory prior-business-day
substitution. Rule 115 itself does not move a specified date that falls on a
weekend or bank holiday. The app does not substitute RBI reference rates, OANDA
rates, broker rates, other market FX rates, or unchecked vendor values when
local evidence is missing.

Date derivation follows the official rule text:

- capital gains: last day of the month before the transfer month, applied to
  the matched net foreign-currency gain;
- dividends: last day of the month before the statement payment month;
- broker cash interest treated as other-source interest: last day of the
  financial year, with classification flagged for review; and
- foreign tax credit conversion: last day of the month before foreign tax was
  paid or deducted under Rule 128(5)(ii).

Income and tax conversions are rounded per row to whole rupees before schedule
totals are added, so totals may differ from converting an aggregate foreign
currency amount once.

Capital-gain conversion uses the transfer prescribed date for the net
foreign-currency gain. It does not separately convert the buy leg and sell leg
for the draft Schedule CG gain.

## Company Metadata

Company metadata is bundled from the SEC EDGAR ticker and exchange associations
file:

- SEC EDGAR data access guidance:
  <https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data>
- SEC reuse and fair-access guidance:
  <https://www.sec.gov/about/webmaster-frequently-asked-questions>
- Source file:
  <https://www.sec.gov/files/company_tickers_exchange.json>

The current Last-Modified value, bundled snapshot SHA-256, record count, and
field list are recorded in
[`reference-data/manifest.json`](../reference-data/manifest.json). Each
automated refresh also records the exact upstream response SHA-256 separately
from the normalized bundled snapshot hash.

Bundled fields:

- CIK
- EDGAR conformed company name
- Ticker
- Exchange

The SEC file covers SEC filers and SEC-maintained ticker associations. It does
not cover every global security available through IBKR, and the SEC cautions
that the ticker and exchange files are periodically updated without a guarantee
of accuracy or scope. Reviewers should treat unmatched symbols and stale
company names as manual review items.

Ticker symbols are not globally unique. The app must not infer issuer country,
tax residence, instrument type, or treaty eligibility from a ticker match alone.
When the company metadata does not match the IBKR statement context, use the
broker statement and reviewer evidence as the controlling source.

## Automated Refresh

The checked-in workflow
[`refresh-reference-data.yml`](../.github/workflows/refresh-reference-data.yml)
runs daily at 03:37 UTC (09:07 Asia/Kolkata) and can also be started manually.
It:

1. fetches the latest community SBI CSV and resolves its full source commit;
2. fetches the official SEC ticker and exchange association snapshot with an
   identified User-Agent;
3. applies size, schema, coverage, and row-count safety checks;
4. regenerates local snapshots and browser assets;
5. runs the complete validation suite; and
6. opens or updates a review pull request when tracked data changed.

The automation never merges its own pull request. A reviewer remains
responsible for checking provenance and unexpected data changes before they
reach the published app.

SEC fair-access controls currently reject requests from GitHub-hosted runner
networks. The scheduled run still attempts the official SEC URL every day, but
on a fetch error it emits a workflow warning and retains the last verified SEC
snapshot while allowing an SBI-only refresh to proceed. It never substitutes a
proxy or third-party SEC mirror. The fallback is limited to retryable network
and HTTP errors and a maximum snapshot age of 30 days; malformed responses,
non-retryable errors, and older snapshots fail the run. Manual
`npm run data:refresh` remains fail-closed, and the stale-SEC flag is restricted
to GitHub Actions.

## Runtime Privacy

Reference data is prebundled so the core workflow remains local:

- IBKR CSV contents stay in the browser.
- No runtime provider calls are made for TTBR or company metadata.
- No taxpayer rows are sent to SBI, SEC, GitHub, market-data providers, or the
  project maintainers.
- Updates to reference data require a source refresh, hash verification, and
  pull-request review.
