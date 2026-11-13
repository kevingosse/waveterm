# Wavelet roadmap

Where the fork is going and why. Decisions are recorded with the evidence behind them, so that they can be revisited
when the evidence changes.

## Goals

1. A terminal that is ready when it opens: no waiting on the shell, no waiting on the app.
2. Only what gets used. Everything else is removed rather than hidden, so it costs nothing at startup and nothing to
   maintain.
3. Better window management, and better interaction with coding agents through `wsh`.

## Decisions

**The Go backend stays. Whether the front end stays on Electron is to be settled by a prototype.**
The slowness that prompted the fork was not in the architecture. What made a new terminal sit on the PowerShell
banner was a `wsh.exe` launch in the shell's startup script, which antivirus held for 8 to 18 seconds, and a small
change fixed it. The backend has never been the problem either: it is ready 50 ms after it is started. The first
version of this decision therefore kept everything, and said to look again once Phase 2 was measured.

Phase 2 is measured now (below). With what was ours removed, the window is shown 0.27 s after launch, has content at
0.65 s and a prompt at 0.78 s. Most of what is left is Electron's. Its main script starts running 0.10 s after launch
(0.14 s with ours), its GPU process then takes about 0.2 s to initialise, and nothing can be drawn before that: an
empty Electron window gets its first pixel at 0.36 to 0.41 s on this machine. More work might bring our content to
0.5 s (an estimate), which is about where Windows Terminal is, whose window appears at 0.4 to 0.6 s. It cannot go
below the empty window. A native window is on screen in 0.07 s.

