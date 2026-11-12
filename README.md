# Wavelet

Wavelet is an unofficial, personal fork of [Wave Terminal](https://github.com/wavetermdev/waveterm), cut down to what
one person uses it for: a tiling terminal on Windows with WSL and SSH remotes, file previews, a web view, and the `wsh`
command line for scripting all of it.

It is not affiliated with or endorsed by Command Line Inc. It is also not a product: there are no releases and no
installers, and nothing is promised to work anywhere except on its maintainer's machine. If you are looking for Wave
Terminal, use [Wave Terminal](https://www.waveterm.dev).

## How it differs from Wave Terminal

- **It lives next to an official Wave install without touching it.** Wavelet has its own name, app id, install
  location, data and config directories, and its own directory on remotes (`~/.wavelet`). Nothing that manages the
  official app can replace or update this one.
- **It is only a terminal.** Wave AI, the app builder, onboarding, the documentation site and the in-app help are
  gone, along with about 120,000 lines of code.
- **It never contacts Wave's cloud.** No telemetry, no diagnostic ping, no auto-update.
- **Shells start faster.** A local shell no longer launches `wsh` before its first prompt. On Windows that launch
  could be held by antivirus for around ten seconds, which left new terminals sitting on the PowerShell banner.
  The shells of the tab you left open are started together with the app, not after its window has rendered.
- **`wsh` works in every local shell**, including `cmd.exe` and shells started with their own command line.
- **Profiles.** `WAVELET_PROFILE=<name>` gives an instance a separate set of directories, so a development build or
  a release candidate can run beside the installed app.

The direction from here is in [ROADMAP.md](ROADMAP.md).

## Building it

Windows only. You need:

| Tool                              | Notes                                                |
| --------------------------------- | ---------------------------------------------------- |
| [Node.js](https://nodejs.org) 22+ | with npm                                             |
| [Go](https://go.dev/dl/)          | the version named in `go.mod`                        |
| [Task](https://taskfile.dev)      | `winget install Task.Task`                           |
| [Zig](https://ziglang.org)        | the C compiler for the SQLite binding: `winget install zig.zig` |

Everything else is driven from PowerShell in the repository root.

### Develop

```powershell
task electron:winquickdev
```

runs the app from source with hot reload, under the `dev` profile:

| What       | Where                               |
| ---------- | ----------------------------------- |
| data, logs | `%LOCALAPPDATA%\wavelet-dev\Data`   |
| config     | `~\.config\wavelet-dev`             |

Run `task build:backend` first after changing Go types or anything in `cmd/wsh`; the quick task rebuilds only the
server.

Start it with `WAVELET_CDP_PORT=9333` set and the instance can be driven without touching it:

```powershell
node ops\cdp.mjs list                       # the tabs of the running instance
node ops\cdp.mjs screenshot active shot.png # what the visible tab looks like
node ops\cdp.mjs eval active "document.title"
node ops\cdp.mjs key active Ctrl+Shift+ArrowLeft
node ops\measure-prompt.mjs                 # time from new terminal block to first prompt
```

`node ops\measure-startup.mjs` measures cold starts of a packaged build (window shown, first live prompt) under a
throwaway profile.

### Deploy

```powershell
ops\deploy.ps1
```

builds the current commit, checks that the packaged build starts and reaches a shell prompt under a throwaway
profile, and installs it to `%LOCALAPPDATA%\Programs\Wavelet`. If Wavelet is running, the new version is staged and
takes over the next time Wavelet starts, so this is safe to run from a terminal inside Wavelet. Add `-Restart` to
switch immediately.

The previous version and a copy of the databases are kept. `ops\rollback.ps1` goes back. When a build changes the
database schema or the layout code, deploy with `-WithRealData`: the smoke test then runs against a copy of the
installed profile.

### Bring your Wave Terminal setup across

```powershell
ops\migrate-from-wave.ps1
```

copies tabs, layouts, scrollback, settings and widgets from an official Wave install into Wavelet. Wave's files are
only read, and Wave can stay open.

## License

Apache-2.0, like Wave Terminal. See [LICENSE](LICENSE), [NOTICE](NOTICE) and
[ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md). Files changed from their upstream version say so below their original
header; `node ops\fork-notices.mjs` keeps those notices complete.
