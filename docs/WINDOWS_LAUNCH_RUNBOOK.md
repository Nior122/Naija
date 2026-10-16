# Windows launch runbook (Godot 4.7.2 + Naija: One World)

Status: **external runbook, not verified in the build sandbox.** The sandbox cannot download the
Godot binary (`release-assets.githubusercontent.com` is blocked), so nothing here has been run on a
real Godot engine. Every step marked "unverified" must be confirmed by the person running it. Report
the outcome using the error-reporting template at the end.

This runbook covers: installing Godot, getting the code, opening and running the game, running the
headless checks, running the online server, and the optional Windows export. It does not add
features and does not change game behaviour.

## 1. What you need

| Item | Requirement |
| --- | --- |
| OS | Windows 10 or 11, 64-bit |
| GPU | Must support OpenGL 3.3 (the project uses the **GL Compatibility** renderer) |
| Disk | About 1 GB free for Godot, plus about 1.3 GB if you install export templates |
| Git | Git for Windows (provides `git` and Git Bash) |
| Node.js | **22.13.0 or later, below 23** (`engines` in `package.json`). Only needed for online play and the backend tests |
| Godot | **4.7.2 stable**, standard (non-Mono) build |

## 2. Install Godot 4.7.2

Official release: <https://github.com/godotengine/godot/releases/tag/4.7.2-stable>

The Windows standard build asset, from the GitHub release metadata (read from the GitHub API, not
downloaded in the sandbox):

- File: `Godot_v4.7.2-stable_win64.exe.zip`
- Size: 86,013,866 bytes
- SHA-256: `731980f9608d61333e5baf54a2ef17210acc7a538446c0cb9969f002aca1e953`
- Direct URL: <https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_win64.exe.zip>

Steps (PowerShell):

```powershell
# Download (the browser download from the release page works equally well)
Invoke-WebRequest -Uri "https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_win64.exe.zip" -OutFile "$HOME\Downloads\Godot_v4.7.2-stable_win64.exe.zip"

# Check the hash. It must print 731980F9608D61333E5BAF54A2EF17210ACC7A538446C0CB9969F002ACA1E953.
Get-FileHash "$HOME\Downloads\Godot_v4.7.2-stable_win64.exe.zip" -Algorithm SHA256

# Extract to a folder of your choice
Expand-Archive "$HOME\Downloads\Godot_v4.7.2-stable_win64.exe.zip" -DestinationPath "$HOME\Godot"
```

Do not use a copy of Godot from any other source. If the hash differs, stop and report it.

After extraction, the zip contains `Godot_v4.7.2-stable_win64.exe`. Check whether it also contains a
`Godot_v4.7.2-stable_win64_console.exe`. If it does, use that file for the headless commands in
section 6, so the output appears in your terminal. (Unverified: the sandbox could not inspect the zip.)

Confirm the version by launching Godot once and reading the version shown in the Project Manager, or
by running this in PowerShell:

```powershell
& "$HOME\Godot\Godot_v4.7.2-stable_win64.exe" --version
```

It should print `4.7.2.stable...`. Any other version is not supported by this runbook.

Set a shorthand for the rest of this document (adjust the path):

```powershell
$GODOT = "$HOME\Godot\Godot_v4.7.2-stable_win64.exe"
```

## 3. Get the code

Important: **the branch on GitHub does not yet contain all the current local work.** The Stage 45–47
economy changes and the Godot fix in `game/3d_world/scripts/multiplayer_3d_manager.gd` exist only in
the build workspace. They are not committed or pushed. A fresh clone gives you the last pushed state
of the branch.

```powershell
git clone https://github.com/Nior122/Naija.git
cd Naija
git checkout arena/00cdea0e-naija
```

## 4. Open the project and let it import

Option A, Project Manager (recommended for the first run):

1. Start `Godot_v4.7.2-stable_win64.exe`.
2. Click **Import**, browse to `Naija\game\project.godot`, and select it.
3. Click **Import & Edit**. Godot will import assets and create a `.godot\` folder inside `game\`. That
   folder is git-ignored; leave it alone.
4. Wait for the import to finish (status bar, bottom right). Then check the **Output** and **Debugger**
   panels for red errors.

Option B, command line from the repository root:

```powershell
& $GODOT --headless --editor --path game --quit   # first-time import, no window
```

Expected: the command exits, and the errors (if any) appear in the terminal. Record any error text.

## 5. Run the game

1. In the editor, press **F5** (Run Project). The main scene is `res://scenes/main.tscn`.
2. Or from the command line: `& $GODOT --path game`

What to check on the first run (all **unverified** until someone does them):

