# Yonder

Keep it there. Use it here.

[RUSSIAN VERSION](README_RU.md)

Yonder is a small desktop utility for keeping files in one ordinary storage folder
and making them available where applications expect them through symbolic links.
The storage may be synchronized by any cloud client; Yonder does not provide its
own cloud, account, server, or telemetry.

## The idea

- Real files stay in the storage folder.
- Links live at the paths applications use.
- The interface shows both paths and the current connection state at a glance.
- Existing files are never replaced silently.
- A human-readable `yonder.yaml` describes the connections.

## Inspection, one-link Apply, and disconnect

Yonder can open an existing storage and inspect it without changing files:

1. Open an existing storage.
2. Show every storage path and computer path directly.
3. Distinguish connected links, missing targets, occupied paths, wrong links,
   missing storage items, and connections not configured for this operating system.

Creating a new empty `yonder.yaml` is available as a separate flow: Yonder shows
the selected folder, storage name, and exact new file before asking for confirmation.
An unchecked-by-default option can open the new storage immediately after creation;
this performs the same read-only inspection and does not add further writes.
For a safely inspectable missing target, Yonder first shows a display-only preview.
Apply is a separate two-step action: the main process repeats every relevant check,
holds the verified destination folder open, and asks for one final confirmation
before a small native macOS helper creates exactly one symbolic link. Yonder does
not create parent folders, replace conflicts, move files, edit `yonder.yaml`, or
apply several connections at once.

A connected entry can be disconnected through a matching two-step action. Fresh
main-process checks and the anchored native helper remove only the exact symbolic
link that still points to the configured source. A missing, replaced, redirected,
or otherwise changed destination blocks removal. Disconnect does not edit
`yonder.yaml`, delete the source, or touch any ordinary file or other link.

An opened storage also offers a guarded draft for one new connection. The user
chooses an existing source inside the storage and an existing destination folder
inside the macOS home folder, then reviews the exact paths and proposed YAML entry.
Preparing the update rereads and validates those paths and `yonder.yaml`; a separate
one-time confirmation then atomically replaces only the configuration with the new
entry appended. A changed configuration or selection blocks the write. This action
does not create the symbolic link, create folders, or change source and target files.

## Configuration

`yonder.yaml` has a strict, versioned structure. Sources are paths relative to the
storage folder; targets are home-relative paths for macOS, Linux, or Windows.
Unknown fields, unsafe paths, duplicate identifiers, and overlapping targets are
rejected before any filesystem action. See the [fictional example](examples/yonder.yaml).
When creating a storage, Yonder writes only a new `yonder.yaml` with an empty
connection list. It uses exclusive creation and never replaces an existing file.
Configuration reads are size-limited and strict. Rechecking refreshes the displayed
state but never creates links, moves files, or changes the configuration.
The renderer never supplies filesystem paths as write authority. Apply accepts only
the active storage identifier, a configured connection identifier, and a one-time
confirmation token. A private append-only local journal is written before the link
command, so an uncertain outcome blocks blind retries. A later matching-link
observation can resolve that record; absent, conflicting, or changed state remains
blocked for manual inspection. Disconnect likewise accepts only active identifiers
and a one-time token; after dispatch, Yonder reports success only when a fresh
inspection proves that the exact link is absent and the guarded selection is unchanged.

## Technical direction

The interface is a Vue 3 application built with Vite and JavaScript ESM. Electron
is its thin desktop shell: native dialogs and guarded filesystem access stay behind
a narrow preload API instead of being exposed directly to the renderer. The project
uses Yarn Classic and keeps dependencies deliberately small.

English is the canonical interface language and fallback. Russian is the first
complete additional localization; both language resources keep the same structure.

macOS is the first verification target. Linux and Windows are considered in the
design, but will not be claimed as supported until they are tested natively.

The interface starts as one compact window with a light, Nord-inspired visual theme.
Development proceeds in small, reviewed steps.

## Development

Yonder currently requires Node.js 24 and Yarn Classic `1.22.22`. Native macOS builds
also use the system Clang compiler.

```sh
corepack yarn install --frozen-lockfile
corepack yarn quality
```

`corepack yarn dev` opens the Electron window and should be run deliberately.

See the [changelog](CHANGELOG.md) for user-visible changes.

## License

[MIT](LICENSE), copyright 2026 PAVEL TKACHEV.
