# Yonder

<p align="center"><img src="docs/brand/yonder-lockup.svg" alt="Yonder" width="420"></p>

<p align="center"><strong>Keep it there. Use it here.</strong></p>

<p align="center"><a href="README_RU.md">Русская версия</a></p>

Yonder is a small desktop utility that keeps files in an ordinary storage folder
and makes them available at the paths where local applications expect them.

> **Yonder does not provide its own synchronization service. Files remain in an ordinary folder, and synchronization is left to an external cloud client.**

There is no Yonder account, server, telemetry, or background sync service.

## How it works

Each connection maps one source in the storage to one destination on the computer:

```text
Storage                         Computer
source file or folder   ->      symbolic link at the destination path
```

Yonder supports file-to-file and folder-to-folder mappings. The source remains the
real filesystem object; the destination is a symbolic link. Connections are stored
in a strict, human-readable `yonder.yaml` file. See the
[example configuration](examples/yonder.yaml).

The application can:

- create or open a storage;
- inspect every configured connection without changing files;
- add a connection definition after a separate review and confirmation;
- create one verified symbolic link at a time;
- disconnect a link without deleting its source or configuration;
- remove a safely disconnected connection from the configuration.

## Safety

Yonder treats filesystem changes as explicit, narrowly scoped operations. Before a
write, it repeats the relevant checks and asks for final confirmation. It refuses to
replace an occupied destination, create missing parent folders, or continue when the
configuration or filesystem state has changed.

Opening and rechecking a storage are read-only. Yonder never moves source data, and
disconnecting a connection removes only the exact verified symbolic link.

## Download

Yonder is an early public preview. The current release is
[Yonder 0.1.3](https://github.com/phoenixweiss/yonder/releases/tag/v0.1.3) for
Apple silicon Macs running macOS 13 or later.

The macOS bundle is ad-hoc signed for integrity, but it is not yet Developer ID
signed or notarized. macOS therefore requires explicit approval on first launch.
After copying Yonder to Applications, Control-click the app, choose **Open**, and
confirm the launch. Published checksums are included in `SHA256SUMS.txt`.

Linux and Windows paths are part of the configuration format, but those desktop
platforms are not yet declared supported because they have not been tested natively.

## Development

Requirements:

- Node.js 24
- Yarn Classic 1.22.22 through Corepack
- system Clang on macOS for the native link helper

Install dependencies and run the complete quality suite:

```sh
corepack yarn install --frozen-lockfile
corepack yarn quality
```

Useful commands:

```sh
corepack yarn dev                 # open the Electron development window
corepack yarn package:mac:dir     # build a local .app
corepack yarn package:mac         # build local DMG and ZIP artifacts
```

Versioning is managed with [Bumpster](https://github.com/phoenixweiss/Bumpster).
The tracked project configuration keeps `VERSION` and `package.json` synchronized;
its pre-bump hook runs the quality suite and closes the `Unreleased` changelog section
in the same version commit. The resulting tag starts the GitHub Actions release
workflow. Local packaging never publishes a release.

The renderer uses Vue 3 and Vite. Electron remains a thin desktop shell; native
dialogs and filesystem operations stay in the main process behind a narrow preload
API. English is the canonical project language, with a synchronized Russian
interface and README.

## Contributing

Focused issues and pull requests are welcome. Please preserve the product boundary:
ordinary files, symbolic links, explicit confirmation, and no built-in sync service.

User-visible changes are recorded in the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 PAVEL TKACHEV
