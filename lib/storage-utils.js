export const DEFAULT_SETTINGS = {
  enabled: true,
  granularity: 'main',
  excludedDomains: [],
  autoCollapse: true,
  sortGroupsToFront: true,
  showTabCount: true
};

export async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...stored.settings };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export function isDomainExcluded(domain, excludedDomains) {
  if (!domain || !excludedDomains) return false;
  return excludedDomains.some(excluded =>
    domain === excluded || domain.endsWith('.' + excluded)
  );
}

export async function getDomainNames() {
  const { domainNames = {} } = await chrome.storage.local.get('domainNames');
  return domainNames;
}

export async function saveDomainNames(domainNames) {
  await chrome.storage.local.set({ domainNames });
}

export async function getCustomName(domain) {
  const names = await getDomainNames();
  return names[domain] || null;
}
