# Security Policy

OpenTax Ledger is built for workflows that can involve sensitive financial and
tax records. The safest report is one that contains no personal data.

## Supported Versions

Security fixes are accepted for the default branch. Before a public release
exists, treat the latest commit on the default branch as the only supported
version.

## Reporting a Vulnerability

Do not open a public issue containing taxpayer data, broker statements,
credentials, account IDs, PAN, Aadhaar, bank details, screenshots, or exported
working papers.

If the repository has GitHub private vulnerability reporting enabled, use that
channel. Otherwise, contact the maintainers privately using the security contact
published in the repository profile or release notes.

Include:

- A short description of the issue.
- A minimal synthetic reproduction.
- The affected version or commit.
- The browser and operating system, if relevant.
- Whether the issue can expose, persist, transmit, or corrupt user-provided
  financial data.

Do not include real taxpayer files. If a real file is required to explain the
issue, describe the relevant row shape using invented values.

## Security Goals

OpenTax Ledger should:

- Process IBKR CSV files locally in the browser for the core workflow.
- Avoid collecting PAN, Aadhaar, broker credentials, income tax credentials, or
  government portal credentials.
- Avoid storing user files on a server.
- Make generated outputs explicit draft working papers.
- Make assumptions and warnings visible to reviewers.
- Keep all repository fixtures synthetic.

## Non-Goals

OpenTax Ledger does not:

- File returns.
- Log in to IBKR or the Income Tax Department portal.
- Replace CA review.
- Guarantee statutory correctness for every taxpayer.
- Protect a compromised device, browser extension, or malicious fork.

## Data Handling Rules

Maintainers and contributors must:

- Delete accidental personal-data submissions from local working copies.
- Ask the reporter to resend a synthetic reproduction.
- Avoid quoting personal data in issues, commits, pull requests, release notes,
  logs, or tests.
- Rotate any exposed project credentials if they are accidentally committed.

## Threat Model

The detailed threat model is maintained in
[docs/threat-model.md](docs/threat-model.md). Security-sensitive changes should
update that document in the same pull request.
