import { z } from 'zod';
import { ApiError } from '../plugins/errors.ts';

/*
 * Keyset pagination cursors: the last row's sort timestamp and id, base64url
 * encoded. Opaque to clients; a malformed cursor is the caller's error.
 */

const CursorSchema = z.strictObject({ at: z.iso.datetime({ offset: true }), id: z.uuid() });
export type Cursor = z.infer<typeof CursorSchema>;

export function encodeCursor(at: unknown, id: unknown): string {
  const timestamp = at instanceof Date ? at.toISOString() : String(at);
  return Buffer.from(JSON.stringify(CursorSchema.parse({ at: timestamp, id }))).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Cursor | null {
  if (cursor === undefined) return null;
  try {
    return CursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new ApiError('invalid_request', 'The request is invalid.', 'malformed_cursor');
  }
}
