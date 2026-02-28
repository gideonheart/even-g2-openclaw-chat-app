import type { AppSettings, LogLevel } from './types';
import {
  loadSettings,
  saveSettings as persistSettings,
  exportSettingsJson,
  importSettingsJson,
  FIELD_CONFIG,
} from './settings';
import { SESSIONS, findSession, isActiveSession } from './sessions';
import { createLogStore, buildDiagnostics } from './logs';
import { escHtml } from './utils';
import {
  createAppState,
  connectGlasses as connectGlassesPure,
  disconnectGlasses as disconnectGlassesPure,
  buildSettingsViewModel,
  buildHealthViewModel,
} from './app-wiring';

// ── App state ────────────────────────────────────────────────

const appState = createAppState(loadSettings());
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const logStore = createLogStore();

// ── DOM helpers ──────────────────────────────────────────────

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

// ── Toast ────────────────────────────────────────────────────

function showToast(msg: string): void {
  const container = $('toastContainer');
  $('toastText').textContent = msg;
  container.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => container.classList.add('hidden'), 2500);
}

// ── Logs ─────────────────────────────────────────────────────

function renderLogs(): void {
  const list = $('logList');
  const filtered = logStore.filter(appState.currentLogFilter);
  if (filtered.length === 0) {
    list.innerHTML =
      '<div class="u-type-body-base u-tc-2nd" style="padding: 16px; text-align: center;">No log entries.</div>';
    return;
  }
  list.innerHTML = filtered
    .map((l) => {
      const time = l.time.toLocaleTimeString('en-US', { hour12: false });
      return `<div class="log-entry">
        <div class="log-entry__header">
          <span class="log-entry__level log-entry__level--${l.level}">${l.level}</span>
          <span class="log-entry__time">${time}</span>
        </div>
        <div class="log-entry__msg">${escHtml(l.msg)}</div>
        ${l.cid ? `<div class="log-entry__cid">cid: ${escHtml(l.cid)}</div>` : ''}
      </div>`;
    })
    .join('');
}

function addLog(level: LogLevel, msg: string, cid: string | null = null): void {
  logStore.add(level, msg, cid);
  renderLogs();
}

// ── Settings display ─────────────────────────────────────────

function refreshSettingsDisplay(): void {
  const vm = buildSettingsViewModel(appState.settings);
  $('settGatewayDisplay').textContent = vm.gatewayDisplay;
  $('settKeyDisplay').textContent = vm.sessionKeyDisplay;
  $('settSttDisplay').textContent = vm.sttDisplay;
  $('settApiKeyDisplay').textContent = vm.apiKeyDisplay;
  $('sttDisplay').textContent = vm.sttDisplay;
}

function refreshHealthDisplay(): void {
  const vm = buildHealthViewModel(appState.settings, appState.activeSession);

  setHealthDot('hGatewayDot', vm.gateway.dot);
  $('hGatewayStatus').textContent = vm.gateway.label;

  setHealthDot('hSttDot', vm.stt.dot);
  $('hSttStatus').textContent = vm.stt.label;

  setHealthDot('hSessionDot', vm.session.dot);
  $('hSessionStatus').textContent = vm.session.label;
}

function setHealthDot(id: string, state: string): void {
  $(id).className = `status-dot status-dot--${state}`;
}

// ── Settings edit form ───────────────────────────────────────

function openSettingsField(fieldId: string): void {
  show('settings');
  appState.currentEditField = fieldId;
  const config = FIELD_CONFIG[fieldId];
  if (!config) return;

  $('settingsList').classList.remove('active');
  $('settingsEdit').classList.add('active');

  const container = $('settingsFormContainer');
  let html = `<div class="u-text-title-base" style="margin-bottom: 4px;">${config.label}</div>`;
  html += `<div class="u-type-body-base u-tc-2nd" style="margin-bottom: var(--space-item);">${config.help}</div>`;

  if (config.type === 'select') {
    html += `<div class="field"><select class="input" id="fieldInput">`;
    config.options?.forEach((opt) => {
      const sel =
        appState.settings[fieldId as keyof AppSettings] === opt.value ? 'selected' : '';
      html += `<option value="${opt.value}" ${sel}>${opt.label}</option>`;
    });
    html += `</select></div>`;
  } else {
    const inputType = config.secret ? 'password' : 'text';
    const value = (appState.settings[fieldId as keyof AppSettings] as string) || '';
    html += `<div class="field"><div class="field-row">`;
    html += `<div class="field" style="flex:1;"><input class="input" type="${inputType}" id="fieldInput" value="${escHtml(value)}" placeholder="${config.placeholder || ''}" autocomplete="off" /></div>`;
    if (config.secret) {
      html += `<button class="eye-btn" id="eyeBtn" type="button">\uD83D\uDC41</button>`;
    }
    html += `</div><div class="field__error" id="fieldError"></div></div>`;
  }

  html += `<div class="btn-row">`;
  html += `<button class="btn btn--highlight" id="saveFieldBtn">Save</button>`;
  html += `<button class="btn btn--ghost" id="cancelFieldBtn">Cancel</button>`;
  html += `</div>`;

  container.innerHTML = html;

  // Bind events
  $('saveFieldBtn').addEventListener('click', saveField);
  $('cancelFieldBtn').addEventListener('click', closeSettingsEdit);
  const eyeBtn = document.getElementById('eyeBtn');
  if (eyeBtn) eyeBtn.addEventListener('click', toggleFieldVisibility);

  setTimeout(() => {
    const input = document.getElementById('fieldInput') as HTMLInputElement | null;
    if (input) input.focus();
  }, 100);
}

