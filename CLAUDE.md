# Wavelet

Wavelet is a personal fork of Wave Terminal: a tiling terminal built on Electron, with a TypeScript/React frontend and
a Go backend that talk over `wshrpc`, a custom RPC protocol carried over websocket and domain sockets. Read
[README.md](README.md) for what the fork is and how it is built, and [ROADMAP.md](ROADMAP.md) for where it is going and
the decisions already made.

## Working on this fork

- **One maintainer, one machine.** Commit to `main`. The project is not released to anyone, so backward compatibility
  is not a concern, but the maintainer's own data is: tabs, layouts and scrollback must survive every change. A change
  to the database schema is a new migration, never an edit to an existing one.
- **The repository is public.** Never commit secrets, machine-specific paths, or anything taken from the maintainer's
  configuration or data.
- **Apache-2.0 obligations.** Keep `LICENSE` and `NOTICE`. Leave upstream copyright headers as they are. After changing
  upstream files run `node ops/fork-notices.mjs`, which adds the required "modified" notice. New source files start
  with `Copyright 2026, Wavelet contributors` and the SPDX line.
- **Three installs can exist side by side. Only two of them are ours.**

  | Install                | Program                              | Data                              | Config                  |
  | ---------------------- | ------------------------------------ | --------------------------------- | ----------------------- |
  | official Wave Terminal | `%LOCALAPPDATA%\Programs\waveterm`   | `%LOCALAPPDATA%\waveterm`         | `~\.config\waveterm`    |
  | Wavelet (installed)    | `%LOCALAPPDATA%\Programs\Wavelet`    | `%LOCALAPPDATA%\wavelet`          | `~\.config\wavelet`     |
  | Wavelet (dev profile)  | this checkout                        | `%LOCALAPPDATA%\wavelet-dev`      | `~\.config\wavelet-dev` |

  The official install is read-only as far as this project is concerned: never write to its directories and never stop
  its processes (`Wave.exe`, and the `wavesrv` under its program directory). Select processes by executable path, not
  by name.

- **You may be running inside the installed Wavelet.** Never stop or restart it as a side effect. `ops\deploy.ps1`
  stages a new version and lets it take over at the next start; only pass `-Restart` when asked to.

## Checking your work

Nothing counts as working until it has been seen working in the app.

1. `task build:backend` after Go changes (it also regenerates the TypeScript bindings). `npx tsc --noEmit` and
   `npx vitest run` after frontend changes.
2. Start the dev instance with a debugging port: set `WAVELET_CDP_PORT=9333`, then `task electron:winquickdev`.
3. Look at it: `node ops/cdp.mjs screenshot active <file.png>`, `node ops/cdp.mjs eval active "<expression>"`. The
   renderer exposes `globalStore`, `globalAtoms`, `RpcApi`, `TabRpcClient`, `WOS` and, for the most recently created
   terminal, `window.term`.
4. For anything that affects startup or the shell, measure before and after: `node ops/measure-prompt.mjs`.
5. Before deploying, `ops\deploy.ps1` runs the packaged build through `ops\smoke.ps1`. Packaged builds fail in ways dev
   builds do not.

Backend and Electron logs of an instance are in `waveapp.log` in its data directory.

## Code generation

TypeScript types and the RPC clients are generated from Go. After changing `pkg/wshrpc/wshrpctypes.go`, settings types
or meta types, run `task generate`. Never edit `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`,
`frontend/app/store/services.ts`, `pkg/wshrpc/wshclient/wshclient.go` or the `metaconsts.go` files by hand.

When **removing** RPC commands or types:

- remove the frontend uses in the same change; frontend types refer to RPC and setting names as strings
- prune the hard-coded import list in `cmd/generatego/main-generatego.go`
- run `go run cmd/generatego/main-generatego.go` before `go run cmd/generatets/main-generatets.go`; `task generate`
  runs them the other way round, which fails while the old generated client still refers to deleted types

To add an RPC call: define it in `pkg/wshrpc/wshrpctypes.go`, run `task generate`, and implement it in
`pkg/wshrpc/wshserver/wshserver.go` for calls served by the main server.

## Coding guidelines

### Go

- No custom enum types; use string constants (`const StatusRunning = "running"`).
- `Printf` over `Println`. Constructors are named `Make...`, not `New...`. Constants go at the top of the file.
- Do not run `go build` by hand in package directories. Build through `task`.
- Synchronization: `lock.Lock(); defer lock.Unlock()` inside a small helper function, not inline lock/unlock pairs.
- JSON field names are lowercase with no underscores.

### TypeScript

- Import across the project with `@/...`; relative imports only within the same directory. Named exports only.
- Indent with 4 spaces. Filenames are lowercase.
- Strict null checks are off: do not add `| null` to types, and compare with `== null` / `!= null`, not `=== undefined`.
- Jotai atoms that are written to are typed `PrimitiveAtom<Type>`. `atom(null)` needs a cast to the intended
  `PrimitiveAtom` type.
- `useAtom` and `useAtomValue` are hooks: call them at the top of the component, before any conditional return, never
  inline in JSX.
- `React.memo` components need a `displayName`. `React.MutableRefObject` is deprecated; use `React.RefObject`.
- No private class fields. PascalCase for file-level constants.
- Never `atob`/`btoa`; use the base64 helpers in `frontend/util/util.ts`.
- Class names are merged with `cn` from `@/util/util`.
- The Electron preload API is reached through `getApi()` from `@/store/global`; its type is `ElectronApi` in
  `frontend/types/custom.d.ts`.

### Models

State lives in Jotai atoms that hang off a model class. Simple atoms are field initializers; atoms derived from others
are created in the constructor. Models never use React hooks; they read and write through `globalStore`. New models
are singletons: a private constructor and a static `getInstance()`.

### Styling

Tailwind v4 for new code (custom definitions are in `frontend/tailwindsetup.css`); older code uses SCSS. Clickable
things get `cursor-pointer`. Never `cursor-help` or `cursor-not-allowed`. Accent buttons:
`bg-accent/80 text-primary rounded hover:bg-accent transition-colors cursor-pointer`.

### In general

- Early returns over wrapping a function body in an `if`.
- Comments explain why, never what, and never narrate a change. Do not remove existing comments unless the code they
  describe goes away.
- Keep final summaries short and lead with the outcome.

## How-to guides

Read the matching guide before doing one of these tasks.

| Task                                             | Guide                                    |
| ------------------------------------------------ | ---------------------------------------- |
| Add a configuration setting                      | `.kilocode/skills/add-config/SKILL.md`   |
| Add an RPC call                                  | `.kilocode/skills/add-rpc/SKILL.md`      |
| Add a `wsh` command                              | `.kilocode/skills/add-wshcmd/SKILL.md`   |
| Build a context menu                             | `.kilocode/skills/context-menu/SKILL.md` |
| Add a view type                                  | `.kilocode/skills/create-view/SKILL.md`  |
| Add an Electron API (preload/IPC)                | `.kilocode/skills/electron-api/SKILL.md` |
| Narrow `WaveEnv` for a component tree            | `.kilocode/skills/waveenv/SKILL.md`      |
| Work with WPS events (publish/subscribe)         | `.kilocode/skills/wps-events/SKILL.md`   |
