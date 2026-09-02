# Changelog

All notable user-visible changes to Yonder are documented in this file. English is
the canonical language for release notes.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-09-02

### Changed

- The Yonder header lockup is slightly larger while preserving the compact window layout.
- Apply initialization now accepts a case-only canonical spelling difference in Electron's
  existing macOS user-data path while continuing to reject a symbolic-link journal directory.
- Connection cards now use clear Source and Destination labels, lead disconnected users into
  Connect, and present a successful connection as complete rather than showing competing next steps.
- Dashboards, connection drafts, and confirmations now identify file-to-file and folder-to-folder
  mappings explicitly.
- The English and Russian READMEs now present the product, safety model, preview status, and
  development workflow as concise project documentation.

## [0.1.2] - 2026-09-02

### Changed

- macOS packaging now explicitly disables electron-builder's tag-triggered implicit
  publishing so the release workflow can verify every artifact before publication.

## [0.1.1] - 2026-09-02

### Added

- A tag-driven GitHub Actions workflow that builds, validates, and publishes ad-hoc-signed
  Apple silicon preview releases through a checksum-verified draft.

### Changed

- The DMG installation row now uses an explicit, vertically balanced Finder layout.
- macOS application bundles are now fully ad-hoc signed so Gatekeeper can verify their
  internal integrity after download; Developer ID signing and notarization remain absent.

## [0.1.0] - 2026-09-02

### Added

- A secure Electron shell with a Vue 3 and Vite renderer.
- A compact first-launch foundation with separate Open and Create storage actions.
- Synchronized English and Russian interface resources with English fallback.
- A strict, versioned `yonder.yaml` contract with safe cross-platform path validation.
- An explicitly confirmed storage-creation flow that writes only a new `yonder.yaml`.
- Read-only storage opening and connection inspection with clear path-state reporting.
- An opt-in option to open a newly created storage immediately after creation.
- A display-only single-connection preview with explicit blocking reasons that never serves as apply authority.
- A separately confirmed single-connection Apply flow with fresh main-process checks,
  an anchored native macOS helper, and an append-only uncertain-outcome journal.
- A display-only new-connection draft with guarded source and destination selection,
  exact paths, and a proposed YAML entry.
- A separately confirmed, single-entry `yonder.yaml` update with fresh path and file
  checks, one-time authority, and no automatic symbolic-link creation.
- A separately confirmed single-connection disconnect flow that removes only the
  exact verified symbolic link while preserving configuration, source data, and conflicts.
- A previewed, separately confirmed configuration-only removal for one safely disconnected
  macOS connection, preserving source data, destination folders, comments, and file mode.
- The approved Yonder visual identity, application icon, renderer favicon, and local macOS
  Dock icon resources.
- A local unsigned macOS packaging flow for current-architecture app, DMG, and ZIP artifacts,
  with the approved icon and executable native helper placed outside ASAR.

### Changed

- Secondary actions have clearer contrast and a calmer hover state.

[Unreleased]: https://github.com/phoenixweiss/yonder/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/phoenixweiss/yonder/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/phoenixweiss/yonder/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/phoenixweiss/yonder/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/phoenixweiss/yonder/releases/tag/v0.1.0
