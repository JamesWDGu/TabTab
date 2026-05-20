import { domainGroupCache, groupBaseDomains, expandedGroupIds, groupingInProgress, setGroupingInProgress } from './state.js';
import { extractDomain, getColorForDomain } from './domain-utils.js';
import { getSettings, isDomainExcluded, getDomainNames, saveDomainNames, getCustomName } from './storage-utils.js';

// ==== Expand / Collapse ====

export async function collapseGroup(groupId) {
  try {
    const g = await chrome.tabGroups.get(groupId);
    if (g.collapsed) return;
  } catch (e) { /* group gone */ return; }

  for (let i = 0; i < 3; i++) {
    try {
      await chrome.tabGroups.update(groupId, { collapsed: true });
      return;
    } catch (e) {
      if (!e.message || !e.message.includes('right now')) return;
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

export async function expandGroup(groupId) {
  try {
    const g = await chrome.tabGroups.get(groupId);
    if (!g.collapsed) return;
  } catch (e) { /* group gone */ return; }

  for (let i = 0; i < 3; i++) {
    try {
      await chrome.tabGroups.update(groupId, { collapsed: false });
      return;
    } catch (e) {
      if (!e.message || !e.message.includes('right now')) return;
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

// ==== Ungroup All ====

export async function ungroupAllTabs() {
  const allTabs = await chrome.tabs.query({});
  const groupedIds = allTabs.filter(t => t.groupId !== -1).map(t => t.id);
  if (groupedIds.length > 0) {
    try { await chrome.tabs.ungroup(groupedIds); } catch (e) {}
  }
  groupBaseDomains.clear();
}

// ==== Group Title & Name Helpers ====

async function buildGroupTitle(domain, tabCount, settings) {
  const customName = await getCustomName(domain);
  const displayName = customName || domain;
  if (settings.showTabCount) return `${displayName}(${tabCount})`;
  return displayName;
}

async function autoRegisterDomainName(domain) {
  const customName = await getCustomName(domain);
  if (customName) return;
  const domainNames = await getDomainNames();
  domainNames[domain] = domain;
  await saveDomainNames(domainNames);
}

export async function updateGroupTitle(groupId) {
  const domain = groupBaseDomains.get(groupId);
  if (!domain) return;
  const settings = await getSettings();
  let currentTitle;
  try {
    const g = await chrome.tabGroups.get(groupId);
    currentTitle = g.title;
  } catch (e) { return; }
  const tabs = await chrome.tabs.query({ groupId });
  const title = await buildGroupTitle(domain, tabs.length, settings);
  if (title === currentTitle) return;
  try { await chrome.tabGroups.update(groupId, { title }); } catch (e) {}
}

// ==== Group Lookup ====

async function lookupCachedGroup(cacheKey, domain) {
  const groupId = domainGroupCache.get(cacheKey);
  if (groupId === undefined) return null;
  try {
    await chrome.tabGroups.get(groupId);
    if (groupBaseDomains.get(groupId) === domain) return groupId;
  } catch (e) { /* group was removed */ }
  domainGroupCache.delete(cacheKey);
  groupBaseDomains.delete(groupId);
  return null;
}

async function scanWindowForGroup(domain, windowId, cacheKey) {
  const groups = await chrome.tabGroups.query({ windowId });
  for (const group of groups) {
    if (groupBaseDomains.get(group.id) === domain) {
      domainGroupCache.set(cacheKey, group.id);
      return group.id;
    }
  }
  return null;
}

export async function findGroupForDomain(domain, windowId) {
  const cacheKey = `${windowId}:${domain}`;
  return await lookupCachedGroup(cacheKey, domain)
      || await scanWindowForGroup(domain, windowId, cacheKey);
}

// ==== Sort Groups ====

const pendingSorts = new Map();

export async function sortGroupsInWindow(windowId) {
  const settings = await getSettings();
  if (!settings.sortGroupsToFront) return;

  // Coalesce calls within the same window to avoid rapid re-layout
  if (pendingSorts.has(windowId)) return;
  pendingSorts.set(windowId, true);
  await new Promise(r => setTimeout(r, 80));
  pendingSorts.delete(windowId);

  const groups = await chrome.tabGroups.query({ windowId });
  if (groups.length === 0) return;
  const sorted = groups.sort((a, b) => {
    const aActive = expandedGroupIds.has(a.id);
    const bActive = expandedGroupIds.has(b.id);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return b.title.localeCompare(a.title);
  });
  for (const group of sorted) {
    try { await chrome.tabGroups.move(group.id, { index: 0 }); } catch (e) {}
  }
}

// ==== Domain Name Sync ====

export async function syncDomainNamesFromGroups() {
  const domainNames = await getDomainNames();
  const groups = await chrome.tabGroups.query({});
  let changed = false;
  for (const group of groups) {
    const domain = groupBaseDomains.get(group.id);
    if (domain && !(domain in domainNames)) {
      domainNames[domain] = domain;
      changed = true;
    }
  }
  if (changed) await saveDomainNames(domainNames);
}

// ==== Incremental Grouping ====

function collectSameDomainTabs(allTabs, domain, granularity) {
  return allTabs.filter(t => {
    if (t.pinned || !t.url) return false;
    return extractDomain(t.url, granularity) === domain;
  });
}

async function removeTabFromStaleGroup(tab) {
  if (tab.groupId === -1) return;
  const groupTabs = await chrome.tabs.query({ groupId: tab.groupId });
  if (groupTabs.length > 1) return; // frozen/discarded tabs guard
  const oldGroupId = tab.groupId;
  try { await chrome.tabs.ungroup(tab.id); } catch (e) {}
  try { await collapseGroup(oldGroupId); } catch (e) {}
}

async function mergeTabsIntoGroup(groupId, domain, sameDomainTabs, windowId) {
  groupBaseDomains.set(groupId, domain);
  const tabsToGroup = sameDomainTabs.filter(t => t.groupId !== groupId).map(t => t.id);
  if (tabsToGroup.length > 0) {
    await chrome.tabs.group({ tabIds: tabsToGroup, groupId });
    await sortGroupsInWindow(windowId);
  }
  await updateGroupTitle(groupId);
}

async function configureNewGroup(groupId, domain, tabCount, windowId, settings) {
  const color = await getColorForDomain(domain);
  groupBaseDomains.set(groupId, domain);
  await autoRegisterDomainName(domain);
  const title = await buildGroupTitle(domain, tabCount, settings);
  try { await chrome.tabGroups.update(groupId, { title, color, collapsed: true }); } catch (e) {}
  domainGroupCache.set(`${windowId}:${domain}`, groupId);
}

async function createDomainGroup(domain, tabIds, windowId, settings) {
  const groupId = await chrome.tabs.group({ tabIds });
  await configureNewGroup(groupId, domain, tabIds.length, windowId, settings);
  await sortGroupsInWindow(windowId);
}

export async function groupTabByDomain(tab) {
  const tabUrl = tab.pendingUrl || tab.url;
  if (!tabUrl || tab.pinned) return;
  const settings = await getSettings();
  const domain = extractDomain(tabUrl, settings.granularity);
  if (!domain || isDomainExcluded(domain, settings.excludedDomains)) return;

  const allTabs = await chrome.tabs.query({ windowId: tab.windowId });
  const sameDomainTabs = collectSameDomainTabs(allTabs, domain, settings.granularity);

  // Skip if already correctly grouped and no stray same-domain tabs need grouping
  if (tab.groupId !== -1 && groupBaseDomains.get(tab.groupId) === domain) {
    const strays = sameDomainTabs.filter(t => t.id !== tab.id && t.groupId !== tab.groupId);
    if (strays.length === 0) return;
  }

  const existingGroupId = await findGroupForDomain(domain, tab.windowId);

  if (existingGroupId !== null) {
    await mergeTabsIntoGroup(existingGroupId, domain, sameDomainTabs, tab.windowId);
    return;
  }
  if (sameDomainTabs.length < 2) {
    await removeTabFromStaleGroup(tab);
    return;
  }
  await createDomainGroup(domain, sameDomainTabs.map(t => t.id), tab.windowId, settings);
}

// ==== Batch Grouping ====

function splitKey(key) {
  const colonIdx = key.indexOf(':');
  return [parseInt(key.slice(0, colonIdx)), key.slice(colonIdx + 1)];
}

function buildDomainTabMap(allTabs, settings) {
  const map = new Map();
  for (const tab of allTabs) {
    if (tab.pinned || !tab.url) continue;
    const domain = extractDomain(tab.url, settings.granularity);
    if (!domain || isDomainExcluded(domain, settings.excludedDomains)) continue;
    const key = `${tab.windowId}:${domain}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tab);
  }
  return map;
}

async function processDomainCluster(domain, tabs, windowId, settings) {
  const tabIds = tabs.map(t => t.id);
  const existingGroupId = await findGroupForDomain(domain, windowId);
  if (existingGroupId !== null) {
    groupBaseDomains.set(existingGroupId, domain);
    const toGroup = tabIds.filter(id => {
      const tab = tabs.find(t => t.id === id);
      return tab && tab.groupId !== existingGroupId;
    });
    if (toGroup.length > 0) {
      await chrome.tabs.group({ tabIds: toGroup, groupId: existingGroupId });
    }
    await updateGroupTitle(existingGroupId);
  } else {
    await createDomainGroup(domain, tabIds, windowId, settings);
  }
}

async function groupTabsByDomainCluster(domainTabMap, settings) {
  const windowsProcessed = new Set();
  for (const [key, tabs] of domainTabMap) {
    if (tabs.length < 2) continue;
    const [windowId, domain] = splitKey(key);
    await processDomainCluster(domain, tabs, windowId, settings);
    windowsProcessed.add(windowId);
  }
  return windowsProcessed;
}

export async function groupAllExistingTabs() {
  if (groupingInProgress) return;
  setGroupingInProgress(true);
  try {
    const allTabs = await chrome.tabs.query({});
    const settings = await getSettings();
    const domainTabMap = buildDomainTabMap(allTabs, settings);
    const windowsProcessed = await groupTabsByDomainCluster(domainTabMap, settings);
    for (const windowId of windowsProcessed) {
      await sortGroupsInWindow(windowId);
    }
  } finally {
    setGroupingInProgress(false);
  }
}
