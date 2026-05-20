export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const KNOWN_SLD = new Set([
  'co', 'com', 'org', 'net', 'gov', 'edu', 'ac',
  'me', 'info', 'biz', 'name', 'pro', 'mobi', 'nom'
]);

export function extractDomain(url, granularity) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    let hostname = parsed.hostname;
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    if (granularity === 'full') return hostname;
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    if (KNOWN_SLD.has(parts[parts.length - 2]) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  } catch (e) {
    return null;
  }
}

export function hashDomainToColor(domain) {
  let hash = 5381;
  for (let i = 0; i < domain.length; i++) {
    hash = ((hash << 5) + hash + domain.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

export async function getColorForDomain(domain) {
  const { domainColorMap = {} } = await chrome.storage.session.get('domainColorMap');
  if (domainColorMap[domain]) return domainColorMap[domain];

  const takenColors = new Set(Object.values(domainColorMap));
  const preferred = hashDomainToColor(domain);
  const color = assignFallbackColor(takenColors, preferred);

  domainColorMap[domain] = color;
  await chrome.storage.session.set({ domainColorMap });
  return color;
}

function assignFallbackColor(takenColors, preferred) {
  if (!takenColors.has(preferred)) return preferred;
  for (const c of GROUP_COLORS) {
    if (!takenColors.has(c)) return c;
  }
  return preferred;
}
