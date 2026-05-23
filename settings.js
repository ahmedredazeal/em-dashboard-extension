/**
 * settings.js
 * Settings page controller
 * Manages Jira + Sentry credentials, squad selection, theme
 */

import { parseSentryUrl } from './src/parsers.js';
import { runMigrations } from './src/migrations.js';

// ── Sentry view row rendering ──────────────────────────────────────────────
// Storage shape: settings.sentry.views = [{ label: string, url: string }, ...]
// Each row in the UI has: label input, URL input, ×, and a preview line below
// showing what we parsed from the URL.

function renderSentryViewRows(views) {
  const list = document.getElementById('sentry-views-list');
  if (!list) return;
  list.innerHTML = '';
  
  // Always show at least one row (empty if no views)
  const rows = views.length > 0 ? views : [{ label: '', url: '' }];
  rows.forEach(view => list.appendChild(createSentryViewRow(view)));
}

function createSentryViewRow(view) {
  const row = document.createElement('div');
  row.className = 'sentry-view-row';
  row.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;background:var(--surface,#1a1b23);border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:6px;';
  
  // Top: label + URL + remove button
  row.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;">
      <input type="text" class="sv-label" placeholder="Label (e.g. HRM Issues)"
        value="${escapeAttr(view.label || '')}"
        style="width:140px;flex-shrink:0;padding:5px 8px;background:var(--surface-raised,#1f2937);
               border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:4px;
               color:var(--text);font-size:12px;"/>
      <input type="url" class="sv-url" placeholder="https://zeal.sentry.io/issues/views/..."
        value="${escapeAttr(view.url || '')}"
        style="flex:1;min-width:0;padding:5px 8px;background:var(--surface-raised,#1f2937);
               border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:4px;
               color:var(--text);font-size:11px;font-family:monospace;"/>
      <button type="button" class="sv-remove" title="Remove this view"
        style="background:none;border:none;color:var(--text-muted);cursor:pointer;
               font-size:16px;line-height:1;padding:4px 8px;flex-shrink:0;">×</button>
    </div>
    <div class="sv-preview" style="font-size:10px;color:var(--text-muted);padding-left:4px;min-height:14px;"></div>
  `;
  
  const urlInput   = row.querySelector('.sv-url');
  const previewEl  = row.querySelector('.sv-preview');
  const removeBtn  = row.querySelector('.sv-remove');
  
  updateRowPreview(urlInput, previewEl);
  urlInput.addEventListener('input', () => updateRowPreview(urlInput, previewEl));
  
  removeBtn.addEventListener('click', () => {
    row.remove();
    // Always keep at least one row visible
    const list = document.getElementById('sentry-views-list');
    if (list && list.children.length === 0) {
      list.appendChild(createSentryViewRow({ label: '', url: '' }));
    }
  });
  
  return row;
}

function updateRowPreview(urlInput, previewEl) {
  const url = urlInput.value.trim();
  if (!url) {
    previewEl.textContent = '';
    urlInput.style.borderColor = 'var(--border,rgba(255,255,255,0.1))';
    return;
  }
  
  const parsed = parseSentryUrl(url);
  if (!parsed) {
    previewEl.innerHTML = `<span style="color:#ef4444;">Couldn't parse this URL — make sure it's a Sentry view URL</span>`;
    urlInput.style.borderColor = '#ef4444';
    return;
  }
  
  urlInput.style.borderColor = 'rgba(34,197,94,0.5)';
  const parts = [
    `View ${parsed.viewId}`,
    parsed.projectIds.length > 0 ? `${parsed.projectIds.length} project${parsed.projectIds.length > 1 ? 's' : ''}` : 'all projects',
    parsed.environment || null,
    parsed.query || null,
  ].filter(Boolean);
  previewEl.innerHTML = `<span style="color:#22c55e;">✓</span> ${parts.join(' · ')}`;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Read all rows from the DOM and produce the persisted {label, url}[] array.
// Skips fully-empty rows. Keeps invalid URLs (so the user doesn't lose work);
// background.js will skip them at fetch time with a warning.
function collectSentryViewsFromRows() {
  const list = document.getElementById('sentry-views-list');
  if (!list) return [];
  
  const rows = Array.from(list.querySelectorAll('.sentry-view-row'));
  return rows
    .map(row => ({
      label: row.querySelector('.sv-label')?.value.trim() || '',
      url:   row.querySelector('.sv-url')?.value.trim() || '',
    }))
    .filter(v => v.label || v.url);  // drop fully-blank rows
}

(async function() {
  // Run pending migrations first so we read the post-migration shape below
  await runMigrations().catch(err => console.warn('[settings] Migration failed:', err.message));
  
  // Load existing settings
  const result = await chrome.storage.local.get(['settings']);
  const settings = result.settings || {};
  
  // Populate form
  if (settings.jira) {
    document.getElementById('jira-url').value = settings.jira.baseUrl || '';
    document.getElementById('jira-email').value = settings.jira.email || '';
    document.getElementById('jira-token').value = settings.jira.token || '';
  }
  
  if (settings.sentry) {
    document.getElementById('sentry-url').value = settings.sentry.baseUrl || 'https://zeal.sentry.io';
    document.getElementById('sentry-org').value = settings.sentry.org || '';
    document.getElementById('sentry-token').value = settings.sentry.token || '';
  }
  
  // Always render Sentry view rows — runs even on fresh install (no settings.sentry yet)
  // so the user always sees one empty row to fill in
  renderSentryViewRows(settings.sentry?.views || []);
  
  if (settings.squad) {
    document.getElementById('squad-key').value = settings.squad.key || '';
    document.getElementById('squad-name').value = settings.squad.name || '';
    // Extra boards (comma-separated)
    if (Array.isArray(settings.squad.extraBoards)) {
      document.getElementById('squad-extra-boards').value = settings.squad.extraBoards
        .map(b => typeof b === 'object' ? `${b.name}|${b.id}` : String(b))
        .join('\n');
    }
  }
  
  // Select current theme
  const theme = settings.ui?.theme || 'browser';
  document.querySelector(`input[name="theme"][value="${theme}"]`)?.click();
  
  // "+ Add another view" — append blank row to Sentry view list
  document.getElementById('add-sentry-view')?.addEventListener('click', () => {
    const list = document.getElementById('sentry-views-list');
    if (list) list.appendChild(createSentryViewRow({ label: '', url: '' }));
  });
  
  // Test Jira connection
  document.getElementById('jira-test-btn').addEventListener('click', async () => {
    const btn = document.getElementById('jira-test-btn');
    const resultDiv = document.getElementById('jira-test-result');
    
    btn.disabled = true;
    btn.textContent = 'Testing...';
    resultDiv.classList.add('hidden');
    
    try {
      const baseUrl = document.getElementById('jira-url').value.trim();
      const email = document.getElementById('jira-email').value.trim();
      const token = document.getElementById('jira-token').value.trim();
      
      if (!baseUrl || !email || !token) {
        throw new Error('Please fill in all Jira fields');
      }
      
      // Test API call
      const authHeader = 'Basic ' + btoa(`${email}:${token}`);
      const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Connection failed (${response.status})`);
      }
      
      const user = await response.json();
      
      resultDiv.textContent = `✓ Connected as ${user.displayName || user.emailAddress}`;
      resultDiv.style.background = 'var(--status-on-track-bg)';
      resultDiv.style.color = 'var(--status-on-track)';
      resultDiv.classList.remove('hidden');
      
    } catch (error) {
      resultDiv.textContent = `✗ ${error.message}`;
      resultDiv.style.background = 'var(--status-off-track-bg)';
      resultDiv.style.color = 'var(--status-off-track)';
      resultDiv.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Jira connection';
    }
  });
  
  // Test Sentry connection
  document.getElementById('sentry-test-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sentry-test-btn');
    const resultDiv = document.getElementById('sentry-test-result');
    
    btn.disabled = true;
    btn.textContent = 'Testing...';
    resultDiv.classList.add('hidden');
    
    try {
      const baseUrl = document.getElementById('sentry-url').value.trim();
      const org = document.getElementById('sentry-org').value.trim();
      const token = document.getElementById('sentry-token').value.trim();
      
      if (!baseUrl || !org || !token) {
        throw new Error('Please fill in all Sentry fields');
      }
      
      // Test API call
      const response = await fetch(`${baseUrl}/api/0/organizations/${org}/`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Connection failed (${response.status})`);
      }
      
      const orgData = await response.json();
      
      resultDiv.textContent = `✓ Connected to ${orgData.name || org}`;
      resultDiv.style.background = 'var(--status-on-track-bg)';
      resultDiv.style.color = 'var(--status-on-track)';
      resultDiv.classList.remove('hidden');
      
    } catch (error) {
      resultDiv.textContent = `✗ ${error.message}`;
      resultDiv.style.background = 'var(--status-off-track-bg)';
      resultDiv.style.color = 'var(--status-off-track)';
      resultDiv.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Sentry connection';
    }
  });
  
  // Save settings
  document.getElementById('save-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-btn');
    const resultDiv = document.getElementById('save-result');
    
    btn.disabled = true;
    btn.textContent = 'Saving...';
    resultDiv.classList.add('hidden');
    
    try {
      const newSettings = {
        jira: {
          baseUrl: document.getElementById('jira-url').value.trim(),
          email: document.getElementById('jira-email').value.trim(),
          token: document.getElementById('jira-token').value.trim()
        },
        sentry: {
          baseUrl: document.getElementById('sentry-url').value.trim(),
          org: document.getElementById('sentry-org').value.trim(),
          views: collectSentryViewsFromRows(),
          token: document.getElementById('sentry-token').value.trim()
        },
        squad: {
          key: document.getElementById('squad-key').value.trim().toUpperCase(),
          name: document.getElementById('squad-name').value.trim(),
          extraBoards: document.getElementById('squad-extra-boards').value
            .split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .map(line => {
              if (line.includes('|')) {
                const [name, id] = line.split('|').map(s => s.trim());
                return { name, id: parseInt(id, 10) };
              }
              return { name: `Board ${line}`, id: parseInt(line, 10) };
            })
            .filter(b => Number.isFinite(b.id))
        },
        ui: {
          theme: document.querySelector('input[name="theme"]:checked')?.value || 'browser',
          privacyMode: settings.ui?.privacyMode || false
        },
        alerts: {
          cadenceMin: 30,
          desktopNotifications: false,
          severityFloor: 'medium'
        },
        analytics: {
          discoveredMembers: settings.analytics?.discoveredMembers || [],
          monitoredMembers: settings.analytics?.monitoredMembers || []
        }
      };
      
      await chrome.storage.local.set({ settings: newSettings });
      
      // Notify popup to reload
      chrome.runtime.sendMessage({ type: 'settings-updated' }).catch(() => {
        // Popup might not be open, ignore error
      });
      
      // Apply theme immediately
      document.documentElement.setAttribute('data-theme', newSettings.ui.theme);
      
      resultDiv.textContent = '✓ Settings saved';
      resultDiv.style.background = 'var(--status-on-track-bg)';
      resultDiv.style.color = 'var(--status-on-track)';
      resultDiv.classList.remove('hidden');
      
      // If returning from auth screen, close settings after 1s
      setTimeout(() => {
        if (!settings.jira?.token) {
          window.close();
        }
      }, 1000);
      
    } catch (error) {
      resultDiv.textContent = `✗ Save failed: ${error.message}`;
      resultDiv.style.background = 'var(--status-off-track-bg)';
      resultDiv.style.color = 'var(--status-off-track)';
      resultDiv.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save settings →';
    }
  });
  
  // Theme selection (apply immediately for preview)
  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.documentElement.setAttribute('data-theme', radio.value);
    });
  });
  
})();
