# Roadmap

This roadmap describes planned capabilities. It is not a promise that a feature
is available today.

## Current Baseline

- Browser-only IBKR Activity Statement CSV import.
- Draft working papers for Schedule CG, Schedule FA, Schedule FSI, Schedule TR,
  and checks.
- Scope limited to supported equity and ETF flows.
- Exact-date USD TT BUY community-reference lookup and downloadable CSV.
- Offline SEC company metadata enrichment with source provenance.
- GitHub Pages deployment workflow.
- Synthetic fixtures only.

## Near-Term

- Stronger CSV schema detection for IBKR custom statements.
- More reconciliation checks for cash, positions, dividends, and withholding
  tax.
- Deterministic export format for CA review.
- Fixture library covering common equity and ETF cases.
- UI copy that consistently marks outputs as draft working papers.

## Planned

- XLSX export for CA-facing review packs.
- Assessment-year specific schedule templates.
- Expanded corporate-action handling after test fixtures exist.
- More explicit prescribed-date guidance and rate-evidence audit output.
- Better import diagnostics for unsupported IBKR sections.

## Later

- An official or expressly licensed historical SBI TTBR source, if one becomes
  available.
- Optional privacy-reviewed identifier resolution for non-SEC securities.
- Optional locally generated ITR utility crosswalks.
- Multi-account consolidation.
- Additional brokers, only after the IBKR pipeline is stable.

## Not Planned Without a Privacy Redesign

- Server-side upload of taxpayer statements.
- Hosted taxpayer accounts containing imported statements.
- IBKR credential collection.
- Income Tax Department credential collection.
- Direct e-filing.
