# TabTab — Chrome Extension Requirements Document

## 1. Overview

**TabTab** is a Chrome extension (Manifest V3) that automatically groups browser tabs by domain into Chrome Tab Groups, with smart auto-collapse behavior for inactive groups. It replaces manual tab management with automatic, rule-based grouping.

**Core value proposition:** Tabs from the same domain are automatically collected into labeled, color-coded groups. When the user switches to a different group (or an ungrouped tab), all other groups collapse so the tab strip stays clean and focused.

---

## 2. File Structure

```
TabTab/
├── manifest.json      # MV3 manifest — permissions, service worker, popup
├── background.js      # Service worker — all event handlers and grouping logic
├── utils.js           # Shared utilities loaded by popup (not by service worker)
├── popup.html         # Settings popup HTML
├── popup.js           # Settings popup logic
└── popup.css          # Settings popup styles
```

**Key architectural note:** `utils.js` MUST NOT be imported into `background.js` via `importScripts()`. MV3 service workers fail to register when importing scripts. All utility functions used by the background MUST be inlined directly in `background.js`.

---

## 3. Permissions (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "TabTab",
  "version": "1.0.0",
  "description": "Automatically group tabs by domain with smart collapsing of inactive groups.",
  "permissions": ["tabGroups", "tabs", "storage"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "minimum_chrome_version": "93"
}
```

- `tabGroups` — create, update, move, query tab groups
- `tabs` — query, group, ungroup, move, update tabs; listen to tab events
- `storage` — persist settings (`storage.local`) and ephemeral color map (`storage.session`)

---

## 4. Settings & Configuration

### 4.1 Default Settings

```js
{
  enabled: true,            // Master on/off switch
  granularity: 'main',      // 'main' | 'full'
  excludedDomains: [],      // Array of domain strings (e.g. ["github.com"])
  autoCollapse: true,       // Collapse inactive groups when switching
  sortGroupsToFront: true,  // Push groups to front of tab strip, sorted alphabetically
  showTabCount: true        // Show "domain(5)" in group title
}
```

Stored in `chrome.storage.local` under key `"settings"`.

### 4.2 Domain Granularity

| Value | Behavior | Example |
|-------|----------|---------|
| `main` | Extract main/registrable domain | `docs.google.com` → `google.com` |
| `full` | Use full hostname | `docs.google.com` → `docs.google.com` |

Main domain extraction:
- Strip `www.` prefix
- Handle compound TLDs: known SLDs (`.co.uk`, `.com.au`, etc.) → keep 3 parts; otherwise keep 2 parts
- Only process `http:` and `https:` URLs; return `null` for `chrome://`, `about:`, `file:`, etc.

Known SLD list: `co`, `com`, `org`, `net`, `gov`, `edu`, `ac`, `me`, `info`, `biz`, `name`, `pro`, `mobi`, `nom`

### 4.3 Excluded Domains

- Domains in the excluded list are never auto-grouped
- Matching: exact match OR subdomain match (`mail.google.com` matches excluded `google.com`)

### 4.4 Custom Group Names

- Stored in `chrome.storage.local` under key `"domainNames"` as `{ "google.com": "Google", "github.com": "My Repos" }`
- When a group is created for a new domain, the domain name is automatically saved as its own display name
- Users can add/edit/delete custom names in the popup
- When a custom name exists for a domain, the group title uses that name instead of the raw domain
- Group title format: `{displayName}({count})` when `showTabCount` is enabled, else `{displayName}`

---

## 5. Core Behavior — Event Handlers

### 5.1 Event Registration (MV3 Requirement)

All listeners MUST be registered at the top level of the service worker, synchronously:

```
chrome.tabs.onCreated.addListener(handleTabCreated)
chrome.tabs.onUpdated.addListener(handleTabUpdated)
chrome.tabs.onActivated.addListener(handleTabActivated)
chrome.tabs.onRemoved.addListener(handleTabRemoved)
chrome.tabGroups.onUpdated.addListener(handleGroupUpdated)
chrome.runtime.onInstalled.addListener(handleInstalled)
chrome.runtime.onStartup.addListener(handleStartup)
chrome.runtime.onMessage.addListener(handleMessage)
```

