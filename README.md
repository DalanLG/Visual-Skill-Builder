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

## Requirements

- Node.js 20+
- npm
- Electron-supported desktop OS
- Codex CLI available on `PATH`, or configured in the app settings file

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

1. Open the app.
2. Select the folder where you want skills to live.
3. Import an existing `.md` skill or create one from a prompt.
4. Edit the visual graph.
5. Press **Save graph + MD** to write the graph and Markdown skill files.

The demo writes skill outputs under `.codex/skills/<skill-slug>/` in the selected workspace.
