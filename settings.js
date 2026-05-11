/**
 * settings.js
 * Settings page controller
 * Manages Jira + Sentry credentials, squad selection, theme
 */

(async function() {
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
    document.getElementById('sentry-project').value = settings.sentry.project || '';
    document.getElementById('sentry-token').value = settings.sentry.token || '';
  }
  
  if (settings.squad) {
    document.getElementById('squad-key').value = settings.squad.key || '';
    document.getElementById('squad-name').value = settings.squad.name || '';
    document.getElementById('squad-board').value = settings.squad.boardId || '';
  }
  
  // Select current theme
  const theme = settings.ui?.theme || 'browser';
  document.querySelector(`input[name="theme"][value="${theme}"]`)?.click();
  
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
          project: document.getElementById('sentry-project').value.trim(),
          token: document.getElementById('sentry-token').value.trim()
        },
        squad: {
          key: document.getElementById('squad-key').value.trim().toUpperCase(),
          name: document.getElementById('squad-name').value.trim(),
          boardId: parseInt(document.getElementById('squad-board').value.trim(), 10)
        },
        ui: {
          theme: document.querySelector('input[name="theme"]:checked')?.value || 'browser',
          privacyMode: settings.ui?.privacyMode || false
        },
        alerts: {
          cadenceMin: 30,
          desktopNotifications: false,
          severityFloor: 'medium'
        }
      };
      
      await chrome.storage.local.set({ settings: newSettings });
      
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