### 5.2 `handleTabCreated(tab)`
**No-op.** Grouping is deferred to `handleTabUpdated` when the URL is known and final. This prevents race conditions where both `onCreated` and `onUpdated` try to group the same tab before its URL is ready.

### 5.3 `handleTabUpdated(tabId, changeInfo, tab)`
- Trigger: `tab.pendingUrl` exists, OR `changeInfo.url` exists, OR `changeInfo.status === 'complete'`
- Calls `groupTabByDomain(tab)` to assign/update grouping
- Skips if extension is disabled

### 5.4 `handleTabActivated(activeInfo)`
- Trigger: user clicks a tab or switches to a different tab
- **Skip** if `groupingInProgress` is `true` (mutex guard)
- **Skip** if extension disabled or `autoCollapse` is off
- **50ms delay** before any API calls to avoid "Tabs cannot be edited right now" error
- **If tab is ungrouped** (`groupId === -1`): collapse ALL groups in the window
- **If tab is in a group**: collapse all OTHER groups; expand the current group; add current group to `expandedGroupIds`; call `sortGroupsInWindow` to reorder groups (active group moves to rightmost position among groups)

### 5.5 `handleTabRemoved(tabId, removeInfo)`
- **Skip** if window is closing (`removeInfo.isWindowClosing`)
- Query all groups in the window, collect tab info for all groups
- **Compute target position**: find the max tab index among surviving groups (those with >1 tab). Ungrouped tabs should be placed at `maxIndex + 1` (right after the last surviving group tab).
- **If group has only 1 tab left**: ungroup that tab, move it to the computed target position (right after all remaining groups, not at the end of the tab strip), delete from `groupBaseDomains`
- **Otherwise**: update group title (to refresh tab count)

### 5.6 `handleGroupUpdated(group)`
- **Skip** if `groupingInProgress` is `true`
- **If collapsed**: remove from `expandedGroupIds`, return
- **If already in `expandedGroupIds`**: return (prevents re-focus loop when `handleTabActivated` expands the group)
- **Otherwise** (user clicked group header to expand):
  - Add to `expandedGroupIds`
  - Collapse all other groups in the window
  - Auto-focus the LAST tab (by index) in the expanded group
  - Call `sortGroupsInWindow` to reorder groups (active group moves to rightmost position)

### 5.7 `handleInstalled(details)`
- Trigger: `install` or `update` reason
- Sets `installedJustFired = true` (prevents double grouping from setTimeout fallback)
- Runs `groupAllExistingTabs()` if enabled

### 5.8 `handleStartup()`
- Runs `groupAllExistingTabs()` if enabled (browser opened with extension active)

### 5.9 `handleMessage(message)`
- `settingsChanged`: clear domain cache; regroup ALL tabs if enabled OR ungroup ALL tabs if disabled; refresh all group titles
- `syncDomainNames`: call `syncDomainNamesFromGroups()` to backfill domain names from existing groups

---

## 6. Core Behavior — Grouping Logic

### 6.1 `groupTabByDomain(tab)`
The central function called whenever a tab needs to be (re)grouped.

**Algorithm:**
1. Extract URL: `tab.pendingUrl || tab.url`
2. Skip if: no URL, pinned, non-http(s), excluded domain
3. Extract domain using current granularity setting
4. Query ALL tabs in the same window; filter to same-domain tabs (non-pinned, with URL)
5. Look up existing group for that domain via `findGroupForDomain()`
6. **If group exists**: add any same-domain tabs not already in it; call `sortGroupsInWindow` to reorder; update title
7. **If no group exists**:
   - **If fewer than 2 same-domain tabs**: if the tab IS in a group (wrong domain — e.g. navigated from another domain), verify the group has no other members first (handles frozen/discarded tabs whose URLs may be inaccessible to domain counting), then ungroup it AND collapse the old group. Return.
   - **If 2+ same-domain tabs**: create a new group with all of them; assign deterministic color; set title; auto-save domain to domainNames if not custom; set `collapsed: true`; sort groups in window

