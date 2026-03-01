import type { AppSettings, AppEventMap, LogLevel, VoiceTurnChunk } from './types';
import {
  loadSettings,
  saveSettings as persistSettings,
  exportSettingsJson,
  importSettingsJson,
  FIELD_CONFIG,
} from './settings';
import { createSessionManager } from './sessions';
import type { SessionManager } from './sessions';
import { createLogStore, buildDiagnostics } from './logs';
import { escHtml } from './utils';
import {
  createAppState,
  setGlassesConnecting,
  setGlassesConnected,
  setGlassesDisconnected,
  buildSettingsViewModel,
  buildHealthViewModel,
} from './app-wiring';
import { createSessionStore } from './persistence/session-store';
import { createConversationStore } from './persistence/conversation-store';
import type { SessionStore, ConversationStore, SearchResult } from './persistence/types';
import { createSyncBridge } from './sync/sync-bridge';
import { createSyncMonitor } from './sync/sync-monitor';
import { createDriftReconciler } from './sync/drift-reconciler';
import type { SyncBridge, SyncMonitor as SyncMonitorType, DriftReconciler as DriftReconcilerType } from './sync/sync-types';
import { createGatewayClient } from './api/gateway-client';
import type { GatewayClient } from './api/gateway-client';
import { createHubErrorPresenter } from './hub-error-presenter';
import type { HubErrorPresenter } from './hub-error-presenter';
import { computeStorageHealth, computeSyncHealth } from './health-indicator';
import type { StorageHealth } from './persistence/storage-health';
import { createEventBus } from './events';

// ── App state ────────────────────────────────────────────────

const appState = createAppState(loadSettings());
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const logStore = createLogStore();

// ── Module-level session manager ─────────────────────────────

let sessionManager: SessionManager | null = null;
let hubSyncBridge: SyncBridge | null = null;
let hubSyncMonitor: SyncMonitorType | null = null;
let hubDriftReconciler: DriftReconcilerType | null = null;
let hubConversationStore: ConversationStore | null = null;
let cachedQuota: StorageHealth | null = null;

// ── Hub event bus (Phase 18) ─────────────────────────────────

const hubBus = createEventBus<AppEventMap>();
let hubErrorPresenter: HubErrorPresenter | null = null;

// ── Hub gateway client for text turns ────────────────────────

let hubGateway: GatewayClient | null = null;
let pendingHubAssistantText = '';
let streamingMsgEl: HTMLElement | null = null;

// ── DOM helpers ──────────────────────────────────────────────

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

// ── Toast ────────────────────────────────────────────────────

function showToast(msg: string, durationMs = 2500): void {
  const container = $('toastContainer');
  $('toastText').textContent = msg;
  container.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => container.classList.add('hidden'), durationMs);
}

// ── Error banner ──────────────────────────────────────────────

function showBanner(msg: string, severity: 'warn' | 'err'): void {
  $('errorBannerText').textContent = msg;
  const banner = $('errorBanner');
  banner.className = `error-banner error-banner--${severity}`;
}

