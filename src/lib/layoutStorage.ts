const LAYOUT_PREFIX = 'codex-layout-';

export interface LayoutState {
  lastActiveTabId?: string;
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  logPanelOpen?: boolean;
  logsWidth?: number;
  previewWidth?: number;
  terminalHeight?: number;
}

export function getLayoutKey(environmentId: string): string {
  return LAYOUT_PREFIX + environmentId;
}

export function loadLayout(environmentId: string): LayoutState {
  try {
    const raw = localStorage.getItem(getLayoutKey(environmentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      lastActiveTabId: typeof parsed.lastActiveTabId === 'string' ? parsed.lastActiveTabId : undefined,
      sidebarOpen: typeof parsed.sidebarOpen === 'boolean' ? parsed.sidebarOpen : undefined,
      sidebarWidth: typeof parsed.sidebarWidth === 'number' ? parsed.sidebarWidth : undefined,
      logPanelOpen: typeof parsed.logPanelOpen === 'boolean' ? parsed.logPanelOpen : undefined,
      logsWidth: typeof parsed.logsWidth === 'number' ? parsed.logsWidth : undefined,
      previewWidth: typeof parsed.previewWidth === 'number' ? parsed.previewWidth : undefined,
      terminalHeight: typeof parsed.terminalHeight === 'number' ? parsed.terminalHeight : undefined,
    };
  } catch {
    return {};
  }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 150;

export function saveLayout(environmentId: string, patch: Partial<LayoutState>, debounce = false): void {
  const doSave = () => {
    const current = loadLayout(environmentId);
    const next: LayoutState = { ...current, ...patch };
    try {
      localStorage.setItem(getLayoutKey(environmentId), JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  if (debounce) {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(doSave, SAVE_DEBOUNCE_MS);
  } else {
    doSave();
  }
}
