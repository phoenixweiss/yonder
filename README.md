# Yonder

Keep it there. Use it here.

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

## Technical direction

The planned foundation is Electron, JavaScript ESM, Vue 3, Vite, and YAML. macOS
is the first verification target. Linux and Windows are considered in the design,
but will not be claimed as supported until they are tested natively.

The interface starts as one compact window with a light, Nord-inspired visual theme.
Development proceeds in small, reviewed steps.

## License

[MIT](LICENSE), copyright 2026 PAVEL TKACHEV.