function hideBanner(): void {
  $('errorBanner').classList.add('hidden');
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

  // Phase 18.5: Storage health (RES-02, RES-18)
  if (cachedQuota) {
    const storageSnap = computeStorageHealth(
      cachedQuota.usagePercent,
      cachedQuota.usageBytes,
      cachedQuota.quotaBytes,
      cachedQuota.isPersisted,
    );
    setHealthDot('hStorageDot', storageSnap.dot);
    $('hStorageStatus').textContent = storageSnap.label;
  }

  // Phase 18: Sync health
  const stats = hubSyncMonitor?.getStats();
  const syncSnap = computeSyncHealth(
    hubSyncMonitor?.isAlive() ?? true,
    stats?.heartbeatGaps ?? 0,
    stats?.lastReceivedAt ?? 0,
  );
  setHealthDot('hSyncDot', syncSnap.dot);
  $('hSyncStatus').textContent = syncSnap.label;
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

// ── Sessions (dynamic, IndexedDB-backed) ─────────────────────

async function showSessions(): Promise<void> {
  const body = $('sessionModalBody');
  body.innerHTML = '<div class="u-type-body-base u-tc-2nd" style="padding: 16px; text-align: center;">Loading...</div>';
  $('sessionModal').classList.add('active');

  if (!sessionManager) {
    body.innerHTML = '<div class="u-type-body-base u-tc-2nd" style="padding: 16px; text-align: center;">Storage unavailable</div>';
    return;
  }

  const sessions = await sessionManager.loadSessions();
  const activeId = sessionManager.getActiveSessionId();

  let html = '<div style="display:grid; gap:6px; margin-top:8px;">';

  // "New Session" button at top
  html += '<button class="btn btn--ghost" id="newSessionBtn" style="width:100%; text-align:left;">+ New Session</button>';

  sessions.forEach((s) => {
    const active = s.id === activeId;
    html += `<div class="list-item session-item ${active ? 'is-active' : ''}" data-session-id="${escHtml(s.id)}">`;
    html += `<div class="list-item__content"><div class="list-item__title">${escHtml(s.name)}</div>`;
    html += `<div class="list-item__subtitle">${new Date(s.createdAt).toLocaleDateString()}</div></div>`;
    if (active) {
      html += '<div class="session-active-badge"><span class="status-dot status-dot--ok"></span> Active</div>';
    }
    // Rename and delete buttons
    html += `<button class="btn btn--ghost session-rename-btn" data-session-id="${escHtml(s.id)}" style="padding:4px 8px;">Rename</button>`;
    html += `<button class="btn btn--ghost session-delete-btn" data-session-id="${escHtml(s.id)}" style="padding:4px 8px; color:var(--c-error,#e53e3e);">Delete</button>`;
    html += '</div>';
  });
  html += '</div>';
  body.innerHTML = html;

  // Bind click events
  document.getElementById('newSessionBtn')?.addEventListener('click', handleNewSession);

  body.querySelectorAll('.session-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      // Don't switch if clicking rename/delete buttons
      if ((e.target as HTMLElement).closest('.session-rename-btn, .session-delete-btn')) return;
      handleSwitchSession((el as HTMLElement).dataset.sessionId!);
    });
  });

  body.querySelectorAll('.session-rename-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleRenameSession((btn as HTMLElement).dataset.sessionId!);
    });
  });

  body.querySelectorAll('.session-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleDeleteSession((btn as HTMLElement).dataset.sessionId!);
    });
  });
}

async function handleNewSession(): Promise<void> {
  if (!sessionManager) return;
  const session = await sessionManager.createSession();
  sessionManager.switchSession(session.id);
  appState.activeSession = session.id;
  closeSessionModal();
  showToast('New session created');
  addLog('info', `New session created: ${session.name}`);
  refreshHealthDisplay();
}

function handleSwitchSession(sessionId: string): void {
  if (!sessionManager) return;
  if (sessionId === sessionManager.getActiveSessionId()) {
    closeSessionModal();
    return;
  }
  sessionManager.switchSession(sessionId);
  appState.activeSession = sessionId;
  closeSessionModal();
  showToast('Session switched');
  addLog('info', 'Session switched', `sess-${Date.now()}`);
  refreshHealthDisplay();
}

async function handleRenameSession(sessionId: string): Promise<void> {
  if (!sessionManager) return;
  const newName = prompt('Enter new session name:');
  if (!newName || !newName.trim()) return;
  await sessionManager.renameSession(sessionId, newName.trim());
  showToast('Session renamed');
  addLog('info', `Session renamed to "${newName.trim()}"`);
  await showSessions(); // re-render the list
}

async function handleDeleteSession(sessionId: string): Promise<void> {
  if (!sessionManager) return;
  appState.pendingConfirm = async () => {
    await sessionManager!.deleteSession(sessionId);
    // If deleted the active session, switch to most recent
    if (sessionId === sessionManager!.getActiveSessionId()) {
      const remaining = await sessionManager!.loadSessions();
      if (remaining.length > 0) {
        sessionManager!.switchSession(remaining[0].id);
        appState.activeSession = remaining[0].id;
      }
    }
    closeConfirm();
    closeSessionModal();
    showToast('Session deleted');
    addLog('info', 'Session deleted');
    refreshHealthDisplay();
  };
  $('confirmTitle').textContent = 'Delete session?';
  $('confirmBody').textContent = 'This will permanently delete this session and all its messages.';
  $('confirmModal').classList.add('active');
}

