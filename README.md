# OpenTax Ledger

OpenTax Ledger is a privacy-first tool for Indian Interactive Brokers users who
need CA-reviewable working papers for income tax return preparation.

The app is designed to run in the browser. Users import Interactive Brokers
Activity Statement CSV files, review the normalized ledger, and export draft
working papers for Indian ITR schedules. It does not log in to Interactive
Brokers, does not ask for PAN, Aadhaar, brokerage credentials, or income tax
portal credentials, and does not file returns.

> This project is not tax advice. It prepares draft working papers for review by
> the taxpayer and a qualified Chartered Accountant.

## Current Scope

Supported now:

- Interactive Brokers Activity Statement CSV imports.
- Listed foreign equities and ETFs held through IBKR.
- Stock trade, dividend, withholding tax, interest, open-position, transfer,
  and optional exchange-rate sections recognized by the current parser.
- Draft Schedule CG, Schedule FA, Schedule FSI, Schedule TR, and reconciliation
  checks.
- Browser-only processing: no server upload of taxpayer documents.
- Synthetic fixtures only in the repository and test suite.

Not supported yet:

- Direct ITR JSON generation or e-filing.
- PAN, Aadhaar, income tax portal login, AIS login, or IBKR login.
- Tax advice, return position recommendations, or CA sign-off.
- Futures, options, crypto, bonds, mutual funds, margin interest, corporate
  actions beyond the explicitly tested cases, or multi-broker consolidation.
- XLSX exports.
- Authoritative TTBR pipeline.

Roadmap items are tracked in [docs/roadmap.md](docs/roadmap.md).

## Intended Workflow

1. Download an IBKR Activity Statement CSV from Client Portal.
2. Open OpenTax Ledger locally or from a trusted static deployment.
3. Import the CSV in the browser.
4. Review parsed trades, positions, dividends, taxes withheld, transfers, and
   FX assumptions.
5. Export draft schedules and checks.
6. Share the exported working papers with a CA for review.
7. Enter final CA-approved values in the official Income Tax Department utility
   or portal.

Official references:

- IBKR statement download guidance:
  <https://www.ibkrguides.com/complianceportal/howtorunastatement.htm>
- IBKR Activity Statement API documentation:
  <https://www.interactivebrokers.com/docs/web-api/account-management/reporting/activity-statements>
- Income Tax Department ITR utilities:
  <https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns>
- RBI Liberalised Remittance Scheme master direction:
  <https://www.rbi.org.in/scripts/notificationuser.aspx?id=10192>

## Privacy Model

OpenTax Ledger is designed around local processing:

- Uploaded CSV files are parsed in the browser process.
- No taxpayer file should be sent to the project maintainers.
- No server-side storage is used by the core workflow.
- No personal identifiers are required. Do not enter PAN, Aadhaar, passport
  numbers, bank account numbers, income tax portal credentials, or IBKR
  credentials.
- Test data must be synthetic. Do not contribute real statements, screenshots,
  tax forms, broker reports, AIS files, Form 67 records, or CA workpapers.

See [docs/threat-model.md](docs/threat-model.md) for the detailed threat model.

## Methodology

The calculation pipeline is intended to be auditable:

- Preserve the raw imported row lineage.
- Normalize IBKR rows into a canonical ledger.
- Convert ledger rows into schedule-specific draft tables.
- Show assumptions next to computed values.
- Emit reconciliation checks so reviewers can find missing or inconsistent
  inputs before using the result.

See [docs/methodology.md](docs/methodology.md) for assumptions, expected inputs,
and schedule mapping.

## Development

Prerequisites:

- Node.js `>=22.13.0`
- npm

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run the full local check:

```bash
npm run check
```

Start local development:

```bash
npm run dev
```

The command names are defined in [package.json](package.json). If an
implementation branch has not added the referenced scripts yet, use the current
branch's package scripts as the source of truth.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.
The short version:

- Use synthetic data only.
- Keep tax logic explainable and covered by tests.
- Add references for assumptions that depend on external forms, broker formats,
  or statutory guidance.
- Preserve browser-only processing unless a proposal explicitly changes the
  privacy model and updates the threat model.

## Security

Do not open public issues with real taxpayer data or private financial records.
See [SECURITY.md](SECURITY.md) for private reporting guidance and data handling
rules.

## License

Code is licensed under
[GNU Affero General Public License v3.0 only](https://www.gnu.org/licenses/agpl-3.0.en.html)
using the SPDX identifier `AGPL-3.0-only`.

Documentation under `docs/`, `README.md`, `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, and `SECURITY.md` is licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
unless a file states otherwise.
