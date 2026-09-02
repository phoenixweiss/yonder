# Changelog

All notable user-visible changes to Yonder are documented in this file. English is
the canonical language for release notes.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