async function refreshSessionList(): Promise<void> {
  // Only re-render if session modal is currently visible
  if ($('sessionModal').classList.contains('active')) {
    await showSessions();
  }
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

// ── Glasses connection (single stateful button) ──────────────
// States: disconnected → Connect | connecting → Connecting… | connected → Disconnect
// Reacts only to real bridge:connected / bridge:disconnected events on hubBus.
// No mock fallback in production path.

let bridgeStatusUnsub: (() => void) | null = null;

function renderGlassesButton(): void {
  const stateEl = $('gState');
  const btn = document.getElementById('glassesConnBtn') as HTMLButtonElement | null;
  const cs = appState.glassesConnectionState;

  if (cs === 'connected') {
    stateEl.innerHTML = `<span class="status-dot status-dot--ok"></span> Connected${appState.glassesDeviceName ? ' — ' + escHtml(appState.glassesDeviceName) : ''}`;
    $('gBattery').textContent = appState.glassesBattery;
    if (btn) { btn.textContent = 'Disconnect'; btn.disabled = false; btn.className = 'btn btn--ghost'; }
    return;
  }

  if (cs === 'connecting') {
    stateEl.innerHTML = '<span class="status-dot status-dot--warn"></span> Connecting\u2026';
    if (btn) { btn.textContent = 'Connecting\u2026'; btn.disabled = true; btn.className = 'btn btn--highlight'; }
    return;
  }

  // disconnected
  stateEl.innerHTML = '<span class="status-dot status-dot--off"></span> Disconnected';
  $('gBattery').textContent = '-- %';
  if (btn) { btn.textContent = 'Connect'; btn.disabled = false; btn.className = 'btn btn--highlight'; }
}

/** Try to subscribe to real bridge device-status-changed events */
function ensureBridgeStatusSubscription(): void {
  if (bridgeStatusUnsub) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bridge = (window as unknown as Record<string, any>).EvenAppBridge;
  if (!bridge || typeof bridge.onDeviceStatusChanged !== 'function') return;

  bridgeStatusUnsub = bridge.onDeviceStatusChanged((status: any) => {
    if (status?.isConnected?.()) {
      const battery = typeof status?.batteryLevel === 'number' ? `${status.batteryLevel} %` : undefined;
      setGlassesConnected(appState, addLog, 'Even G2', battery);
      renderGlassesButton();
    } else if (status?.isDisconnected?.()) {
      setGlassesDisconnected(appState, addLog, status?.connectType);
      renderGlassesButton();
    }
  });
  addLog('info', 'Subscribed to bridge device status events');
}

/** Also listen on hubBus for bridge events relayed via sync bridge */
function wireHubBusBridgeEvents(): void {
  hubBus.on('bridge:connected', ({ deviceName }) => {
    setGlassesConnected(appState, addLog, deviceName);
    renderGlassesButton();
  });
  hubBus.on('bridge:disconnected', ({ reason }) => {
    setGlassesDisconnected(appState, addLog, reason);
    renderGlassesButton();
  });
}

/** Probe real bridge for current status (one-shot) */
async function refreshBridgeStatus(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bridge = (window as unknown as Record<string, any>).EvenAppBridge;
  if (!bridge || typeof bridge.getDeviceInfo !== 'function') return false;

  try {
    const info = await bridge.getDeviceInfo();
    const status = info?.status;
    const connected = status?.isConnected?.() === true || status?.connectType === 'connected';
    if (connected) {
      const battery = typeof status?.batteryLevel === 'number' ? `${status.batteryLevel} %` : undefined;
      setGlassesConnected(appState, addLog, 'Even G2', battery);
    } else {
      setGlassesDisconnected(appState, addLog);
    }
    renderGlassesButton();
    return true;
  } catch {
    setGlassesDisconnected(appState, addLog);
    renderGlassesButton();
    return false;
  }
}

/** Handle the single button tap. Stateful: action depends on current connection state. */
async function toggleGlassesConnection(): Promise<void> {
  if (appState.glassesConnectionState === 'connecting') return; // debounce

  // ── DISCONNECT path ──
  if (appState.glassesConnectionState === 'connected') {
    setGlassesDisconnected(appState, addLog, 'user request');
    renderGlassesButton();
    showToast('Glasses disconnected');
    return;
  }

  // ── CONNECT path ──
  setGlassesConnecting(appState, addLog);
  renderGlassesButton();

  ensureBridgeStatusSubscription();
  const hasBridge = await refreshBridgeStatus();

  if (hasBridge) {
    // Real bridge handled state via refreshBridgeStatus → already rendered
    // Note: refreshBridgeStatus mutates appState, so re-read (TS narrowing doesn't track mutations)
    const currentState: string = appState.glassesConnectionState;
    if (currentState === 'connected') {
      showToast('Glasses connected');
    } else {
      showToast('Glasses not connected — check Even Hub');
      addLog('warn', 'Bridge reachable but glasses are disconnected');
    }
    return;
  }

  // ── No real bridge: hard fail (prod behavior only) ──
  setGlassesDisconnected(appState, addLog, 'bridge unavailable');
  renderGlassesButton();
  showToast('Even bridge unavailable — open in Even Hub with glasses connected');
  addLog('error', 'Connection attempt failed: EvenAppBridge unavailable');
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

const allPages = ['home', 'chat', 'health', 'settings'] as const;

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

  $('tabline').style.display = page === 'home' ? 'flex' : 'none';

  if (page === 'chat') renderHistory();
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
  document.querySelector('[data-action="sessions"]')?.addEventListener('click', () => {
    showSessions();
  });
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

  // Glasses connection (single stateful button bound to bridge events)
  document.querySelector('[data-action="toggle-glasses"]')?.addEventListener('click', () => {
    void toggleGlassesConnection();
  });
  wireHubBusBridgeEvents();
  renderGlassesButton();

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

  // Chat page: search input with 300ms debounce
  const chatSearchInput = document.getElementById('chatSearchInput') as HTMLInputElement | null;
  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        handleSearch(chatSearchInput.value.trim());
      }, 300);
    });
  }

  // Chat page: back to history button
  document.getElementById('chatBackBtn')?.addEventListener('click', () => {
    renderHistory();
  });

  // Initialize displays
  refreshSettingsDisplay();
  refreshHealthDisplay();
  renderGlassesButton();
  ensureBridgeStatusSubscription();
  void refreshBridgeStatus();
  renderLogs();
}