function toggleFieldVisibility(): void {
  const input = document.getElementById('fieldInput') as HTMLInputElement;
  const btn = document.getElementById('eyeBtn')!;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '\uD83D\uDD12';
  } else {
    input.type = 'password';
    btn.textContent = '\uD83D\uDC41';
  }
}

function saveField(): void {
  if (!appState.currentEditField) return;
  const config = FIELD_CONFIG[appState.currentEditField];
  const input = document.getElementById('fieldInput') as HTMLInputElement;
  const value = input.value.trim();

  const error = config.validate(value);
  if (error) {
    const errEl = document.getElementById('fieldError');
    if (errEl) errEl.textContent = error;
    return;
  }

  (appState.settings as unknown as Record<string, string>)[appState.currentEditField] = value;
  persistSettings(appState.settings);
  refreshSettingsDisplay();
  refreshHealthDisplay();
  addLog('info', 'Settings saved');
  closeSettingsEdit();
  showToast(`${config.label} updated`);
}

function closeSettingsEdit(): void {
  appState.currentEditField = null;
  $('settingsList').classList.add('active');
  $('settingsEdit').classList.remove('active');
}

// ── Export / import ──────────────────────────────────────────

function exportSettingsAction(): void {
  const json = exportSettingsJson(appState.settings);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'even-openclaw-settings.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Settings exported (secrets excluded)');
  addLog('info', 'Settings exported');
}

function importSettingsAction(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      appState.settings = importSettingsJson(e.target!.result as string, appState.settings);
      persistSettings(appState.settings);
      refreshSettingsDisplay();
      refreshHealthDisplay();
      showToast('Settings imported');
      addLog('info', 'Settings imported from file');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast('Import failed: invalid JSON');
      addLog('error', 'Settings import failed: ' + msg);
    }
  };
  reader.readAsText(file);
  (event.target as HTMLInputElement).value = '';
}

// ── Sessions ─────────────────────────────────────────────────

function showSessions(): void {
  const body = $('sessionModalBody');
  let html = '<div style="display:grid; gap:6px; margin-top:8px;">';
  SESSIONS.forEach((s) => {
    const active = isActiveSession(s.id, appState.activeSession);
    html += `<div class="list-item session-item ${active ? 'is-active' : ''}" data-session-id="${s.id}">`;
    html += `<div class="list-item__content"><div class="list-item__title">${s.name}</div>`;
    html += `<div class="list-item__subtitle">${s.desc}</div></div>`;
    if (active) {
      html += `<div class="session-active-badge"><span class="status-dot status-dot--ok"></span> Active</div>`;
    }
    html += `</div>`;
  });
  html += '</div>';
  body.innerHTML = html;

  // Bind click events
  body.querySelectorAll('.session-item').forEach((el) => {
    el.addEventListener('click', () => {
      switchSession((el as HTMLElement).dataset.sessionId!);
    });
  });

  $('sessionModal').classList.add('active');
}

function switchSession(sessionId: string): void {
  if (sessionId === appState.activeSession) {
    closeSessionModal();
    return;
  }
  const session = findSession(sessionId);
  if (!session) return;

  appState.pendingConfirm = () => {
    appState.activeSession = sessionId;
    $('activeSessionDisplay').textContent = session.name.toLowerCase();
    closeSessionModal();
    closeConfirm();
    showToast(`Switched to ${session.name}`);
    addLog('info', `Session switched to ${session.name}`, `sess-${Date.now()}`);
    refreshHealthDisplay();
  };
  closeSessionModal();
  $('confirmTitle').textContent = 'Switch session?';
  $('confirmBody').textContent = `Switch from current session to "${session.name}" (${session.desc})?`;
  $('confirmModal').classList.add('active');
}

function closeSessionModal(): void {
  $('sessionModal').classList.remove('active');
}

function confirmAction(): void {
  if (appState.pendingConfirm) appState.pendingConfirm();
  appState.pendingConfirm = null;
}

function closeConfirm(): void {
  $('confirmModal').classList.remove('active');
  appState.pendingConfirm = null;
}

// ── Glasses connection (mock) ────────────────────────────────

