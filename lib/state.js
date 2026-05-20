export const domainGroupCache = new Map();
export const groupBaseDomains = new Map();
export const expandedGroupIds = new Set();

export let groupingInProgress = false;
export let installedJustFired = false;

export function setGroupingInProgress(value) { groupingInProgress = value; }
export function setInstalledJustFired(value) { installedJustFired = value; }