### 6.2 `groupAllExistingTabs()`
Batch operation for extension load, browser start, install, and settings change.

**Algorithm:**
1. Mutex via `groupingInProgress` flag (prevents concurrent runs and shields event handlers)
2. Query ALL tabs across all windows
3. Group by `windowId:domain` key
4. Only process groups with 2+ tabs
5. For each domain group: find or create a tab group, set color and title
6. After all groups created, sort groups to front in each window
7. Set `groupingInProgress = false` in `finally` block

### 6.3 `findGroupForDomain(domain, windowId)`
- Check `domainGroupCache` (in-memory Map) first
- Validate cached group still exists via `chrome.tabGroups.get()`
- Fallback: query all groups in window, match via `groupBaseDomains` Map
- Cache hits for future lookups

### 6.4 Group Color Assignment

- DJB2 hash of domain string → deterministic index into 9-color palette
- Color palette: `['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']`
- If preferred color is taken by another domain (tracked in `chrome.storage.session.domainColorMap`), pick the first available color
- Color map is session-scoped (cleared on browser restart)

### 6.5 Group Sorting (`sortGroupsInWindow`)

- Triggered: after creating a new group, after adding tabs to an existing group, after `groupAllExistingTabs`, after `handleTabActivated` (grouped tab), after `handleGroupUpdated` (expand)
- Only runs when `sortGroupsToFront` setting is enabled
- Skips if 0 groups in window (single group is NOT skipped — it still needs to be moved to the front)
- Sorting logic (all groups moved to index 0 via `chrome.tabGroups.move`):
  1. **Expanded/active group** is moved to index 0 FIRST → subsequent moves push it to the right → it ends up at the **rightmost position among all groups**
  2. **Collapsed groups** are moved to index 0 AFTER the active group, in **reverse alphabetical order** by title → the last one moved (alphabetically first) ends up at the very front
- This single function handles both "groups at front of tab strip" and "active group at end of groups" in one pass — no separate move operation needed

### 6.6 Group Title Updates (`updateGroupTitle`)

- Looks up base domain from `groupBaseDomains` Map
- Checks for custom name in storage
- Format: `{displayName}({count})` or `{displayName}` depending on `showTabCount`

---

## 7. Core Behavior — Collapse/Expand Logic

### 7.1 In-Memory State

- `expandedGroupIds` (Set): tracks which groups are expanded. Initialized at SW start by querying all existing groups.
- `groupingInProgress` (boolean): mutex to prevent event handlers from firing during bulk `groupAllExistingTabs`

### 7.2 Collapse Helpers

Both `collapseGroup(groupId)` and `expandGroup(groupId)` retry up to 3 times with 100ms delay between retries. This handles Chrome's "Tabs cannot be edited right now" error that occurs when the user is interacting with the tab strip.

### 7.3 Auto-Collapse Rules

| User Action | Behavior |
|-------------|----------|
| Click a tab in a group | Expand that group, collapse all others |
| Click an ungrouped tab | Collapse ALL groups |
| Click a collapsed group header | `handleGroupUpdated` fires → collapse all other groups, focus last tab |
| Tab navigates to different domain (single tab) | Ungroup tab, collapse the old group |
| Tab removed, group down to 1 tab | Ungroup remaining tab, move to right after surviving groups, delete group entry |

### 7.4 `handleTabActivated` vs `handleGroupUpdated` Race

A critical subtlety: when `handleTabActivated` calls `expandGroup()`, Chrome fires `handleGroupUpdated` as a side effect. Without guards, this would cause:
- `handleTabActivated` expands the group
- `handleGroupUpdated` sees it's expanded → collapses other groups AND focuses the last tab
- This would prevent the user from switching to a non-last tab within the same group

**Solution:** `expandedGroupIds` Set:
- `handleTabActivated` adds the group to `expandedGroupIds` BEFORE calling `expandGroup`
- `handleGroupUpdated` checks if group is already in `expandedGroupIds` — if so, it skips the auto-focus logic
- When a group is collapsed (manually or via auto-collapse), it's removed from the set