// ── Live conversation view ──────────────────────────────────

function appendLiveMessage(role: string, text: string): void {
  const container = $('liveConversation');
  const empty = document.getElementById('liveEmpty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function clearLiveView(): void {
  const container = $('liveConversation');
  container.innerHTML = '<div class="u-type-body-base u-tc-2nd" style="text-align: center;" id="liveEmpty">No active conversation</div>';
}

function showStreamingIndicator(): void {
  $('streamingIndicator').classList.remove('hidden');
}

function hideStreamingIndicator(): void {
  $('streamingIndicator').classList.add('hidden');
}

async function loadLiveConversation(): Promise<void> {
  if (!sessionManager || !hubConversationStore) return;
  const activeId = sessionManager.getActiveSessionId();
  if (!activeId) return;

  const messages = await hubConversationStore.getMessages(activeId);
  clearLiveView();
  for (const msg of messages) {
    appendLiveMessage(msg.role, msg.text);
  }
  hideStreamingIndicator();
}

// ── Chat history page ────────────────────────────────────

async function renderHistory(): Promise<void> {
  const historyEl = $('chatHistory');
  const historySection = $('chatHistorySection');
  const transcriptSection = $('chatTranscriptSection');
  const searchResults = $('chatSearchResults');

  // Show history, hide transcript and search
  historySection.classList.remove('hidden');
  transcriptSection.classList.add('hidden');
  searchResults.classList.add('hidden');

  // Clear search input
  const searchInput = document.getElementById('chatSearchInput') as HTMLInputElement | null;
  if (searchInput) searchInput.value = '';

  if (!sessionManager || !hubConversationStore) {
    historyEl.innerHTML = '<div class="u-type-body-base u-tc-2nd" style="padding: 16px; text-align: center;">Storage unavailable</div>';
    return;
  }

  const sessions = await sessionManager.loadSessions();

  if (sessions.length === 0) {
    historyEl.innerHTML = '<div class="u-type-body-base u-tc-2nd" style="padding: 16px; text-align: center;">No conversations yet</div>';
    return;
  }

  let html = '';
  for (const s of sessions) {
    const dateStr = new Date(s.updatedAt).toLocaleDateString();
    html += `<div class="history-item" data-conv-id="${escHtml(s.id)}">`;
    html += `<div class="history-item__body">`;
    html += `<div class="history-item__name">${escHtml(s.name)}</div>`;
    html += `<div class="history-item__meta">${dateStr}</div>`;
    html += `</div>`;
    html += `<div class="history-item__actions">`;
    html += `<button class="btn btn--ghost btn--tight history-delete-btn" data-conv-id="${escHtml(s.id)}" style="color:var(--c-error,#e53e3e); font-size:12px;">Delete</button>`;
    html += `</div>`;
    html += `</div>`;
  }
  historyEl.innerHTML = html;

  // Bind click handlers
  historyEl.querySelectorAll('.history-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.history-delete-btn')) return;
      const convId = (el as HTMLElement).dataset.convId!;
      showTranscript(convId);
    });
  });

  historyEl.querySelectorAll('.history-delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const convId = (btn as HTMLElement).dataset.convId!;
      handleDeleteFromHistory(convId);
    });
  });
}

