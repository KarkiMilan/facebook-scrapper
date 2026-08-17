export interface FeedbackNode {
  subscription_target_id: string;
  reaction_count: { count: number };
  top_reactions: { edges: Array<{ node: { localized_name: string }; reaction_count: number }> };
  share_count: { count: number };
  comment_rendering_instance: { comments: { total_count: number } };
  video_view_count: number | null;
}

import type { OwningProfile } from './types.ts';

/** If key `subscription_target_id` is inside a `feedback` dict, return that feedback. */
export function findFeedbackWithSubscriptionTargetId(data: unknown): any | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findFeedbackWithSubscriptionTargetId(item);
      if (result) return result;
    }
    return null;
  }
  if (data !== null && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const feedback = record['feedback'];
    if (
      feedback !== null &&
      typeof feedback === 'object' &&
      'subscription_target_id' in (feedback as Record<string, unknown>)
    ) {
      return feedback;
    }
    for (const value of Object.values(record)) {
      const result = findFeedbackWithSubscriptionTargetId(value);
      if (result) return result;
    }
  }
  return null;
}

/** Recursively find `story.message.text`. */
export function findMessageText(data: unknown): string | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findMessageText(item);
      if (result) return result;
    }
    return null;
  }
  if (data !== null && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const story = record['story'];
    if (story !== null && typeof story === 'object') {
      const storyRecord = story as Record<string, unknown>;
      const message = storyRecord['message'];
      if (message !== null && typeof message === 'object') {
        const text = (message as Record<string, unknown>)['text'];
        if (typeof text === 'string') return text;
      }
    }
    for (const value of Object.values(record)) {
      const result = findMessageText(value);
      if (result) return result;
    }
  }
  return null;
}

/** Recursively find a numeric `creation_time` (anywhere in the payload). */
export function findCreation(data: unknown): number | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findCreation(item);
      if (result) return result;
    }
    return null;
  }
  if (data !== null && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const creationTime = record['creation_time'];
    if (typeof creationTime === 'number') return creationTime;
    for (const value of Object.values(record)) {
      const result = findCreation(value);
      if (result) return result;
    }
  }
  return null;
}

/** Recursively find an `owning_profile` dict. */
export function findOwningProfile(data: unknown): OwningProfile | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findOwningProfile(item);
      if (result) return result;
    }
    return null;
  }
  if (data !== null && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const owningProfile = record['owning_profile'];
    if (owningProfile !== null && typeof owningProfile === 'object' && !Array.isArray(owningProfile)) {
      return owningProfile as OwningProfile;
    }
    for (const value of Object.values(record)) {
      const result = findOwningProfile(value);
      if (result) return result;
    }
  }
  return null;
}

export interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

/**
 * Find `page_info` in a GraphQL body. The location varies between
 * `data.page_info` (older API) and `data.node.timeline_feed_units.page_info`,
 * so we scan recursively for the first object exposing `has_next_page`.
 */
export function findPageInfo(data: unknown): PageInfo | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findPageInfo(item);
      if (result) return result;
    }
    return null;
  }
  if (data !== null && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if ('has_next_page' in record) {
      return {
        endCursor: typeof record['end_cursor'] === 'string' ? (record['end_cursor'] as string) : null,
        hasNextPage: Boolean(record['has_next_page']),
      };
    }
    for (const value of Object.values(record)) {
      const result = findPageInfo(value);
      if (result) return result;
    }
  }
  return null;
}

/** Difference in days between now and the oldest timestamp in the list. */
export function daysDifferenceFromNow(timestamps: number[]): number {
  const timestamp = Math.min(...timestamps);
  const dateTime = new Date(timestamp * 1000);
  const now = new Date();
  return Math.floor((now.getTime() - dateTime.getTime()) / 86_400_000);
}

export function isDateExceedLimit(maxDaysAgo: number, daysLimit: number): boolean {
  return maxDaysAgo > daysLimit;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Unix timestamp (seconds) for now, matching Facebook's `beforeTime` convention. */
export function getBeforeTime(): string {
  return String(Math.floor(Date.now() / 1000));
}

/**
 * Compare a publication timestamp against `days_limit`.
 * Returns true when the timestamp is older than the limit.
 */
export function compareTimestamp(timestamp: number, daysLimit: number, displayProgress: boolean): boolean {
  const timestampDate = new Date(timestamp * 1000);
  const currentDate = new Date();
  const pastDate = new Date(currentDate.getTime() - daysLimit * 86_400_000);
  if (displayProgress) {
    const daysRemaining = Math.floor((timestampDate.getTime() - pastDate.getTime()) / 86_400_000);
    if (daysRemaining > 0) {
      console.log(`${daysRemaining} more days of posts to collect.`);
    } else {
      console.log('Target days reached or exceeded.');
    }
  }
  return timestampDate.getTime() < pastDate.getTime();
}