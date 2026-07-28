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
4. Review realized gains, acquisition dates, disposal dates, quantities, and
   source-row traceability.
5. Review dividend rows and withholding tax linkage.
6. Review the automatically derived Rule 115 specified dates and Rule 128
   foreign-tax dates, confirm the income classification and event date, and
   retain primary SBI evidence. Do not treat a broker FX rate, a prior-day
   fallback, or the bundled community table alone as final support.
7. Compare foreign income and tax relief working papers against AIS/TIS/Form
   26AS and broker reports.
8. Review Schedule FA asset/account disclosures against year-end and peak-value
   evidence required for the applicable ITR utility.
9. Enter final reviewed values into the official utility or portal.

Official ITR utilities are published by the Income Tax Department:
<https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns>.

## Required Professional Judgment

OpenTax Ledger intentionally does not decide:

- ITR form selection.
- Residential status.
- Whether a taxpayer is eligible for foreign tax relief.
- Treaty eligibility.
- Characterization for unsupported instruments.
- Treatment of ambiguous corporate actions.
- Selection among missing or conflicting TT buying-rate observations.
- Classification of IBKR Interest rows as other-source interest or interest on
  securities.
- Issuer residence or treaty treatment from an SEC ticker match.
- Whether a filing position is complete or defensible.

Use the checks output to identify manual review areas before finalizing the
return.
