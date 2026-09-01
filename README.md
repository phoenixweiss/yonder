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

## First milestone

The first functional milestone stays deliberately small and read-only:

1. Open an existing storage.
2. Show every storage path and computer path directly.
3. Check connection state without changing files.

Creating or changing `yonder.yaml`, previewing filesystem actions, creating links,
and resolving conflicts will follow as separate, explicitly confirmed steps.

## Configuration

`yonder.yaml` has a strict, versioned structure. Sources are paths relative to the
storage folder; targets are home-relative paths for macOS, Linux, or Windows.
Unknown fields, unsafe paths, duplicate identifiers, and overlapping targets are
rejected before any filesystem action. See the [fictional example](examples/yonder.yaml).

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

Yonder currently requires Node.js 24 and Yarn Classic `1.22.22`.

```sh
corepack yarn install --frozen-lockfile
corepack yarn quality
```

`corepack yarn dev` opens the Electron window and should be run deliberately.

See the [changelog](CHANGELOG.md) for user-visible changes.

## License

[MIT](LICENSE), copyright 2026 PAVEL TKACHEV.
