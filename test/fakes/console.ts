// Records what the library writes to the console instead of printing it. CaptivateChatAPI
// keeps its own copy of console's methods when its module loads, so importing this file
// replaces them first: import it before anything from src. TEST_LOGS=1 prints them too.

export interface Logged {
  level: 'log' | 'warn' | 'error';
  text: string;
}

export const logged: Logged[] = [];

const print = { log: console.log, warn: console.warn, error: console.error };

function asText(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (_) {
    return String(value);
  }
}

for (const level of ['log', 'warn', 'error'] as const) {
  console[level] = (...args: unknown[]) => {
    logged.push({ level, text: args.map(asText).join(' ') });
    if (process.env.TEST_LOGS) print[level](...args);
  };
}

/** The lines logged at a level since the last clear. */
export function linesAt(level: Logged['level']): string[] {
  return logged.filter((l) => l.level === level).map((l) => l.text);
}

export function clearLogs(): void {
  logged.length = 0;
}
