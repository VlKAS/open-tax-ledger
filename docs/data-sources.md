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
- Pinned source commit:
  `4cea84491ec53b80a5171463e51e04f667bcb6e5`
- Source file:
  `csv_files/SBI_REFERENCE_RATES_USD.csv`
- Repository license: MIT
- Pinned upstream CSV SHA-256:
  `5e4633125e0cc91d05cac3823e7435081badd0cf36ec81d16e634e2fe9907049`
- Normalized bundled CSV SHA-256:
  `5a6e604c4f4366479515ea53fc18c47f29b970f6a94fbd9c38972fa58da12db2`

Use this table as a convenience reference only. It is community-derived from
saved SBI rate evidence, so reviewers should verify material dates against the
retained SBI PDF or other primary evidence before relying on the result.

The app intentionally excludes USD rows where `TT BUY` is zero. Zero-rate rows
are treated as unusable source records, not as valid exchange rates.

The upstream repository declares the MIT license for its repository. The rate
values remain a community archive derived from SBI-published evidence; that
license does not make the table an official SBI source. OpenTax Ledger does not
bundle SBI PDF files.

The app does not substitute RBI reference rates, OANDA rates, broker rates, or
other market FX rates when SBI TT buying data is missing. It also does not
automatically convert draft tax schedules from the bundled table. Missing or
ambiguous rate dates remain review items.

## Company Metadata

Company metadata is bundled from the SEC EDGAR ticker and exchange associations
file:

- SEC EDGAR data access guidance:
  <https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data>
- SEC reuse and fair-access guidance:
  <https://www.sec.gov/about/webmaster-frequently-asked-questions>
- Source file:
  <https://www.sec.gov/files/company_tickers_exchange.json>
- Snapshot last modified: 2026-07-24
- Bundled snapshot SHA-256:
  `e6fbad74d63540e73239f257809cf217b9d6b4fed2410691f0c8c576c9a6cf3c`

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

## Runtime Privacy

Reference data is prebundled so the core workflow remains local:

- IBKR CSV contents stay in the browser.
- No runtime provider calls are made for TTBR or company metadata.
- No taxpayer rows are sent to SBI, SEC, GitHub, market-data providers, or the
  project maintainers.
- Updates to reference data require a source refresh, hash verification, and a
  documentation update to this file.
