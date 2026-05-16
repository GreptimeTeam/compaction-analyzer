# Compaction Analyzer

Interactive web tool for visualizing GreptimeDB compaction progress. Analyze alive SST file lists and compaction logs with an interactive time-axis chart.

## Features

- **Interactive visualization**: Canvas-based chart with time on the X-axis and file size as bar height
- **Zoom & pan**: Drag to select a time range, scroll to pan, Ctrl+scroll to zoom, double-click to reset
- **Track layout**: Overlapping files are assigned to separate tracks via greedy first-fit; bars grow upward from the bottom
- **Hover details**: Hover over any file to see its ID, size, time range, source, and region/table info
- **Overlap highlighting**: Hovering a file highlights all other files that overlap it in time
- **Multiple input formats**:
  - CSV export from GreptimeDB (`region_id, file_id, file_size, min_ts, max_ts, visible`)
  - MySQL table output (auto-detected)
  - Raw compaction/flush log lines
- **File upload or paste**: Drag-drop files, browse, or paste raw text directly
- **Metrics panel**: Shows total files, total size, overlap depth, size CV, source breakdown, and size distribution

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens at `http://localhost:5173`.

### Build

```bash
npm run build
```

Output goes to `dist/`.

### Deploy to Cloudflare Pages

**Cloudflare Pages dashboard settings:**

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |

No `wrangler.toml` is needed for Pages — configure the project in the Cloudflare Pages dashboard.

For manual deploys from local:

```bash
npm run deploy
```

### CI/CD

Pushing to `main` triggers automatic deployment via GitHub Actions (`.github/workflows/deploy.yml`).

**Required repository secrets:**

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Cloudflare Pages: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

## Usage

1. Select the input mode: **Alive file list** or **Compaction log**
2. Choose input method: **Upload file** or **Paste text**
3. Provide your data (CSV, MySQL output, or raw log lines)
4. Click **Analyze**
5. Explore the visualization:
   - **Drag** on the chart to select and zoom into a time range
   - **Scroll** to pan, **Ctrl+scroll** to zoom
   - **Hover** over bars for file details and overlap highlighting
   - **Click** the zoom overview bar or **double-click** the chart to reset zoom

## Tech Stack

- [Vite](https://vitejs.dev/) + [Vue 3](https://vuejs.org/) + TypeScript
- Canvas 2D rendering
- Deployable to [Cloudflare Pages](https://pages.cloudflare.com/)