A native front end would talk to the same backend, so tabs, layouts, scrollback, remotes and `wsh` carry over, and it
would load a browser engine (WebView2) only for the blocks that are web pages anyway: previews, the web view, charts,
the settings editor, whose existing views could be reused. Estimated gains: the window with its restored screen at
about 0.1 s instead of 0.65 s; the prompt at about 0.65 s instead of 0.78 s, because the backend, and with it the
shell, could be started 0.14 s sooner (PowerShell's own start-up, about 0.6 s, is most of the prompt and stays);
and memory, the installed app holding 650 MB in five Electron processes when it was measured. The cost: the front end
of a terminal emulator (rendering, selection, search, input methods), the tiling layout and the tab bar written
again, with the long tail of details that come with them, over many sessions, while the Electron front end is kept
working.

The maintainer has said more than once that they would rather have a native terminal with a browser engine loaded on
demand than a terminal built on one. Before deciding: a prototype, as small as it can be made, that opens a native
window, restores the first tab's terminal from the existing database and reaches a live prompt, measured the same
way. It settles what the figures above only estimate, and shows what the terminal looks like when it is not
xterm.js. Phase 3 waits for that decision, since window management built on the Electron front end would have to be
built twice.

**Hard fork.** Upstream is a remote to cherry-pick from, not something to stay mergeable with. Removing features makes
merges conflict everywhere, and upstream's pace is slow enough that little is lost.

**Windows only, with Linux `wsh` for remotes.** Cross-platform code paths stay where they cost nothing, but only
Windows x64 is built and tested, plus `wsh` for Linux x64 and arm64 (WSL, SSH hosts).

**Deployed from source as an unpacked directory.** No installer and no updater. `ops/deploy.ps1` builds, smoke-tests,
stages and swaps; `ops/rollback.ps1` goes back. Versions are `0.20.<commits since the fork point>`.

**The name is Wavelet, its colour is blue, and its mark is its own.** The mark is a Ricker wavelet drawn as a single
blue stroke with nothing behind it, in the app and as the app icon alike (a first version of the icon put it in white
on a blue plate; the maintainer preferred the bare stroke). `ops/make-icon.mjs` draws it from the formula and writes
every image that shows it. It replaced a recoloured copy of upstream's logo: the licence covers
upstream's code, not its name or logo, and the fork and an official install should be easy to tell apart. The
interface accent (focus borders, buttons, links) stays upstream's green, by the maintainer's choice.

## Phase 0: foundation (done)

- Builds from source on Windows; development, release and rollback tooling in `ops/`.
- Own identity, directories and remote directory; nothing sent to upstream's cloud; no auto-update.
- Local shells no longer launch `wsh` before their first prompt. A new terminal block reaches its PowerShell prompt
  in 550 to 630 ms, which is PowerShell's own startup plus the user profile.
- `wsh` works in every local shell, including ones that skip the integration script (cmd.exe, a PowerShell started
  with its own `-Command`).

## Phase 1: remove what is not used (done, except the optional step)

About 121,000 lines and 1,200 npm packages are gone; the backend binary went from 32.0 MB to 27.7 MB and the packaged
frontend from 147 MB to 114 MB.

1. **Dead code and developer tooling**: the component preview server, unused files and npm packages, unused Go
   packages and test harnesses, the documentation site, the in-app help and tips.
2. **The app builder (Tsunami, WaveApps) and Wave AI**, on both sides, including their RPC commands, settings and
   events.
3. **Telemetry, the cloud client, onboarding, the terms-of-service gate and the updater**, including the telemetry
   tables (dropped by migration 12). A new profile now starts with a single terminal instead of a tour.
4. **Still open, decide when it matters**: the legacy VDOM view (woven into the terminal view) and the process
   viewer.

Things to remember from doing it:

- The generated RPC client is referenced by name from frontend types. Remove frontend uses before, or together with,
  regenerating after an RPC is removed.
- When removing RPC types, run `generatego` before `generatets`, and prune the hard-coded import list in
  `cmd/generatego/main-generatego.go`, or the generated client will not compile.
- `secretstore` stays (SSH passwords), and so does `TermGetScrollbackLines` (`wsh termscrollback`).
- Removing code can remove a side effect something relied on. Upstream launched two PowerShell processes at backend
  startup, for telemetry and for the AI. With both gone, the first shell of a cold start got half a second slower,
  because those launches had been absorbing an antivirus delay (see below). Measure startup after every removal.
- Untracked build output that contains Go files (a stale `tsunami/` directory, for instance) is picked up by
  `go mod tidy` as part of the module and brings dependencies back.

## Phase 2: startup (done, as far as Electron allows cheaply)

`node ops/measure-startup.mjs` measures a cold start of a packaged build: time until the window is shown, until it
has drawn its first text ("content"), and until the restored terminal holds a live prompt. Measured on installed
builds, median of seven cold starts:

| Build                                          | Window  | Content | Prompt  |
| ---------------------------------------------- | ------- | ------- | ------- |
| 0.20.31, before Wave AI and the rest came out  | 0.94 s  |         | 1.68 s  |
| 0.20.59, cleaned up, shells started early      | 0.97 s  |         | 1.16 s  |
| 0.20.59 with an antivirus exclusion (below)    | 0.75 s  |         | 0.90 s  |
| 0.20.65, the same code, measured again         | 0.71 s  | 0.95 s  | 0.86 s  |
| 0.20.67, with what is listed under "done"      | 0.27 s  | 0.65 s  | 0.78 s  |

(The machine was busier during part of the second series; its first three runs were 0.82 s and 0.98 s.)

Content was not measured before 0.20.65. It matters because "window shown" never meant that anything was in it: up
to 0.20.65 the window was shown when the tab reported ready and drew a quarter of a second later, and since 0.20.67
it is shown, empty, as soon as it exists. The prompt is on screen once both it and the content are there: 0.95 s
before, 0.78 s now.

For comparison, on the same machine, from launch to a visible window: the classic console (conhost) 0.07 s, Windows
Terminal 1.24 0.4 to 0.6 s, an Electron app that does nothing but open a window 0.18 s, with its first pixel at 0.36
to 0.41 s.

Done:

- **Shells start when the backend is up, not when the terminal view has measured itself.** The backend starts the
  local shells of each window's active tab right away, at the size stored with the block.
- Removing the AI panel and onboarding took the 9.3 MB syntax-highlighting chunk and one request out of every tab's
  startup.
- **Views are loaded with the first block that needs them.** Every tab loaded 18.6 MB of JavaScript, most of it the
  code editor, the diagram and chart libraries and the markdown stack. It now loads 2.9 MB, and the time it spends on
  its scripts went from 234 ms to 85 ms.
- **Messages queued while the socket to the backend opens are sent at once.** Upstream sent one every 100 ms, which
  delayed the second request of the main process and of every tab by that much.
- **No WebGL probe when the terminal's code is loaded.** It created a context just to see whether it could, which
  blocks on the GPU process: about 100 ms while that is still starting.
- **The first tab's renderer is created as soon as Electron is ready**, while the backend starts, and **the window is
  shown as soon as it exists**, so that its graphics surface is set up while the tab loads.
- A tab gets the facts that never change (user, host, directories) on its command line instead of through
  synchronous calls to the main process, asks for everything its first render needs in one go, its blocks included,
  and loads its fonts meanwhile instead of first.
- During start-up the spare tab is created 2.5 s later, not while the first tab is drawing.

Things to remember from doing it:

- A bundler told to put a library in a chunk of its own puts that library's dependencies there too. Anything else that
  uses one of them then loads the whole chunk at start-up. Splitting along `import()` does not have that problem.
- While the app starts, the main process is busy and the GPU process is not ready until about 0.4 s after launch. A
  synchronous call to the first waits for it (25 ms for a user name); anything that needs the second (a WebGL
  context, a frame) blocks until it is up.
- Chromium does no graphics work for a window that is not shown.
- To see where a start-up goes: `--trace-startup=<categories> --trace-startup-file=<file> --trace-startup-format=json
  --trace-startup-duration=4` on the packaged app's command line. `devtools.timeline,v8,blink.user_timing,
  disabled-by-default-v8.cpu_profiler` shows the tab's JavaScript, `gpu,viz,toplevel,startup` what the GPU and
  browser processes are doing. `ops/measure-startup.mjs --timeline` gives the tab's own milestones without a trace.

What is left, if the front end stays on Electron. A tab's 0.65 s is now: 0.19 s until its renderer starts, 0.13 s
until its scripts have run, 0.06 s of requests, 0.05 s for the first render, 0.07 s to create the terminal (its WebGL
renderer), and 0.13 s until the first frame is on screen.

1. The scripts: about 60 of the 85 ms are fetching and compiling. Chromium does not keep compiled code for `file:`
   pages; serving the app from a scheme of its own would allow it. `css-tree` (300 KB) is still loaded by every tab,
   for tab backgrounds.
2. The terminal's WebGL renderer and the first frames, which wait on a GPU process that has only just come up.
3. Our main script starts 40 ms later than an empty app's.
4. The prompt is now PowerShell's own 0.6 s after the shell is started, 0.2 s into the launch. A small native
   launcher that starts the backend before Electron would bring it 0.14 s forward.
5. With several windows, the first one is shown only once the ones before it have loaded; nothing is known about how
   that feels, as there has only ever been one.
6. A restored terminal shows the screen of its previous session for a moment before the new shell's output replaces
   it. Decide what it should show instead.

## Phase 3: windows and agents

To be designed, once it is settled which front end it is built on (see the first decision). Starting points: what
`wsh` can already do for an agent (open previews, editors, web views, read scrollback), what is awkward about it
(addressing blocks is clumsy; each call costs about 60 ms, nearly all of it process start), and what window
management lacks today.

Known small thing: the app never sets a Windows AppUserModelID, so a `wsh notify` toast is attributed to Electron's
generated id instead of to "Wavelet" with its icon. Fixing it means setting the id in the app and on the Start menu
shortcut that `ops/apply-staged.ps1` creates. Not checked on screen yet.

## Loose ends

Small things left over from making the fork its own, none of them urgent:

- `wsh` help text still says "Wave Terminal".
- The icon font in `public/fontawesome` still contains upstream's logo as glyphs. Nothing displays them (workspaces
  that used one were moved to the fork's mark by migration 14); taking them out means rebuilding the font.
- The settings views, the durable-session popup and the ARM64 warning link to upstream's documentation site, which
  describes upstream's product, including features that are gone here.
- `electron-builder.config.cjs` still carries upstream's macOS and Linux sections, which nothing builds.
- `.kilocode/skills/electron-api/SKILL.md` uses the removed `capture-screenshot` call as its example.
- The bump mode of `version.cjs` relies on `semver` being installed as somebody else's dependency.

## Open questions

- **Antivirus and PowerShell.** On the maintainer's machine, Windows Defender holds the first launch of PowerShell 7
  by each process of an Electron app. It is not this app's doing: a bare Electron script that starts a small program
  which starts `pwsh.exe` shows the same hold (about 1.0 s for the first process in the app, 0.5 s for later ones,
  1 to 2 ms after that), the same program outside Electron takes 6 ms, other programs (`cmd`, `node`, `git`, Windows
  PowerShell 5.1) are not held, and Defender's CPU use jumps during the hold. Nothing on the command line changes it.
  For the installed app the hold is around 0.5 s; for a build run from the repository it is 1.15 s. The app now spends
  it in parallel with opening the window. A Defender process exclusion for the app removes it, and takes 0.2 s off
  the window as well: 0.75 s to the window and 0.90 s to the prompt, median of six cold starts. Nothing in the app
  depends on the exclusion; it is a security trade-off to make per machine, and the numbers to compare against
  depend on whether it is in place.
- **Antivirus and fresh builds.** Every build is a new unsigned binary, and Defender sometimes holds a Go binary it
  has not seen at its path for about ten seconds on first launch. The deploy launches the installed binaries once to
  take that hit early; after that, launches from the install directory were not held again in the hours observed.
- **A terminal that lost its first output.** Once, a terminal block created by a script within seconds of the app
  starting showed neither its first line of output nor its first prompt until something was typed. Two retries on a
  settled instance were fine. Unconfirmed; the suspect is the terminal view being rebuilt while the tab is still
  initialising (it is rebuilt whenever any `term:*` setting object changes).
- **A slow first start of the day.** On 2026-11-13 the first launch after the machine had been off was slow: the
  backend took 444 ms to be ready instead of 50, and the window came 1.5 s after the log's first line instead of 0.7 s.
  Later launches were normal. Probably files that were not in the system's cache yet, but the log could not show how
  long Electron had taken before that first line. It does now (`sinceprocstart` on the "starting" line); look at it
  the next time this happens.
- **Keyboard navigation out of a web block** could not be checked with injected key events (they do not reach the
  app's key handling while a web view has focus, on builds from before the cleanup as well). Check by hand.