- The character-creation screen appears ("NAIJA: ONE WORLD").
- **Begin your life** starts a new character at home.
- Movement: W/A/S/D or arrow keys; Shift to run; E to interact.
- F3 switches between the 2D prototype and the 3D world; V toggles first person; Space jumps (these
  come from the project's input actions).
- Leaving the game and reopening it with **Continue saved life** restores the character.

Local save file: Godot's **Project > Open User Data Folder** opens the folder the game writes to. The
offline save is `naija-stage1-save.json` in that folder. Do not share it or post it in bug reports,
because it is personal game data.

**Replacing a saved life:** if a local save already exists, **Begin your life** does not start a new
character straight away. It opens "Replace your saved life?". **Cancel** closes that dialog and keeps
the save and the name you typed. Only **Replace saved life** starts the new character, and that
overwrites `naija-stage1-save.json`. Keep a copy of that file if you want to keep the old life. This
confirmation is covered by `new_game_confirmation_headless.gd` (section 6). It was run on Linux with a Godot 4.7.2 build from source, not on Windows (see section 9).

## 6. Headless checks (automated tests inside Godot)

Run these from the repository root in PowerShell. Use the console executable if you have it.

```powershell
& $GODOT --headless --editor --path game --quit
& $GODOT --headless --path game --quit
& $GODOT --headless --path game --script res://tests/domain_smoke.gd
& $GODOT --headless --path game --script res://tests/player_movement.gd
& $GODOT --headless --path game --script res://tests/input_bindings_headless.gd
& $GODOT --headless --path game --script res://tests/save_guard_headless.gd
& $GODOT --headless --path game --script res://tests/new_game_confirmation_headless.gd
& $GODOT --headless --path game --script res://tests/save_restart.gd -- write
& $GODOT --headless --path game --script res://tests/save_restart.gd -- read
```

Rules for these:

- Run `save_guard_headless.gd` **alone**, with no other save-writing test running. It refuses to start
  while recovery material from any run exists.
- `save_restart.gd` needs two separate processes: `write`, then `read`. Wait for the first to exit.
- The save tests use test-only file names (`naija-stage1-test-save.json`, `naija-stage1-restart-test.json`)
  and do not touch `naija-stage1-save.json`.
- Record the exit code and the last lines of output for each command. A passing test prints its own
  pass line; a failing one prints `FAIL:`.

The business UI runner `tools/business-fixture/run-business-ui.sh` and the Godot check runner
`tools/godot/run-godot-checks.sh` are **bash scripts for Linux**. Run them from Git Bash only if you
understand their environment variables (see the script headers). They are not part of this runbook.

Optional static checks, if you install `gdtoolkit` with Python (`pip install gdtoolkit==4.*`):

```powershell
gdformat --check (Get-ChildItem game -Recurse -Filter *.gd).FullName
gdlint (Get-ChildItem game -Recurse -Filter *.gd).FullName
```

These are syntax and style checks only. They do not replace Godot's own parser.

## 7. Online play (optional)

Online play needs the Node server running in a second terminal:

```powershell
# from the repository root
node --version          # must be v22.13.0 or later, below v23
npm ci
npm run dev             # starts the world API; default URL ws://127.0.0.1:3000/ws
```

Then start the game with `$env:NAIJA_WS_URL = 'ws://127.0.0.1:3000/ws'` set in the same PowerShell
window, and run `& $GODOT --path game`. Choose **Create online life**.

Two-client test: follow `README.md`, section "Local two-client and reconnect test", using a different
`NAIJA_MULTIPLAYER_SESSION_PATH` for each window.

Do not expose the server on a public network. It has no TLS termination and no account system.

## 8. Windows export (optional, not needed to play)

Status: **the Windows export preset is a template only. No export has been run.**

- `game/export_presets.template.cfg` is tracked and defines a "Windows Desktop" preset (x86_64,
  output `builds/windows/NaijaOneWorld.exe`, code signing disabled, default icon).
- The real `game/export_presets.cfg` is git-ignored. Create it from the Godot editor
  (**Project > Export > Add… > Windows Desktop**) rather than copying the template by hand.
- Export templates must match 4.7.2. Install them from **Editor > Manage Export Templates**, or use the
  file `Godot_v4.7.2-stable_export_templates.tpz`:
  - Size: 1,281,349,702 bytes
  - SHA-256: `f298490b8d44d934be425a5a65a51bf15f422428b229a06a6e11d9ffea248011`
  - Source: <https://github.com/godotengine/godot/releases/tag/4.7.2-stable>
- Unverified: whether the exported game starts, loads its save, and runs online on another Windows
  machine. Antivirus or SmartScreen may warn on an unsigned executable.

## 9. What is verified and what is not

| Area | Status |
| --- | --- |
| Backend TypeScript build, lint, Node tests (file and PostgreSQL) | Run in the build sandbox. Results are in `docs/DEVELOPMENT_STATUS.md` |
| GDScript syntax (gdtoolkit 4.5 parser, not Godot 4.7) | Static only |
| Godot project import, run, input, UI, save/restart, online play | **Not run in this form.** The Linux build sandbox loads the project headless with no script errors and runs the headless tests. It has no window, and the editor import was not run (the class registry was generated by a script). Windows and windowed play are not verified. |
| Headless Godot tests (section 6) | Run on Linux, not Windows: the project runner `tools/godot/run-godot-checks.sh` passed on a Godot 4.7.2.stable build from source (template build, not the official release binary). Results are in `docs/DEVELOPMENT_STATUS.md`. |
| Windows export | **Not run** |
| 3D remote-player fix (`multiplayer_3d_manager.gd`) | Code corrected by source inspection; **not exercised in Godot** |

## 10. Error-reporting template

If something fails, send the following. Do **not** send save files, `naija-client-*.cfg` session
files, or the `.godot\` folder, because they contain personal game data and session identifiers.

```text
Step (section and command):
Godot version (Help > About, or --version):
Windows version:
GPU and driver:
Command or action that failed:
Exact error text (Output/Debugger panel, or terminal, first red line and the next 10 lines):
Exit code (for headless commands):
Node version (online play only):
Does it happen on a fresh clone? (yes / no / not tried):
```
