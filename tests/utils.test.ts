import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysDifferenceFromNow, isDateExceedLimit, compareTimestamp } from '../src/utils.ts';

test('days_difference_from_now: single timestamp 7 days ago', () => {
  const ts = Math.floor((Date.now() - 7 * 86_400_000) / 1000);
  assert.equal(daysDifferenceFromNow([ts]), 7);
});

test('days_difference_from_now: picks the minimum (oldest) timestamp', () => {
  const oldTs = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
  const newTs = Math.floor((Date.now() - 5 * 86_400_000) / 1000);
  assert.equal(daysDifferenceFromNow([newTs, oldTs]), 30);
});

test('days_difference_from_now: zero days for now', () => {
  const ts = Math.floor(Date.now() / 1000);
  assert.equal(daysDifferenceFromNow([ts]), 0);
});

test('is_date_exceed_limit: strict greater than', () => {
  assert.equal(isDateExceedLimit(70, 61), true);
  assert.equal(isDateExceedLimit(30, 61), false);
  assert.equal(isDateExceedLimit(61, 61), false);
});

test('compare_timestamp: respects days limit', () => {
  const fifteenDaysAgo = Math.floor((Date.now() - 15 * 86_400_000) / 1000);
  const yesterday = Math.floor((Date.now() - 86_400_000) / 1000);
  assert.equal(compareTimestamp(fifteenDaysAgo, 10, false), true);
  assert.equal(compareTimestamp(yesterday, 10, false), false);
});