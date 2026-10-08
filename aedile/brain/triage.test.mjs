// triage.test.mjs -- triage.mjs's pure rules: audience, dedup, history, the Log window.
//
//   node --test aedile/brain/triage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmail, audienceOf, pending, stripQuoted, historyBlock, threadBlock, logCoversWindow } from './triage.mjs';

test('the address is the last bracketed group, not one planted in a display name', () => {
  assert.equal(extractEmail('"A <boss@allowed.example>" <real@sender.example>'), 'real@sender.example');
  assert.equal(extractEmail('Plain@Sender.Example'), 'plain@sender.example');
});

test('three or fewer distinct recipients is a dm, more is the list', () => {
  assert.equal(audienceOf({ to: 'a@x.example, B <b@x.example>', cc: 'a@x.example' }), 'dm');
  assert.equal(audienceOf({ to: 'a@x.example,b@x.example', cc: 'c@x.example,d@x.example' }), 'list');
  assert.equal(audienceOf({ to: 'a@x.example', cc: '' }), 'dm');
});

test('only unread messages with no Log row are pending', () => {
  const messages = [
    { messageId: 'm1', unread: false }, { messageId: 'm2', unread: true }, { messageId: 'm3', unread: true },
  ];
  assert.deepEqual(pending(messages, new Set(['m2'])).map(m => m.messageId), ['m3']);
});

test('quoted replies leave the history', () => {
  assert.equal(stripQuoted('I will be there\n\n> earlier line\n\nOn Sat, Sep 27, 2026 at 9:28 AM Someone wrote:\nall of it again'), 'I will be there');
});

test('history keeps the window, oldest first', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  const block = historyBlock([
    { date_iso: '2026-09-27T09:28:00-05:00', author: 'b', subject: 'second', body: 'two' },
    { date_iso: '2025-01-01T00:00:00-05:00', author: 'x', subject: 'too old', body: 'zero' },
    { date_iso: '2026-03-01T00:00:00-05:00', author: 'a', subject: 'first', body: 'one' },
    { author: 'legacy', body: 'no date' },
  ], now);
  assert.ok(block.indexOf('first') < block.indexOf('second'));
  assert.ok(!block.includes('too old') && !block.includes('no date'));
});

test('exactly one message is marked as under review', () => {
  const messages = [{ messageId: 'm1', from: 'a@x.example', body: 'one' }, { messageId: 'm2', from: 'b@x.example', body: 'two' }];
  const block = threadBlock(messages, messages[1]);
  assert.equal(block.match(/under review/g).length, 1);
  assert.ok(block.indexOf('under review') > block.indexOf('one'));
});

test('a full page of Log rows must reach back past the scan window', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  const page = oldest => Array.from({ length: 500 }, () => ({ Timestamp: oldest }));
  assert.equal(logCoversWindow([{ Timestamp: '2026-10-06T00:00:00Z' }], now), true);
  assert.equal(logCoversWindow(page('2026-09-01T00:00:00Z'), now), true);
  assert.equal(logCoversWindow(page('2026-10-01T00:00:00Z'), now), false);
});
