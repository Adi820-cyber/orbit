/*
 * One JSON object per line on stdout, which is what Render and Railway collect.
 * Callers pass identifiers and counts only: never a token, password, API key or
 * patient/staff name. Long strings are truncated as a last line of defence.
 */
export type Fields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
}

const MAX_FIELD_LENGTH = 300;

function clip(fields: Fields | undefined): Fields | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' && value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value]),
  );
}

export function createLogger(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`), now: () => Date = () => new Date()): Logger {
  const emit = (level: string, message: string, fields?: Fields) =>
    write(JSON.stringify({ time: now().toISOString(), level, message, ...clip(fields) }));
  return {
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
