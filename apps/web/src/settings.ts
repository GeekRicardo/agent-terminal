export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  themeId: string;
}

export const defaultFontFamily = "'MapleMonoNFLocal', 'Maple Mono NF CN', Menlo, Monaco, Consolas, monospace";

export const defaultTerminalSettings: TerminalSettings = {
  fontFamily: defaultFontFamily,
  fontSize: 13,
  themeId: 'default-dark',
};

const storageKey = 'pty-terminal.settings.v1';

export function loadTerminalSettings(): TerminalSettings {
  const stored = localStorage.getItem(storageKey);
  if (!stored) {
    return defaultTerminalSettings;
  }

  try {
    return normalizeTerminalSettings(JSON.parse(stored));
  } catch {
    return defaultTerminalSettings;
  }
}

export function saveTerminalSettings(settings: TerminalSettings): void {
  localStorage.setItem(storageKey, JSON.stringify(normalizeTerminalSettings(settings)));
}

export function normalizeTerminalSettings(value: Partial<TerminalSettings>): TerminalSettings {
  return {
    fontFamily: normalizeFontFamily(value.fontFamily),
    fontSize: clamp(Number(value.fontSize) || defaultTerminalSettings.fontSize, 9, 28),
    themeId: typeof value.themeId === 'string' && value.themeId ? value.themeId : defaultTerminalSettings.themeId,
  };
}

function normalizeFontFamily(fontFamily: unknown): string {
  if (typeof fontFamily !== 'string' || !fontFamily.trim()) {
    return defaultFontFamily;
  }

  const trimmed = fontFamily.trim();
  const hasMapleLocal = /MapleMonoNFLocal/i.test(trimmed);
  return hasMapleLocal ? trimmed : `'MapleMonoNFLocal', ${trimmed}, monospace`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
