# CA Review Guide

OpenTax Ledger outputs are working papers for review. They are not tax advice,
not a return, and not a substitute for professional judgment.

## Review Inputs

Ask the taxpayer for:

- IBKR Activity Statement CSV for the full India financial year.
- IBKR annual statement and dividend reports, if available.
- Bank outward remittance records and LRS/Form A2 references.
- AIS/TIS/Form 26AS downloaded directly from the Income Tax Department portal.
- Prior-year return and carry-forward schedules, if relevant.
- Resident status and treaty-position evidence, if relevant.

Do not ask the taxpayer to enter PAN, Aadhaar, income tax portal credentials, or
IBKR credentials into OpenTax Ledger.

## Review Outputs

Expected draft outputs:

- Capital gains working paper for Schedule CG.
- Foreign assets working paper for Schedule FA.
- Foreign source income working paper for Schedule FSI.
- Foreign tax relief working paper for Schedule TR.
- Reconciliation checks for unsupported rows, missing FX, incomplete periods,
  and differences requiring manual review.

## Review Steps

1. Confirm the IBKR statement covers April 1 through March 31 for the assessment
   year being prepared.
2. Confirm the statement account IDs and taxpayer-provided ownership details.
3. Review unsupported instruments and excluded rows.
4. Use the Audit tab to reconcile accepted source rows, duplicate suppression,
   generated CG/FSI/TR/FA rows, conversion coverage, and validation severity.
5. Review FIFO lot matching, realized gains, acquisition dates, disposal dates,
   quantities, holding periods, and source-row traceability. The app marks
   matched lots over 730 days as LTCG and other supported disposals as STCG, but
   unsupported instruments and corporate actions remain manual review items.
6. Review dividend rows and withholding tax linkage. Confirm that summary rows
   without event dates and positive WHT reversals were excluded from income and
   tax-paid totals. Treat the displayed FTC amount as a draft per-country
   candidate only; eligibility, treaty position, and Form 67 filing remain
   professional review items.
7. Review the automatically derived Rule 115 specified dates and Rule 128
   foreign-tax dates, confirm the income classification and event date, and
   retain primary SBI evidence. The app keeps the statutory prescribed date
   visible and may use a prior published community-archive observation only as
   labelled evidence. Do not treat a broker FX rate, an unlabelled prior-day
   fallback, or the bundled community table alone as final support.
8. Compare foreign income and tax relief working papers against AIS/TIS/Form
   26AS and broker reports.
9. Review Schedule FA asset/account disclosures against calendar-year entity
   grouping, latest imported statement holdings, and year-end/peak-value
   evidence required for the applicable ITR utility. Snapshot-limited peak or
   closing values require human evidence review. Resolve any review-only latest
   holdings that lack an in-year snapshot before treating the FA list as
   complete.
10. Enter final reviewed values into the official utility or portal.

Official ITR utilities are published by the Income Tax Department:
<https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns>.

## Required Professional Judgment

OpenTax Ledger intentionally does not decide:

- ITR form selection.
- Residential status.
- Whether a taxpayer is eligible for foreign tax relief.
- Treaty eligibility.
- Whether draft FTC candidates satisfy Form 67 and treaty/documentation
  requirements.
- Characterization for unsupported instruments.
- Treatment of ambiguous corporate actions.
- Selection among missing, stale, or conflicting TT buying-rate observations.
- Classification of IBKR Interest rows as other-source interest or interest on
  securities.
- Issuer residence or treaty treatment from an SEC ticker match.
- Whether a filing position is complete or defensible.

Use the checks output to identify manual review areas before finalizing the
return.
