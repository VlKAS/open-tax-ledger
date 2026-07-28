# Roadmap

This roadmap describes planned capabilities. It is not a promise that a feature
is available today.

## Current Baseline

- Browser-only IBKR Activity Statement CSV import.
- Draft working papers for Schedule CG, Schedule FA, Schedule FSI, Schedule TR,
  and checks.
- Scope limited to supported equity and ETF flows.
- Automatic Rule 115 and Rule 128 date derivation for supported USD income and
  foreign-tax rows, with visible prescribed dates and labelled TTBR evidence
  statuses.
- FIFO lot matching for supported equity and ETF disposals, including STCG/LTCG
  ageing based on matched holding periods.
- Country-wise draft FTC candidates at the user marginal rate.
- Schedule FA entity grouping, latest-statement holdings, and evidence labels
  for snapshot-limited peak/closing values.
- A mandatory review dashboard before local downloads.
- Offline SEC company metadata enrichment with source provenance.
- GitHub Pages deployment workflow.
- Synthetic fixtures only.

## Near-Term

- Stronger CSV schema detection for IBKR custom statements.
- More reconciliation checks for cash, positions, dividends, withholding tax,
  and Schedule FA evidence completeness.
- Deterministic export format for CA review.
- Fixture library covering common equity and ETF cases.
- UI copy that consistently marks outputs as draft working papers.

## Planned

- XLSX export for CA-facing review packs.
- Assessment-year specific schedule templates.
- Expanded corporate-action handling after test fixtures exist.
- Broader assessment-year fixtures for specified-date and rate-evidence audit
  output.
- Optional user-supplied market-value evidence import for stronger Schedule FA
  peak/closing support.
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
