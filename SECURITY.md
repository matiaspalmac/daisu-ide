# Security Policy

## Supported versions

Daisu is pre-alpha. Only the latest tagged release on `main` is supported. Older tags receive no security backports.

| Version | Supported |
|---|---|
| Latest tag on `main` | yes |
| Anything older | no |

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Email: `matiaspalma2594@gmail.com`

Please include:

- A description of the issue and its impact
- Steps to reproduce (PoC, screenshots, or a minimal repro repo)
- The Daisu version or commit SHA you tested against
- Your name / handle for credit (or request anonymity)

You should receive an acknowledgment within 72 hours. If you do not, please resend in case the email was filtered.

## Disclosure process

1. Report received and acknowledged
2. Issue confirmed and triaged
3. Fix developed in a private branch
4. Coordinated release with a CVE if warranted
5. Public advisory published after the fix ships

We aim to ship fixes within 30 days for high-severity issues. Lower-severity issues may be batched into the next milestone release.

## Scope

In scope:

- Code execution from a malicious workspace (e.g. crafted file names, `.gitignore`, settings JSON)
- Path traversal escaping the active workspace
- Privilege escalation via Tauri command surface
- Credential leakage from session storage or settings persistence

Out of scope:

- Dependency vulnerabilities already filed upstream (please report to the upstream project)
- Issues requiring an attacker to already have local code execution on the user's machine
- Social-engineering attacks against the user