---

## 8. Popup UI

### 8.1 Layout (320px wide)

```
┌─────────────────────────┐
│ TabTab                  │
├─────────────────────────┤
│ [✓] Enable TabTab       │  ← Master toggle (always active)
├─────────────────────────┤
│ Domain Grouping         │
│ [main ▼]                │  ← 'main' or 'full'
│                         │
│ [✓] Auto-collapse       │
│ [✓] Sort groups front   │
│ [✓] Show tab count      │
│                         │
│ Excluded Domains        │
│ ┌─────────────────────┐ │
│ │ github.com          │ │
│ │                     │ │
│ └─────────────────────┘ │
│                         │
│ Group Names             │
│ google.com [Google  ][×]│
│ github.com [MyRepo  ][×]│
│ [domain____][name___][+] │
│                         │
│ [       Save       ]    │
└─────────────────────────┘
```

### 8.2 Interactions

| Element | Behavior |
|---------|----------|
| Master toggle | Uncheck → immediately disables all settings (opacity + pointer-events), sends `settingsChanged` to ungroup everything |
| Domain Grouping select | `main` or `full` granularity |
| Auto-collapse checkbox | Toggle collapse-on-switch behavior |
| Sort groups checkbox | Toggle alphabetical sort-at-front |
| Show tab count checkbox | Toggle `(count)` suffix on group names |
| Excluded Domains textarea | One domain per line |
| Group Names list | Each row: domain label + name input + delete (×) button |
| Add row | Domain input + name input + plus button → saves to storage |
| Edit name | Type in input → auto-saves on change (blur) |
| Delete | × button → removes entry from storage, re-renders list |
| Save button | Persists all settings, sends `settingsChanged` message |
| Status message | "Saved!" appears for 1.5s, then fades |

### 8.3 Domain Name Sync

When the popup opens, it sends a `syncDomainNames` message to the service worker. The SW queries all existing groups and adds any missing domains to the `domainNames` storage. This ensures previously auto-grouped domains appear in the list even if they were added before this feature existed.

---

## 9. Data Flow & Storage

| Storage Key | Storage Type | Format | Purpose |
|-------------|-------------|--------|---------|
| `settings` | `storage.local` | `{ enabled, granularity, excludedDomains, autoCollapse, sortGroupsToFront, showTabCount }` | Persistent settings |
| `domainNames` | `storage.local` | `{ "google.com": "Google", ... }` | Custom group display names |
| `domainColorMap` | `storage.session` | `{ "google.com": "blue", ... }` | Ephemeral color assignments (survives SW restart, cleared on browser restart) |

### In-Memory State (service worker)

| Variable | Type | Purpose |
|----------|------|---------|
| `domainGroupCache` | `Map<string, number>` | `"windowId:domain"` → groupId fast lookup |
| `groupBaseDomains` | `Map<number, string>` | groupId → base domain name |
| `expandedGroupIds` | `Set<number>` | Tracks which groups are expanded |
| `groupingInProgress` | `boolean` | Mutex for `groupAllExistingTabs` |
| `installedJustFired` | `boolean` | Prevents double-init on SW start |

---

## 10. Edge Cases & Special Handling

### 10.1 Tab Navigation Between Domains

When a tab in a group navigates to a URL with a different domain:
- `pendingUrl` is checked (not just `url`) to catch the navigation early
- If only 1 tab of the new domain exists → ungroup from old group, collapse old group
- If 2+ tabs of the new domain exist → move tab to that domain's group

### 10.2 External Links Opened in New Tab

Chrome's default behavior places new tabs opened from a grouped tab into the same group. TabTab handles this:
- `handleTabUpdated` fires when the new tab's URL is known
- `groupTabByDomain` recomputes grouping based on the tab's actual domain
- If the domain doesn't match the opener's group → the tab is moved to the correct group or ungrouped

### 10.3 Right-Click "Open Link in New Tab"

