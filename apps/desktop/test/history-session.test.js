import { expect, test } from 'bun:test';
import { shouldLoadSessionHistory } from '../src/services/history-session.js';

test('stale durable checkpoint cannot consume the new history session', () => {
  const session = { documentId: 'new-document' };
  const args = { session, loadedSession: null, mode: 'local' };
  expect(shouldLoadSessionHistory({ ...args, checkpoint: { durable: true, document: { id: 'old-document' } } })).toBe(false);
  expect(shouldLoadSessionHistory({ ...args, checkpoint: { durable: true, document: { id: 'new-document' } } })).toBe(true);
});

test('history requires durability, local ownership and an unloaded session', () => {
  const session = { documentId: 'document' };
  const args = { session, loadedSession: null, mode: 'local', checkpoint: { durable: true, document: { id: 'document' } } };
  expect(shouldLoadSessionHistory({ ...args, loadedSession: session })).toBe(false);
  expect(shouldLoadSessionHistory({ ...args, mode: 'cloud' })).toBe(false);
  expect(shouldLoadSessionHistory({ ...args, checkpoint: { durable: false, document: { id: 'document' } } })).toBe(false);
  expect(shouldLoadSessionHistory({ ...args, session: null })).toBe(false);
});