async function showTranscript(sessionId: string): Promise<void> {
  if (!sessionManager || !hubConversationStore) return;

  const sessions = await sessionManager.loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const title = session ? session.name : 'Conversation';

  $('chatTranscriptTitle').textContent = title;

  const messages = await hubConversationStore.getMessages(sessionId);
  const transcriptEl = $('chatTranscript');

  if (messages.length === 0) {
    transcriptEl.innerHTML = '<div class="u-type-body-base u-tc-2nd" style="text-align: center;">No messages</div>';
  } else {
    transcriptEl.innerHTML = '';
    for (const msg of messages) {
      const div = document.createElement('div');
      div.className = `chat-msg chat-msg--${msg.role}`;
      div.textContent = msg.text;
      transcriptEl.appendChild(div);
    }
  }

  $('chatHistorySection').classList.add('hidden');
  $('chatSearchResults').classList.add('hidden');
  $('chatTranscriptSection').classList.remove('hidden');
}

async function handleDeleteFromHistory(sessionId: string): Promise<void> {
  if (!sessionManager) return;

  appState.pendingConfirm = async () => {
    await sessionManager!.deleteSession(sessionId);
    // If deleted the active session, switch to most recent
    if (sessionId === sessionManager!.getActiveSessionId()) {
      const remaining = await sessionManager!.loadSessions();
      if (remaining.length > 0) {
        sessionManager!.switchSession(remaining[0].id);
        appState.activeSession = remaining[0].id;
      }
      await loadLiveConversation();
    }
    closeConfirm();
    showToast('Conversation deleted');
    addLog('info', 'Conversation deleted from history');
    refreshHealthDisplay();
    await renderHistory();
  };
  $('confirmTitle').textContent = 'Delete conversation?';
  $('confirmBody').textContent = 'This will permanently delete this conversation and all its messages.';
  $('confirmModal').classList.add('active');
}

// ── Chat search ─────────────────────────────────────────