- `handleTabCreated` is a deliberate no-op — if it called `groupTabByDomain`, a race with `handleTabUpdated` would cause both to try grouping concurrently, preventing the original tab from being added to the correct group
- Only `handleTabUpdated` performs grouping, ensuring the URL is final

### 10.4 Service Worker Restart

- Chrome terminates service workers after ~30s of inactivity
- On restart: a 100ms `setTimeout` runs `groupAllExistingTabs` (unless `handleInstalled` also just fired)
- `expandedGroupIds` is rebuilt from current group collapsed state
- `domainGroupCache` and `groupBaseDomains` are empty; rebuilt by `findGroupForDomain` fallback logic

### 10.5 Extension Reload (chrome://extensions)

- `handleInstalled` fires with `reason: 'update'`
- `installedJustFired` flag prevents the 100ms setTimeout from running `groupAllExistingTabs` twice
- `groupingInProgress` mutex prevents `handleTabActivated` and `handleGroupUpdated` from interfering with the bulk regroup

### 10.6 Single Tab in Group Cleanup

When the second-to-last tab in a group is closed:
- `handleTabRemoved` detects 1 tab remaining → ungroup + move to right after the last surviving group (not to the very end of the tab strip)
- Target position is computed by finding the max tab index among groups that still have 2+ tabs, then placing the ungrouped tab at `maxIndex + 1`
- This prevents orphan single-tab groups while keeping the tab near the groups

### 10.7 Page Refresh

- Refreshing a single tab triggers `handleTabUpdated` on complete
- `groupTabByDomain` finds only 1 same-domain tab → returns without creating a group
- Prevents creating single-tab groups on refresh

### 10.8 Pinned Tabs

- Pinned tabs are always excluded from grouping
- Check: `if (tab.pinned) return/continue`

### 10.9 Chrome "Tabs cannot be edited right now"

Chrome blocks tab modification API calls while the user is physically interacting with tabs (dragging, clicking). Solution:
- `collapseGroup` and `expandGroup` retry up to 3 times with 100ms delay
- `handleTabActivated` adds a 50ms initial delay before any tab group API calls

### 10.10 Chrome Bookmarks Bar Auto-Save

**Known Chrome issue (Chrome 120+):** When a tab group is created with a custom title, Chrome may automatically save it to the bookmarks bar. There is no extension API to prevent this. Users must manually disable it at `chrome://flags/#tab-groups-save`.

### 10.11 Frozen / Discarded Tabs

Chrome may freeze (discard) idle tabs to save memory. Discarded tabs can have inaccessible `tab.url` values when queried via `chrome.tabs.query`. This causes `groupTabByDomain`'s domain-based tab counting to miss discarded group members, making `sameDomainTabIds.length < 2` even though the group still has other tabs.

**Fix:** Before ungrouping a tab and collapsing its group due to low domain count, verify the group's actual tab count via `chrome.tabs.query({ groupId })`. If the group still has >1 tab, skip the ungroup/collapse. This prevents auto-collapse of groups containing discarded tabs when the user expands them.

### 10.12 Active Group Positioning

When a group becomes active (user clicks a tab in it or expands its header), the group is moved to the rightmost position among all groups. This is handled by `sortGroupsInWindow`:
- The expanded group is moved to index 0 first, then other groups are moved to index 0 → the expanded group gets pushed right and ends up at the end of the group cluster
- If `sortGroupsToFront` is disabled, no repositioning occurs

### 10.13 Tab Joins Existing Group — Group Position

When a new tab joins an existing group via `chrome.tabs.group({ tabIds, groupId })`, Chrome may reposition the group to where the new tab was. To prevent the group from ending up after ungrouped tabs, `sortGroupsInWindow` is called immediately after the group operation to move all groups back to the front.

### 10.14 UI Performance — Avoiding Tab Strip Flicker

Chrome tab strip layout changes are expensive and visually disruptive. Every `chrome.tabs.group`, `chrome.tabGroups.update`, and `chrome.tabGroups.move` call triggers a re-layout. Event cascades (e.g., `handleTabUpdated` → `groupTabByDomain` → `sortGroupsInWindow` → `handleTabActivated` → `sortGroupsInWindow` again) can cause 3+ re-layouts for a single tab navigation.

