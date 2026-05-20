import { getSettings, saveSettings, getDomainNames, saveDomainNames } from './lib/storage-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();
  document.getElementById('enabled').checked = settings.enabled;
  document.getElementById('granularity').value = settings.granularity;
  document.getElementById('autoCollapse').checked = settings.autoCollapse;
  document.getElementById('sortGroupsToFront').checked = settings.sortGroupsToFront;
  document.getElementById('showTabCount').checked = settings.showTabCount;
  document.getElementById('excludedDomains').value = settings.excludedDomains.join('\n');

  updateSettingsUI(settings.enabled);
  try { await chrome.runtime.sendMessage({ type: 'syncDomainNames' }); } catch (e) {}
  await renderDomainNames();

  document.getElementById('enabled').addEventListener('change', async () => {
    const enabled = document.getElementById('enabled').checked;
    updateSettingsUI(enabled);
    const currentSettings = await getSettings();
    await saveSettings({ ...currentSettings, enabled });
    chrome.runtime.sendMessage({ type: 'settingsChanged' });
  });

  document.getElementById('addDomainName').addEventListener('click', async () => {
    const domain = document.getElementById('newDomain').value.trim().toLowerCase();
    const name = document.getElementById('newName').value.trim();
    if (!domain || !name) return;
    const domainNames = await getDomainNames();
    domainNames[domain] = name;
    await saveDomainNames(domainNames);
    document.getElementById('newDomain').value = '';
    document.getElementById('newName').value = '';
    await renderDomainNames();
    chrome.runtime.sendMessage({ type: 'settingsChanged' });
  });

  document.getElementById('save').addEventListener('click', async () => {
    const enabled = document.getElementById('enabled').checked;
    const newSettings = {
      enabled,
      granularity: document.getElementById('granularity').value,
      autoCollapse: document.getElementById('autoCollapse').checked,
      sortGroupsToFront: document.getElementById('sortGroupsToFront').checked,
      showTabCount: document.getElementById('showTabCount').checked,
      excludedDomains: document.getElementById('excludedDomains').value
        .split('\n')
        .map(d => d.trim().toLowerCase())
        .filter(d => d.length > 0)
    };

    await saveSettings(newSettings);

    const status = document.getElementById('status');
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 1500);

    chrome.runtime.sendMessage({ type: 'settingsChanged' });
  });

  async function renderDomainNames() {
    const domainNames = await getDomainNames();
    const container = document.getElementById('domainNameList');
    container.innerHTML = '';
    const entries = Object.entries(domainNames).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [domain, name] of entries) {
      const row = document.createElement('div');
      row.className = 'domain-row';

      const domainSpan = document.createElement('span');
      domainSpan.className = 'domain-label';
      domainSpan.textContent = domain;

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = name;
      nameInput.className = 'name-input';
      nameInput.addEventListener('change', async () => {
        const names = await getDomainNames();
        names[domain] = nameInput.value.trim() || domain;
        await saveDomainNames(names);
        chrome.runtime.sendMessage({ type: 'settingsChanged' });
      });

      const delBtn = document.createElement('button');
      delBtn.textContent = '×';
      delBtn.className = 'btn-del';
      delBtn.addEventListener('click', async () => {
        const names = await getDomainNames();
        delete names[domain];
        await saveDomainNames(names);
        await renderDomainNames();
        chrome.runtime.sendMessage({ type: 'settingsChanged' });
      });

      row.appendChild(domainSpan);
      row.appendChild(nameInput);
      row.appendChild(delBtn);
      container.appendChild(row);
    }
  }
});

function updateSettingsUI(enabled) {
  const settingsContainer = document.getElementById('settings');
  if (enabled) {
    settingsContainer.classList.remove('disabled');
  } else {
    settingsContainer.classList.add('disabled');
  }
}