async function handleSearch(query: string): Promise<void> {
  const searchResultsSection = $('chatSearchResults');
  const historySection = $('chatHistorySection');
  const transcriptSection = $('chatTranscriptSection');
  const searchListEl = $('chatSearchList');

  if (!query) {
    searchResultsSection.classList.add('hidden');
    historySection.classList.remove('hidden');
    return;
  }

  if (!hubConversationStore) return;

  const results: SearchResult[] = await hubConversationStore.searchMessages(query, 50);

  if (results.length === 0) {
    searchListEl.innerHTML = '<div class="u-type-body-base u-tc-2nd" style="padding: 16px; text-align: center;">No matches found</div>';
  } else {
    let html = '';
    for (const r of results) {
      const dateStr = new Date(r.timestamp).toLocaleDateString();
      const roleBadge = r.role === 'user' ? 'You' : 'Assistant';
      html += `<div class="search-result" data-conv-id="${escHtml(r.conversationId)}">`;
      html += `<div class="search-result__meta">${escHtml(r.conversationName)} &middot; ${roleBadge} &middot; ${dateStr}</div>`;
      html += `<div class="search-result__snippet">${escHtml(r.snippet.before)}<span class="search-result__match">${escHtml(r.snippet.match)}</span>${escHtml(r.snippet.after)}</div>`;
      html += `</div>`;
    }
    searchListEl.innerHTML = html;
  }

  historySection.classList.add('hidden');
  transcriptSection.classList.add('hidden');
  searchResultsSection.classList.remove('hidden');

  // Bind click handlers to open transcript
  searchListEl.querySelectorAll('.search-result').forEach((el) => {
    el.addEventListener('click', () => {
      const convId = (el as HTMLElement).dataset.convId!;
      showTranscript(convId);
    });
  });
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;

// ── Hub text input ──────────────────────────────────────────

function handleHubChunk(chunk: VoiceTurnChunk): void {
  const sendBtn = document.getElementById('hubSendBtn') as HTMLButtonElement | null;

  switch (chunk.type) {
    case 'response_start': {
      showStreamingIndicator();
      if (hubSyncBridge && sessionManager) {
        const convId = sessionManager.getActiveSessionId();
        if (convId) {
          hubSyncBridge.postMessage({
            type: 'streaming:start',
            origin: 'hub',
            conversationId: convId,
          });
        }
      }
      // Create streaming assistant message div
      const container = $('liveConversation');
      const empty = document.getElementById('liveEmpty');
      if (empty) empty.remove();
      streamingMsgEl = document.createElement('div');
      streamingMsgEl.className = 'chat-msg chat-msg--assistant';
      streamingMsgEl.textContent = '';
      container.appendChild(streamingMsgEl);
      container.scrollTop = container.scrollHeight;
      break;
    }

    case 'response_delta':
      pendingHubAssistantText += chunk.text ?? '';
      if (streamingMsgEl) {
        streamingMsgEl.textContent = pendingHubAssistantText;
        const container = $('liveConversation');
        container.scrollTop = container.scrollHeight;
      }
      break;

    case 'response_end': {
      hideStreamingIndicator();
      streamingMsgEl = null;
      if (sendBtn) sendBtn.disabled = false;

      if (pendingHubAssistantText && hubConversationStore && sessionManager) {
        const convId = sessionManager.getActiveSessionId();
        const text = pendingHubAssistantText;
        pendingHubAssistantText = '';
        if (convId) {
          hubConversationStore.addMessage(convId, {
            role: 'assistant',
            text,
            timestamp: Date.now(),
          }).then(() => {
            if (hubSyncBridge) {
              hubSyncBridge.postMessage({
                type: 'message:added',
                origin: 'hub',
                conversationId: convId,
                role: 'assistant',
                text,
              });
              hubSyncBridge.postMessage({
                type: 'streaming:end',
                origin: 'hub',
                conversationId: convId,
              });
            }
          }).catch(() => {
            console.error('[hub] Failed to save assistant response');
            // Phase 18.5: Path D -- emit to hub error presenter (RES-17)
            hubBus.emit('persistence:error', { type: 'write-failed', recoverable: true, message: 'Failed to save assistant response' });
          });
        }
      } else {
        pendingHubAssistantText = '';
      }
      break;
    }

    case 'error': {
      hideStreamingIndicator();
      streamingMsgEl = null;
      if (sendBtn) sendBtn.disabled = false;

      // RES-08: Save partial hub response instead of discarding
      if (pendingHubAssistantText && hubConversationStore && sessionManager) {
        const convId = sessionManager.getActiveSessionId();
        const text = pendingHubAssistantText + ' [response interrupted]';
        pendingHubAssistantText = '';
        if (convId) {
          hubConversationStore.addMessage(convId, {
            role: 'assistant',
            text,
            timestamp: Date.now(),
          }).catch(() => {
            console.error('[hub] Failed to save partial response');
          });
        }
      } else {
        pendingHubAssistantText = '';
      }

      showToast(chunk.error ?? 'Gateway error');
      if (hubSyncBridge && sessionManager) {
        const convId = sessionManager.getActiveSessionId();
        if (convId) {
          hubSyncBridge.postMessage({
            type: 'streaming:end',
            origin: 'hub',
            conversationId: convId,
          });
        }
      }
      break;
    }
  }
}

async function handleTextSubmit(text: string): Promise<void> {
  if (!sessionManager || !hubGateway) return;
  const activeId = sessionManager.getActiveSessionId();
  if (!activeId) {
    showToast('No active session');
    return;
  }

  // Save user message to IndexedDB
  if (hubConversationStore) {
    try {
      await hubConversationStore.addMessage(activeId, {
        role: 'user',
        text,
        timestamp: Date.now(),
      });
    } catch {
      console.error('[hub] Failed to save user message');
      // Phase 18.5: Path E -- emit to hub error presenter (RES-17)
      hubBus.emit('persistence:error', { type: 'write-failed', recoverable: true, message: 'Failed to save user message' });
    }
  }

  // Sync user message to glasses
  if (hubSyncBridge) {
    hubSyncBridge.postMessage({
      type: 'message:added',
      origin: 'hub',
      conversationId: activeId,
      role: 'user',
      text,
    });
  }

  // Show in hub live view
  appendLiveMessage('user', text);

  // Send to gateway
  hubGateway.sendTextTurn(appState.settings, { sessionId: activeId, text });
}

export async function initHub(): Promise<void> {
  init();
  const persistence = await initPersistence();
  if (persistence) {
    sessionManager = persistence.sessionManager;
    hubSyncBridge = persistence.syncBridge;
    hubSyncMonitor = persistence.syncMonitor;
    hubDriftReconciler = persistence.driftReconciler;
    hubConversationStore = persistence.conversationStore;
    // Set initial active session from IndexedDB
    const activeId = sessionManager.getActiveSessionId();
    if (activeId) {
      appState.activeSession = activeId;
      refreshHealthDisplay();
    }
    // Load existing messages from IndexedDB into live view
    await loadLiveConversation();
  }

  // Phase 18: Wire hub error presenter
  hubErrorPresenter = createHubErrorPresenter({
    bus: hubBus,
    showToast,
    showBanner,
    hideBanner,
  });

  // Phase 18: Dismiss button for error banner
  $('errorBannerDismiss').addEventListener('click', () => hideBanner());

  // Phase 18: persistence:health event updates storage health row
  hubBus.on('persistence:health', (quota) => {
    const snap = computeStorageHealth(quota.usagePercent, quota.usageBytes, quota.quotaBytes, quota.isPersisted);
    setHealthDot('hStorageDot', snap.dot);
    $('hStorageStatus').textContent = snap.label;
  });

  // Phase 18.5: Emit initial quota to persistence:health subscriber (RES-02, RES-18)
  if (persistence && persistence.quota) {
    cachedQuota = persistence.quota;
    hubBus.emit('persistence:health', persistence.quota);
  }

  // Create hub gateway client for text turns
  hubGateway = createGatewayClient();
  hubGateway.onChunk(handleHubChunk);

  // Wire text input form
  const textForm = document.getElementById('hubTextForm');
  if (textForm) {
    textForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('hubTextInput') as HTMLInputElement;
      const value = input.value.trim();
      if (!value) return;
      input.value = '';
      const sendBtn = document.getElementById('hubSendBtn') as HTMLButtonElement;
      if (sendBtn) sendBtn.disabled = true;
      handleTextSubmit(value);
    });
  }

  // Clean up sync bridge and gateway on tab close
  window.addEventListener('beforeunload', () => {
    bridgeStatusUnsub?.();
    bridgeStatusUnsub = null;
    hubErrorPresenter?.destroy();
    hubDriftReconciler?.destroy();
    hubSyncMonitor?.destroy();
    hubSyncBridge?.destroy();
    hubGateway?.destroy();
  });
}