function connectGlasses(): void {
  const result = connectGlassesPure(appState, addLog);
  $('gState').innerHTML =
    '<span class="status-dot status-dot--ok"></span> Connected';
  $('gBattery').textContent = result.battery;
  showToast('Glasses connected');
}

function disconnectGlasses(): void {
  const result = disconnectGlassesPure(appState, addLog);
  $('gState').innerHTML =
    '<span class="status-dot status-dot--off"></span> Disconnected';
  $('gBattery').textContent = result.battery;
}

// ── Simulator launch ─────────────────────────────────────────

function launchSimulator(): void {
  const params = new URLSearchParams({
    session: appState.activeSession,
    connected: appState.glassesConnected ? '1' : '0',
  });
  window.open(`./preview-glasses.html?${params.toString()}`, '_blank');
  addLog('info', 'Simulator opened');
}

// ── Navigation ───────────────────────────────────────────────

const allPages = ['home', 'features', 'health', 'settings'] as const;

function show(page: string): void {
  if (page !== 'settings') closeSettingsEdit();
  allPages.forEach((p) => document.getElementById(p)!.classList.remove('active'));
  document.getElementById(page)!.classList.add('active');

  document.querySelectorAll('#bottomNav button').forEach((n) => {
    const btn = n as HTMLElement;
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  document.querySelectorAll('#tabline .tab').forEach((t) => {
    const tab = t as HTMLElement;
    tab.classList.toggle('is-active', tab.dataset.tab === page);
  });

  $('tabline').style.display =
    page === 'home' || page === 'features' ? 'flex' : 'none';
}

// ── Diagnostics copy ─────────────────────────────────────────

function copyDiagnostics(): void {
  const diag = buildDiagnostics(logStore, appState.activeSession, appState.glassesConnected, appState.settings);
  navigator.clipboard
    .writeText(JSON.stringify(diag, null, 2))
    .then(() => showToast('Diagnostics copied to clipboard'))
    .catch(() => showToast('Failed to copy \u2014 check permissions'));
}

// ── Log filters ──────────────────────────────────────────────

function filterLogs(level: LogLevel | 'all', btn: HTMLElement): void {
  appState.currentLogFilter = level;
  document
    .querySelectorAll('.log-filter')
    .forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderLogs();
}

// ── Wire up DOM events ───────────────────────────────────────

function init(): void {
  // Seed demo logs
  addLog('info', 'App initialized');
  addLog('info', 'Settings loaded from localStorage');
  if (!appState.settings.gatewayUrl) {
    addLog('warn', 'Gateway URL not configured');
  }

  // Bottom nav
  document.querySelectorAll('#bottomNav button').forEach((n) => {
    n.addEventListener('click', () => show((n as HTMLElement).dataset.page!));
  });

  // Tab line
  document.querySelectorAll('#tabline .tab').forEach((t) => {
    t.addEventListener('click', () => show((t as HTMLElement).dataset.tab!));
  });

  // Quick actions on home
  document.querySelector('[data-action="sessions"]')?.addEventListener('click', showSessions);
  document.querySelector('[data-action="stt"]')?.addEventListener('click', () => {
    show('settings');
    openSettingsField('sttProvider');
  });
  document.querySelector('[data-action="simulator"]')?.addEventListener('click', launchSimulator);

  // Settings list items
  document.querySelectorAll('[data-setting]').forEach((el) => {
    el.addEventListener('click', () => {
      openSettingsField((el as HTMLElement).dataset.setting!);
    });
  });

  // Export / import buttons
  document.querySelector('[data-action="export-settings"]')?.addEventListener('click', exportSettingsAction);
  const importFile = document.getElementById('importFile') as HTMLInputElement;
  importFile?.addEventListener('change', importSettingsAction);
  document.querySelector('[data-action="import-settings"]')?.addEventListener('click', () => importFile.click());

  // Glasses connect/disconnect
  document.querySelector('[data-action="connect"]')?.addEventListener('click', connectGlasses);
  document.querySelector('[data-action="disconnect"]')?.addEventListener('click', disconnectGlasses);

  // Session modal cancel
  document.querySelector('[data-action="close-session-modal"]')?.addEventListener('click', closeSessionModal);

  // Confirm modal
  $('confirmOk').addEventListener('click', confirmAction);
  document.querySelector('[data-action="close-confirm"]')?.addEventListener('click', closeConfirm);

  // Log filters
  document.querySelectorAll('.log-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterLogs(
        (btn as HTMLElement).dataset.level as LogLevel | 'all',
        btn as HTMLElement,
      );
    });
  });

  // Copy diagnostics
  document.querySelector('[data-action="copy-diagnostics"]')?.addEventListener('click', copyDiagnostics);

  // Initialize displays
  refreshSettingsDisplay();
  refreshHealthDisplay();
  renderLogs();
}

// Boot
init();
