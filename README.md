# Visual Skill Builder

Visual Skill Builder is a focused Electron demo for building Codex skills as editable graphs.

You choose a skills workspace, import or paste Markdown, generate a canonical visual graph with Codex, edit the nodes and variables, preview the final response flow, and save both:

- `skill.graph.json` for the visual editor
- `SKILL.md` and legacy `skill.md` for agent use

## Current Demo Scope

- Select a local skill workspace folder.
- Import existing Markdown skills.
- Generate a skill graph from Markdown or a prompt using the Codex CLI.
- Add, regenerate, connect, and inspect graph nodes.
- Model variables as first-class artifacts with read/write edges.
- Show a terminal Response node for the final AI answer.
- Save the edited graph and Markdown back into the selected workspace.

## Published App Setup

The Windows app is designed to be a short first-run flow:

1. Install and open **Visual Skill Builder**.
2. Press **Install Codex**. The app installs `@openai/codex` into its own app data folder and points the demo at that executable.
3. Press **Sign in**. Codex opens the official OpenAI/ChatGPT login flow; choose Google on that page if your account uses Google login.
4. If browser callback login is blocked, press **Use code login** for Codex device-code authentication.
5. Choose a local skill folder.
6. Press **Verify**, then open the builder.

Credentials stay owned by the Codex CLI. Visual Skill Builder does not store OpenAI, ChatGPT, Google, or API-key secrets.

## Manual Setup

Manual mode in the app bypasses automation and shows copyable Windows-safe commands plus live status checks. The commands intentionally use `cmd.exe`, `npm.cmd`, and `codex.cmd` instead of PowerShell `.ps1` shims because Windows execution policy can block script shims.

## Development Requirements

- Node.js 20+
- npm
- Electron-supported desktop OS
- Codex CLI available on `PATH`, configured in the app settings file, or installed through the first-run setup wizard

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run electron:compile
npm run build
```

## Workflow

1. Complete the first-run setup wizard.
2. Select the folder where you want skills to live.
3. Import an existing `.md` skill or create one from a prompt.
4. Edit the visual graph.
5. Press **Save graph + MD** to write the graph and Markdown skill files.

The demo writes skill outputs under `.codex/skills/<skill-slug>/` in the selected workspace.
