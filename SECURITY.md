# Security policy

## Supported versions

Security updates are provided for the latest `1.x` release. Builds older than `1.0.0`
are development snapshots and are not supported.

## Report a vulnerability privately

Please do not open a public issue for a suspected vulnerability. Use
[GitHub's private vulnerability reporting](https://github.com/xCirno1/applyer/security/advisories/new)
or email `support@mail.xcirno.dev` with:

- the affected version and operating system;
- reproduction steps or a proof of concept;
- the impact you believe is possible; and
- any suggested mitigation.

Reports will be acknowledged as soon as practical. We will investigate, coordinate a
fix and release, and credit reporters who want to be named. Please allow reasonable time
for remediation before public disclosure.

## Scope

Applyer's security boundary includes its Electron application, MCP bridge, local storage,
browser automation, import/export paths, and official release workflow. Vulnerabilities
in a separately installed agent CLI or job website should be reported to that project.

For the storage and recovery model, see [Encryption and local data](docs/encryption.md).
