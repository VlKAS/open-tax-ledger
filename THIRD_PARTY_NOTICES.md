# Third-Party Data Notices

OpenTax Ledger code is licensed separately under `AGPL-3.0-only`. The following
reference datasets retain their own provenance and limitations.

## SBI FX RateKeeper community archive

- Source: <https://github.com/sahilgupta/sbi-fx-ratekeeper>
- Pinned commit: `4cea84491ec53b80a5171463e51e04f667bcb6e5`
- Upstream repository license: MIT
- Use in this project: normalized USD `TT BUY` observations and source links

This is a community archive derived from saved SBI rate evidence. It is not an
official SBI historical feed, is not endorsed by SBI, and may contain missing
or conflicting observations. The app does not redistribute SBI PDF files and
does not silently substitute another FX source.

## SEC company ticker and exchange associations

- Source: <https://www.sec.gov/files/company_tickers_exchange.json>
- Publisher: U.S. Securities and Exchange Commission
- Use in this project: CIK, EDGAR company name, ticker, and exchange association

SEC guidance states that government-created EDGAR public filing content is free
to access and reuse, subject to fair-access policies. The ticker file is
periodically updated and is not guaranteed to cover every security or remain
accurate indefinitely.

Full hashes, snapshot dates, and scope notes are recorded in
[`docs/data-sources.md`](docs/data-sources.md) and
[`reference-data/manifest.json`](reference-data/manifest.json).
