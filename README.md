# TabTab

> Automatically group browser tabs by domain — with smart auto-collapse of inactive groups.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Chrome](https://img.shields.io/badge/Chrome-93%2B-brightgreen)

[中文文档](docs/README.zh-CN.md)

TabTab is a Chrome extension that replaces manual tab management with automatic, rule-based tab grouping. Tabs from the same domain are collected into labeled, color-coded Chrome Tab Groups. When you switch to a different group (or click an ungrouped tab), all other groups collapse — keeping your tab strip clean and focused.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Settings](#settings)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Development](#development)
- [License](#license)

---

## Features

- **Automatic domain-based grouping** — tabs from the same website are grouped together
- **Smart auto-collapse** — switch groups and inactive ones collapse; click an ungrouped tab and all groups collapse
- **Configurable domain granularity** — group by main domain (`google.com`) or full hostname (`docs.google.com`)
- **Alphabetical sort with active-group positioning** — groups sit at the front of the tab strip, sorted A-Z, with the active group always at the rightmost position
- **Master on/off switch** — toggle off to instantly ungroup everything; toggle on to regroup
- **Custom group names** — rename groups via the popup; names persist across restarts
- **Show tab count** — group titles display the number of tabs, e.g. `github.com(5)`
- **Excluded domains** — list domains that should never be grouped
- **Auto-ungroup single tabs** — when a group shrinks to 1 tab, it's automatically dismantled
- **Frozen tab resilience** — groups with discarded/frozen tabs won't accidentally collapse
- **Multi-window support** — each window is grouped independently

---

## Installation

### From Source (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `TabTab` folder.
5. The extension icon appears in your toolbar. Click it to configure.

### Requirements

- **Chrome 93+** (supports Manifest V3 with module service workers)
- Permissions: `tabGroups`, `tabs`, `storage`

---

## Usage

Once installed, TabTab works automatically:

1. **Open multiple tabs** of the same domain (e.g., several Google Docs pages).
2. They are **grouped together** with a color-coded label.
3. **Click a different group** — the old group collapses, the new one expands.
4. **Click an ungrouped tab** — all groups collapse so you can browse freely.
5. **Close tabs** in a group — when only 1 remains, it's ungrouped and placed after the remaining groups.

### Popup

Click the extension icon to open the settings popup:

- Toggle the master switch on/off
- Change domain granularity
- Configure auto-collapse, sort order, and tab count display
- Add domains to the exclusion list
- Add, edit, or remove custom group names
- Click **Save** to apply changes

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable TabTab | `true` | Master on/off switch |
| Domain Grouping | `main` | `main` = registrable domain (`google.com`); `full` = complete hostname (`docs.google.com`) |
| Auto-collapse inactive groups | `true` | Collapse other groups when switching |
| Sort groups at front | `true` | Groups sit at the front of the tab strip, sorted alphabetically |
| Show tab count | `true` | Display tab count in group title, e.g. `github.com(5)` |
| Excluded Domains | `[]` | One domain per line. Supports subdomain matching (`mail.google.com` matches `google.com`) |
| Group Names | `{}` | Custom display names for groups. Domain → Display Name mapping |

All settings persist across browser restarts via `chrome.storage.local`.

---

## How It Works

### Domain Extraction

```
docs.google.com → google.com  (main granularity)
docs.google.com → docs.google.com  (full granularity)
www.example.co.uk → example.co.uk  (handles compound TLDs)
```

The extension handles compound TLDs (`.co.uk`, `.com.au`, etc.) using a known-SLD set.

### Event Flow

```
Tab URL changes
  → extractDomain()
  → find/create tab group
  → assign deterministic color (DJB2 hash)
  → name group (custom or domain)
  → sort groups to front (active group at end)
  
Tab activated
  → collapse all other groups
  → expand current group
  → reorder groups
```

### Color Assignment

Colors are assigned deterministically via DJB2 hash of the domain string, mapped to Chrome's 9-color palette: `grey`, `blue`, `red`, `yellow`, `green`, `pink`, `purple`, `cyan`, `orange`. If the preferred color is taken, the first available color is used.

### Performance Optimizations

To prevent tab strip flicker from repeated API calls:

1. **`sortGroupsInWindow` coalescing** — 80ms debounce per window. Multiple sort requests in quick succession (from event cascades) are merged into one execution.
2. **`groupTabByDomain` early return** — if the tab is already in the correct group and no same-domain tabs exist outside it, skip all operations.
3. **State pre-check for collapse/expand** — before calling the API, check if the group is already in the target state.
4. **Title-update skip** — compare the computed title against the current title; skip the API call if unchanged.

---

## Project Structure

```
TabTab/
├── manifest.json            # MV3 manifest (ES module service worker)
├── background.js            # Event handlers + initialization (~180 lines)
├── lib/
│   ├── state.js             # Shared in-memory state (Maps, Sets, flags)
│   ├── domain-utils.js      # Domain extraction, color hashing, color assignment
│   ├── storage-utils.js     # Settings CRUD, domain names CRUD
│   └── group-logic.js       # Core grouping, collapsing, sorting, batch operations
├── popup.html               # Settings popup HTML
├── popup.js                 # Settings popup logic (ES module)
└── popup.css                # Settings popup styles
```

**Architecture:** ES modules with zero circular dependencies:

```
state.js ← domain-utils.js, group-logic.js, background.js
domain-utils.js ← group-logic.js
storage-utils.js ← group-logic.js, background.js, popup.js
group-logic.js ← background.js
```

All files ≤ 300 lines. All functions ≤ 20 lines.

---

## Development

### Loading the Extension

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `TabTab` directory
4. After making changes, click the **reload** icon on the extension card

### Debugging

- **Service worker console:** Click "service worker" on the extension card in `chrome://extensions`
- **Popup console:** Right-click the extension icon → Inspect
- **chrome://inspect/#service-workers** for service worker lifecycle inspection

### Code Conventions

- ES modules (`import`/`export`) for both service worker and popup
- Functions ≤ 20 lines, files ≤ 300 lines
- No circular dependencies
- Early returns over nested conditionals
- Single Responsibility Principle throughout

---

## License

[GNU Affero General Public License v3.0](LICENSE)

TabTab is free software: you can redistribute it and/or modify it under the terms of the AGPL v3. This license requires that any modified version running on a server must also have its source code made available to users.
