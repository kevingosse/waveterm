# Wavelet roadmap

Where the fork is going and why. Decisions are recorded with the evidence behind them, so that they can be revisited
when the evidence changes.

## Goals

1. A terminal that is ready when it opens: no waiting on the shell, no waiting on the app.
2. Only what gets used. Everything else is removed rather than hidden, so it costs nothing at startup and nothing to
   maintain.
3. Better window management, and better interaction with coding agents through `wsh`.

## Decisions

**Keep the architecture: Electron, a Go backend, a React frontend. No rewrite.**
The slowness that prompted the fork was not in the architecture. In the official app's logs, the window is on screen
about 1.1 s after launch and the Go backend is ready after 0.15 s (median of 120 startups: 134 ms). What made a new
terminal sit on the PowerShell banner was a `wsh.exe` launch in the shell's startup script, which antivirus held for
8 to 18 seconds. A rewrite would spend months re-creating the terminal emulation, layout and remote-connection code to
fix a problem that a small change fixed. What is left of the startup cost is mostly code that loads without being
used, which pruning and lazy loading address directly. Revisit this once Phase 2 is measured: if a cold start is still
far from the target with everything unnecessary gone, the next thing to question is one renderer process per tab.

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

## Phase 2: startup

`node ops/measure-startup.mjs` measures a cold start of a packaged build: time until the window is shown, and time
until the restored terminal has a live prompt. Measured on installed builds, median of seven cold starts:

| Build                                          | Window  | Prompt  |
| ---------------------------------------------- | ------- | ------- |
| 0.20.31, before Wave AI and the rest came out  | 0.94 s  | 1.68 s  |
| 0.20.59, cleaned up, shells started early      | 0.97 s  | 1.16 s  |
| 0.20.59 with an antivirus exclusion (below)    | 0.75 s  | 0.90 s  |

(The machine was busier during part of the second series; its first three runs were 0.82 s and 0.98 s.)

Done:

- **Shells start when the backend is up, not when the terminal view has measured itself.** The backend starts the
  local shells of each window's active tab right away, at the size stored with the block. The prompt now follows the
  window by about 0.2 s instead of 0.7 s.
- Removing the AI panel and onboarding took the 9.3 MB syntax-highlighting chunk and one request out of every tab's
  startup; the time a tab spends loading scripts went from about 340 ms to about 255 ms.

Next, roughly in order of expected gain:

1. Load on demand what is rarely needed: the code editor (7.8 MB, loaded by every tab), charts, the markdown stack.
2. Stop waiting for 9.5 MB of fonts before reporting a tab ready.
3. Run the initial requests of a tab in parallel instead of one after another.
4. Create the first tab's renderer while the backend starts, not after; delay the spare tab until the first one is
   visible; show each window as soon as it is ready.
5. A restored terminal shows the screen of its previous session for a moment before the new shell's output replaces
   it. Decide what it should show instead.

## Phase 3: windows and agents

To be designed. Starting points: what `wsh` can already do for an agent (open previews, editors, web views, read
scrollback), what is awkward about it (addressing blocks is clumsy; each call costs about 60 ms, nearly all of it
process start), and what window management lacks today.

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
- **Keyboard navigation out of a web block** could not be checked with injected key events (they do not reach the
  app's key handling while a web view has focus, on builds from before the cleanup as well). Check by hand.