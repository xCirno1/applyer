# Encryption and recovery

Encrypted storage is fail-closed. Applyer never silently substitutes plaintext when encryption was requested.

## What is encrypted

- The entire SQLite database, including jobs, indexed search history, exclusions, company boards, settings, cached job details, profiles, document metadata, and activity history.
- Uploaded document bytes and extracted text.
- Screenshot bytes.
- `app.log` and `mcp.log` entries.

The database uses SQLite3MultipleCiphers through the `better-sqlite3`-compatible driver. A random 256-bit database key is stored in `database-key.enc` under Electron's fixed user-data directory after Electron `safeStorage` wraps it with the operating-system keychain. The wrapped key is deliberately not moved with a custom storage directory.

## When encryption can fail

- Electron reports that secure storage is unavailable. Common examples are a missing or locked Linux Secret Service/KWallet session, unavailable D-Bus session, a locked macOS Keychain, or an inaccessible Windows user profile/DPAPI context.
- Linux selected Electron's `basic_text` backend. That backend uses a fixed password and is rejected as unavailable rather than presented as encryption.
- The operating-system keychain entry can no longer be decrypted after an account change, keychain reset, machine move, permission denial, or OS credential corruption.
- `database-key.enc` is missing, truncated, or corrupt, or it belongs to another operating-system account.
- The encrypted database or encrypted file is truncated or corrupt.
- A storage-mode conversion cannot finish because the destination is read-only, the disk is full, the database is busy, or the process loses power.

An unavailable key never authorizes a plaintext write. Keep backups of the complete user-data directory and any custom storage directory together. Copying only `applyer.db` to another machine is not a usable encrypted backup.

## Automated tests

Run the focused encryption tests:

```sh
npm test -- src/main/db/encryption.test.ts src/main/db/databaseEncryption.test.ts src/main/db/repositories/profileRepository.test.ts src/main/db/repositories/documentsRepository.test.ts
```

These tests cover whole-database encryption/decryption, wrapped-key reopening, unavailable-keychain failures, rejection of Linux `basic_text`, complete profile envelopes, encrypted document content and metadata, corrupt/unavailable read behavior, and plaintext-mode compatibility.

Before release, also run:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

## Manual release checks

Use disposable test data, never your real user-data directory.

1. Add a unique marker to every category: profile, job, search query, document filename/body, screenshot, and an action that creates a log entry.
2. Select encrypted storage, close Applyer cleanly, and confirm `applyer.db` is not recognized as ordinary SQLite and `strings` cannot find any marker in the database, documents, screenshots, or logs.
3. Restart under the same OS account and confirm all data remains readable through Applyer.
4. Make a backup, switch to plaintext, restart, and confirm the database opens normally and stored files remain readable.
5. On Linux, launch a disposable packaged build with `--password-store=basic`; encrypted storage must be unavailable and an encrypted write must not proceed.
6. In a disposable copy, remove or corrupt `database-key.enc`, then confirm Applyer refuses to open the encrypted database rather than creating a blank database or overwriting it.
7. Repeat a storage-location move in encrypted mode and verify the destination opens, the source is preserved until verification succeeds, and no marker appears in its files.

Power-loss testing should be performed in a disposable VM by terminating the process during each conversion phase, then restarting and verifying that data is either readable or rejected with an explicit error, never silently replaced by empty or plaintext data.
