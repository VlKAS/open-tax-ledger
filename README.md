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
- A pinned, community-maintained USD TT BUY reference table with exact-date
  lookup, CSV download, and user-supplied CSV override.
- Offline SEC EDGAR company-name, ticker, exchange, and CIK enrichment.
- Browser-only processing: no server upload of taxpayer documents.
- Static deployment through the checked-in GitHub Pages workflow.
- Synthetic fixtures only in the repository and test suite.

Not supported yet:

- Direct ITR JSON generation or e-filing.
- PAN, Aadhaar, income tax portal login, AIS login, or IBKR login.
- Tax advice, return position recommendations, or CA sign-off.
- Futures, options, crypto, bonds, mutual funds, margin interest, corporate
  actions beyond the explicitly tested cases, or multi-broker consolidation.
- XLSX exports.
- An official historical SBI TTBR archive, automatic Rule 115 date selection,
  or automatic INR conversion from the community reference table.
- Live prices or a complete global security master.

Roadmap items are tracked in [docs/roadmap.md](docs/roadmap.md).

## Intended Workflow

1. Download an IBKR Activity Statement CSV from Client Portal.
2. Open OpenTax Ledger locally or from a trusted static deployment.
3. Import the CSV in the browser.
4. Review parsed trades, positions, dividends, taxes withheld, transfers,
   offline company matches, and FX assumptions.
5. Determine the prescribed Rule 115 date with a qualified reviewer, then use
   the exact-date lookup and retain primary evidence. No prior-day fallback is
   applied.
6. Export draft schedules and checks.
7. Share the exported working papers with a CA for review.
8. Enter final CA-approved values in the official Income Tax Department utility
   or portal.

Official references:

- IBKR statement download guidance:
  <https://www.ibkrguides.com/complianceportal/howtorunastatement.htm>
- IBKR Activity Statement API documentation:
  <https://www.interactivebrokers.com/docs/web-api/account-management/reporting/activity-statements>
- Income Tax Department ITR utilities:
  <https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns>
- Income Tax Rule 115:
  <https://www.incometaxindia.gov.in/w/rule-115-2>
- Income Tax Rule 26 TT buying-rate definition:
  <https://www.incometaxindia.gov.in/w/rule-26-8>
- SBI current Forex Card Rates PDF:
  <https://sbi.bank.in/documents/16012/1400784/FOREX_CARD_RATES.pdf>
- SEC company ticker and exchange associations:
  <https://www.sec.gov/files/company_tickers_exchange.json>
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
and schedule mapping. Dataset provenance, hashes, and limitations are recorded
in [docs/data-sources.md](docs/data-sources.md).

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

Regenerate checked-in reference assets after intentionally updating the source
snapshots:

```bash
npm run data:build
```

Start local development:

```bash
npm run dev
```

The command names are defined in [package.json](package.json). If an
implementation branch has not added the referenced scripts yet, use the current
branch's package scripts as the source of truth.

## GitHub Pages

The workflow at
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) installs with
`npm ci`, runs the complete check, uploads `dist/client`, and deploys it to the
`github-pages` environment on pushes to `main`.

After creating the repository, open **Settings → Pages** and set the publishing
source to **GitHub Actions**. The client uses relative asset paths so it works at
both a user-site root and a project path such as
<https://vlkas.github.io/open-tax-ledger/>.

Source repository: <https://github.com/VlKAS/open-tax-ledger>

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

Bundled reference data retains its source-specific provenance and limitations;
see [docs/data-sources.md](docs/data-sources.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
