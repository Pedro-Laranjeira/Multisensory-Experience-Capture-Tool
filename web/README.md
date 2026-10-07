# MECT Web Application

The Multisensory Experience Capture Tool (MECT) web application lets researchers configure a SurveyJS questionnaire, load capture sessions, support participant reflection, and inspect or export study results.

## Requirements

- Node.js `^20.19.0 || >=22.12.0`. Install a currently supported Node.js LTS release that satisfies this requirement; npm is included with Node.js.
- A desktop browser. A Chromium-based browser with Web Bluetooth support is needed for wireless transfer; microSD file import is an alternative.

## Install and Run

Run these commands from the repository's `web/` directory. From the repository root, first enter it with `cd web`.

```bash
npm install
npm run dev
```

In Windows PowerShell, if the `npm.ps1` script is blocked, use `npm.cmd install` and `npm.cmd run dev`. Vite prints a `Local:` address in the terminal; open that address in the browser and leave the terminal running while the app is in use.

## Build

From `web/`, run `npm run build` (or `npm.cmd run build` in PowerShell) to run the TypeScript build check and create the production web build.

## Main Workspaces

- `/` — choose a researcher or participant workflow.
- `/researcher` — configure the questionnaire and import, inspect, summarize, or export participant results.
- `/participant` — transfer or import a session, complete the reflection questionnaire, and download the participant package.

For first-time installation and assembly, see [Getting Started](../docs/GETTING_STARTED.md). For study operation, see the [Usage Guide](../docs/USAGE_GUIDE.md).