**Optimization rules applied:**

| Rule | Mechanism | Impact |
|------|-----------|--------|
| Coalesce `sortGroupsInWindow` | Per-window debounce (80ms). Multiple calls within the window coalesce into a single deferred execution. | Eliminates redundant sorts from event cascades |
| Skip `groupTabByDomain` when already correct | If the tab is already in the correct group and no same-domain tabs exist outside it, return without any API calls. | Avoids unnecessary `chrome.tabs.group` and sort on page refreshes or duplicate `handleTabUpdated` events |
| State pre-check in `collapseGroup` / `expandGroup` | Query current `collapsed` state via `chrome.tabGroups.get` before calling update. Skip if already in the target state. | Prevents redundant API calls when groups are already collapsed/expanded |
| Skip `updateGroupTitle` if unchanged | Compare computed title against current group title. Skip `chrome.tabGroups.update` if identical. | Avoids unnecessary re-layout when tab count hasn't changed |

---

## 11. Implementation Constraints & Gotchas

1. **MV3 Service Worker cannot use `importScripts` reliably.** All code used by `background.js` must be inline. The `utils.js` file is ONLY for the popup page.

2. **Listeners must be registered at top-level scope** (not inside async callbacks or conditionals). MV3 service workers may terminate before async registration completes.

3. **`chrome.tabGroups` API only accepts specific color values:** `grey`, `blue`, `red`, `yellow`, `green`, `pink`, `purple`, `cyan`, `orange`. Custom hex colors are rejected.

4. **`chrome.tabGroups.query()` cannot filter by title or color.** The only queryable field is `windowId`. All filtering must happen in application code.

5. **Tab group IDs are positive integers** (not UUIDs). They are unique per browser session.

6. **`chrome.tabs.group({ tabIds, groupId })` can move tabs between groups** — use this to add tabs to an existing group rather than ungroup+regroup.

7. **`pendingUrl` on tabs** is only available during navigation; after `complete`, only `url` is set. Always check both: `tab.pendingUrl || tab.url`.

---

## 12. Message Protocol (SW ↔ Popup)

| Message Type | Direction | Payload | Effect |
|-------------|-----------|---------|--------|
| `settingsChanged` | Popup → SW | `{}` | Regroup all tabs or ungroup all (depending on `enabled`), refresh titles |
| `syncDomainNames` | Popup → SW | `{}` | Sync missing domain names from existing groups into storage |

---

## 13. Verification Checklist

- [ ] Open multiple tabs of the same domain → auto-grouped with correct color
- [ ] Open multiple tabs of different domains → each domain gets its own group
- [ ] Click between groups → inactive groups auto-collapse, active group expands
- [ ] Click an ungrouped tab → all groups collapse
- [ ] Open link in new tab from grouped tab → correctly grouped by domain (not by source)
- [ ] Navigate tab to external domain → ungrouped from old group, old group collapses
- [ ] Close tabs until 1 remains in a group → auto-ungroup, tab moves to right after remaining groups
- [ ] Page refresh on single tab → no single-tab group created
- [ ] Active group always at the rightmost position among groups
- [ ] New tab joining existing group → group stays at front (not after ungrouped tabs)
- [ ] Expand group with frozen/discarded tabs → group stays expanded, does not auto-collapse
- [ ] Tab navigation → tab strip does not flicker or re-layout multiple times per navigation
- [ ] Toggle master switch off → all groups removed immediately
- [ ] Toggle master switch on → all tabs regrouped
- [ ] Change domain granularity → regroup with new granularity
- [ ] Add domain to excluded list → that domain ungrouped and excluded
- [ ] Custom group name → group title uses custom name
- [ ] Show/hide tab count → group title format updates
- [ ] Sort groups to front → groups at front, alphabetically sorted
- [ ] Extension reload → no tab switch, all groups preserved
- [ ] Browser restart → all tabs regrouped correctly
- [ ] Pinned tabs → never included in groups
- [ ] `chrome://` and `about:` pages → never grouped
