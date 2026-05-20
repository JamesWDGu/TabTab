import { domainGroupCache, groupBaseDomains, expandedGroupIds, groupingInProgress, installedJustFired, setInstalledJustFired } from './lib/state.js';
import { getSettings } from './lib/storage-utils.js';
import {
  collapseGroup, expandGroup, ungroupAllTabs,
  updateGroupTitle, sortGroupsInWindow,
  groupTabByDomain, groupAllExistingTabs,
  syncDomainNamesFromGroups
} from './lib/group-logic.js';

// ==== State Initialization ====

(async () => {
  try {
    const groups = await chrome.tabGroups.query({});
    for (const g of groups) {
      if (!g.collapsed) expandedGroupIds.add(g.id);
    }
  } catch (e) {}
})();

setTimeout(async () => {
  if (!installedJustFired) {
    const settings = await getSettings();
    if (settings.enabled) await groupAllExistingTabs();
  }
}, 100);

// ==== Event-Helper Functions ====

async function collapseGroupsInWindow(windowId, { exceptGroupId } = {}) {
  const allGroups = await chrome.tabGroups.query({ windowId });
  for (const g of allGroups) {
    if (g.id === exceptGroupId) continue;
    if (!g.collapsed) {
      await collapseGroup(g.id);
      expandedGroupIds.delete(g.id);
    }
  }
}

async function focusLastTabInGroup(groupId) {
  const tabs = await chrome.tabs.query({ groupId });
  if (tabs.length === 0) return;
  const lastTab = tabs.reduce((a, b) => a.index > b.index ? a : b);
  try { await chrome.tabs.update(lastTab.id, { active: true }); } catch (e) {}
}

async function computeTargetIndex(windowId, fromIdx) {
  let lastGroupIdx = -1;
  const groups = await chrome.tabGroups.query({ windowId });
  for (const g of groups) {
    const tabs = await chrome.tabs.query({ groupId: g.id });
    for (const t of tabs) {
      if (t.index > lastGroupIdx) lastGroupIdx = t.index;
    }
  }
  return (fromIdx <= lastGroupIdx) ? lastGroupIdx : lastGroupIdx + 1;
}

async function dismantleSingleTabGroup(groupId, tab, windowId) {
  const fromIdx = tab.index;
  try { await chrome.tabs.ungroup(tab.id); } catch (e) {}
  const target = await computeTargetIndex(windowId, fromIdx);
  try { await chrome.tabs.move(tab.id, { index: target }); } catch (e) {}
  groupBaseDomains.delete(groupId);
}

async function handleSettingsChanged() {
  domainGroupCache.clear();
  const settings = await getSettings();
  if (settings.enabled) {
    await groupAllExistingTabs();
    for (const [groupId, domain] of groupBaseDomains) {
      await updateGroupTitle(groupId);
    }
  } else {
    await ungroupAllTabs();
  }
}

// ==== Event Handlers ====

function handleTabCreated(tab) {
  // No-op: grouping is deferred to handleTabUpdated when URL is final
}

async function handleTabUpdated(tabId, changeInfo, tab) {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (tab.pendingUrl || changeInfo.url || changeInfo.status === 'complete') {
    await groupTabByDomain(tab);
  }
}

async function handleTabRemoved(tabId, removeInfo) {
  if (removeInfo.isWindowClosing) return;
  const settings = await getSettings();
  if (!settings.enabled) return;

  const groups = await chrome.tabGroups.query({ windowId: removeInfo.windowId });
  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length === 1) {
      await dismantleSingleTabGroup(group.id, tabs[0], removeInfo.windowId);
    } else {
      await updateGroupTitle(group.id);
    }
  }
}

async function handleTabActivated(activeInfo) {
  if (groupingInProgress) return;
  const { tabId, windowId } = activeInfo;
  const tab = await chrome.tabs.get(tabId);
  const newGroupId = tab.groupId;

  const settings = await getSettings();
  if (!settings.enabled || !settings.autoCollapse) return;

  await new Promise(r => setTimeout(r, 50));

  if (newGroupId === -1) {
    await collapseGroupsInWindow(windowId);
    return;
  }
  await collapseGroupsInWindow(windowId, { exceptGroupId: newGroupId });
  expandedGroupIds.add(newGroupId);
  await expandGroup(newGroupId);
  await sortGroupsInWindow(windowId);
}

async function handleGroupUpdated(group) {
  if (groupingInProgress) return;
  if (group.collapsed) {
    expandedGroupIds.delete(group.id);
    return;
  }
  if (expandedGroupIds.has(group.id)) return;
  expandedGroupIds.add(group.id);

  const settings = await getSettings();
  if (!settings.enabled || !settings.autoCollapse) return;

  await collapseGroupsInWindow(group.windowId, { exceptGroupId: group.id });
  await focusLastTabInGroup(group.id);
  await sortGroupsInWindow(group.windowId);
}

async function handleInstalled(details) {
  if (details.reason === 'install' || details.reason === 'update') {
    setInstalledJustFired(true);
    const settings = await getSettings();
    if (settings.enabled) await groupAllExistingTabs();
  }
}

async function handleStartup() {
  const settings = await getSettings();
  if (settings.enabled) await groupAllExistingTabs();
}

async function handleMessage(message) {
  if (message.type === 'settingsChanged') {
    await handleSettingsChanged();
  }
  if (message.type === 'syncDomainNames') {
    await syncDomainNamesFromGroups();
    return true;
  }
}

// ==== Listener Registration (MV3: must be top-level, synchronous) ====

chrome.tabs.onCreated.addListener(handleTabCreated);
chrome.tabs.onUpdated.addListener(handleTabUpdated);
chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.tabGroups.onUpdated.addListener(handleGroupUpdated);
chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.runtime.onStartup.addListener(handleStartup);
chrome.runtime.onMessage.addListener(handleMessage);