async function initPersistence(): Promise<{
  sessionManager: SessionManager;
  sessionStore: SessionStore;
  syncBridge: SyncBridge;
  conversationStore: ConversationStore;
  syncMonitor: SyncMonitorType;
  driftReconciler: DriftReconcilerType;
  quota: StorageHealth | null;
} | null> {
  try {
    const { isIndexedDBAvailable, openDB } = await import('./persistence/db');
    if (!isIndexedDBAvailable()) return null;

    const db = await openDB();
    const conversationStore = createConversationStore(db);
    const sessionStore = createSessionStore(db, conversationStore);

    // Phase 14: Dynamic imports for integrity and storage health
    const { createIntegrityChecker } = await import('./persistence/integrity-checker');
    const { createStorageHealth } = await import('./persistence/storage-health');
    const { setOnUnexpectedClose, reopenDB } = await import('./persistence/db');

    // Phase 14: Integrity check
    const integrityChecker = createIntegrityChecker(db);
    const report = await integrityChecker.check();

    // Sentinel check for eviction detection
    if (!report.sentinelPresent) {
      const hadPreviousData = localStorage.getItem('openclaw-conversation-count');
      if (hadPreviousData && report.conversationCount === 0) {
        console.warn('[hub] Storage eviction detected');
        addLog('error', 'Storage eviction detected -- previous conversations were lost');
        // Phase 18.5: Path C -- emit to hub error presenter (RES-17)
        hubBus.emit('persistence:error', { type: 'database-closed', recoverable: true, message: 'Storage eviction detected' });
      }
      await integrityChecker.writeSentinel();
    }
    try {
      localStorage.setItem('openclaw-conversation-count', String(report.conversationCount));
    } catch { /* localStorage unavailable */ }

    // Orphan grace-period lifecycle (RES-05)
    if (report.orphanedMessageIds.length > 0) {
      console.warn(`[hub] Integrity: ${report.orphanedMessageIds.length} orphaned messages`);

      try {
        const prevOrphansJson = localStorage.getItem('openclaw-orphan-ids');
        const prevDetectedAt = localStorage.getItem('openclaw-orphan-detected-at');

        if (prevOrphansJson && prevDetectedAt) {
          const elapsed = Date.now() - Number(prevDetectedAt);
          if (elapsed >= 30_000) {
            const prevOrphans: string[] = JSON.parse(prevOrphansJson);
            const staleOrphans = prevOrphans.filter(id => report.orphanedMessageIds.includes(id));
            if (staleOrphans.length > 0) {
              const cleaned = await integrityChecker.cleanupOrphans(staleOrphans);
              console.log(`[hub] Integrity: cleaned ${cleaned} stale orphaned messages`);
            }
            localStorage.removeItem('openclaw-orphan-ids');
            localStorage.removeItem('openclaw-orphan-detected-at');
          } else {
            localStorage.setItem('openclaw-orphan-ids', JSON.stringify(report.orphanedMessageIds));
          }
        } else {
          localStorage.setItem('openclaw-orphan-ids', JSON.stringify(report.orphanedMessageIds));
          localStorage.setItem('openclaw-orphan-detected-at', String(Date.now()));
        }
      } catch { /* localStorage unavailable */ }
    } else {
      try {
        localStorage.removeItem('openclaw-orphan-ids');
        localStorage.removeItem('openclaw-orphan-detected-at');
      } catch { /* localStorage unavailable */ }
    }

    // Storage health
    const storageHealth = createStorageHealth();
    const quota = await storageHealth.getQuota();
    if (quota.isAvailable) {
      if (quota.usagePercent >= 95) {
        addLog('error', `Storage critical: ${quota.usagePercent.toFixed(1)}% used`);
      } else if (quota.usagePercent >= 80) {
        addLog('warn', `Storage warning: ${quota.usagePercent.toFixed(1)}% used`);
      }
      if (!quota.isPersisted) {
        const granted = await storageHealth.requestPersistence();
        addLog('info', `Persistent storage ${granted ? 'granted' : 'denied'}`);
      }
    }

    // Hook IDB onclose
    setOnUnexpectedClose(() => {
      console.error('[hub] Database connection unexpectedly closed');
      addLog('error', 'Database connection unexpectedly closed');
      // Phase 18.5: Path A -- emit to hub error presenter (RES-17)
      hubBus.emit('persistence:error', { type: 'database-closed', recoverable: true, message: 'Database connection unexpectedly closed' });

      // Attempt to reopen the database (RES-15)
      reopenDB().then((newDb) => {
        // Recreate conversation store from fresh handle
        const newConversationStore = createConversationStore(newDb);

        // Update module-level reference used by all hub chat/search functions
        hubConversationStore = newConversationStore;

        // Phase 18.5: Recreate driftReconciler with new store (RES-11)
        hubDriftReconciler?.destroy();
        hubDriftReconciler = createDriftReconciler({
          store: newConversationStore,
          onDriftDetected: (info) => {
            console.warn(`[hub] Sync drift: local=${info.localCount} remote=${info.remoteCount}`);
          },
          onReconciled: () => {
            loadLiveConversation();
          },
        });

        // Phase 18.5: Recreate syncMonitor with new store (RES-15)
        if (hubSyncBridge) {
          hubSyncMonitor?.destroy();
          hubSyncMonitor = createSyncMonitor({
            bridge: hubSyncBridge,
            store: newConversationStore,
            origin: 'hub',
            getActiveConversationId: () => sessionManager?.getActiveSessionId() ?? '',
            onHeartbeat: (conversationId, remoteCount) => {
              hubDriftReconciler!.handleHeartbeat(conversationId, remoteCount).catch(() => {});
            },
          });
          hubSyncMonitor.startHeartbeat();
        }

        addLog('info', 'Database reconnected -- all modules refreshed');

        // Reload live conversation from fresh store
        loadLiveConversation();
      }).catch(() => {
        addLog('error', 'Database reopen failed -- restart required');
        // Phase 18.5: Path B -- emit non-recoverable error to hub error presenter (RES-17)
        hubBus.emit('persistence:error', { type: 'database-closed', recoverable: false, message: 'Failed to reopen database after max retries' });
      });
    });

    const syncBridge = createSyncBridge();

    const mgr = createSessionManager({
      sessionStore,
      syncBridge,
      origin: 'hub',
    });

    // ── Sync hardening: SyncMonitor + DriftReconciler (Phase 16) ──
    const driftReconciler = createDriftReconciler({
      store: conversationStore,
      onDriftDetected: (info) => {
        console.warn(`[hub] Sync drift: local=${info.localCount} remote=${info.remoteCount}`);
      },
      onReconciled: () => {
        // Re-read from IDB and re-render live view
        loadLiveConversation();
      },
    });

    const monitor = createSyncMonitor({
      bridge: syncBridge,
      store: conversationStore,
      origin: 'hub',
      getActiveConversationId: () => mgr.getActiveSessionId() ?? '',
      onHeartbeat: (conversationId, remoteCount) => {
        driftReconciler.handleHeartbeat(conversationId, remoteCount).catch(() => {});
      },
    });

    monitor.startHeartbeat();

    // Listen for sync messages from glasses context
    syncBridge.onMessage((msg) => {
      if (msg.origin === 'hub') return; // ignore own echoes
      // Re-render session list on any session mutation from glasses
      switch (msg.type) {
        case 'session:created':
        case 'session:renamed':
        case 'session:deleted':
        case 'conversation:named':
          // Session list shows conversation names -- refresh to show new name
          refreshSessionList();
          break;
        case 'session:switched':
          refreshSessionList();
          loadLiveConversation();
          break;
        case 'message:added':
          appendLiveMessage(msg.role, msg.text);
          if (msg.role === 'assistant') hideStreamingIndicator();
          break;
        case 'streaming:start':
          showStreamingIndicator();
          break;
        case 'streaming:end':
          hideStreamingIndicator();
          break;
      }
    });

    return { sessionManager: mgr, sessionStore, syncBridge, conversationStore, syncMonitor: monitor, driftReconciler, quota: quota.isAvailable ? quota : null };
  } catch {
    return null;
  }
}
