import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ResponseParser } from '../src/parser.ts';
import { parseGraphqlFormPayload } from '../src/payload.ts';
import {
  findFeedbackWithSubscriptionTargetId,
  findMessageText,
  findCreation,
  findOwningProfile,
  findPageInfo,
} from '../src/utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'sample_graphql_response.json');
const NEW_FORMAT_PATH = join(__dirname, 'fixtures', 'new_format_response.json');
const sampleGraphqlData = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
const newFormatData = JSON.parse(readFileSync(NEW_FORMAT_PATH, 'utf-8'));

test('extract_first_payload: extracts doc_id and variables from form body', () => {
  const variables = { id: '123', count: 3, config: { count: 10, cursor: null } };
  const body = new URLSearchParams({ doc_id: '999', variables: JSON.stringify(variables) }).toString();
  const result = parseGraphqlFormPayload(body);
  assert.ok(result);
  assert.equal(result.doc_id, '999');
  assert.deepEqual(result.variables, variables);
});

test('extract_first_payload: returns null for invalid body', () => {
  assert.equal(parseGraphqlFormPayload('not-a-form'), null);
  assert.equal(parseGraphqlFormPayload('doc_id=1'), null);
  assert.equal(parseGraphqlFormPayload('doc_id=1&variables=notjson'), null);
});

test('process_reactions: maps localized names to counts', () => {
  const parser = new ResponseParser();
  const reactionsIn = [
    { node: { localized_name: '讚' }, reaction_count: 30 },
    { node: { localized_name: '哈' }, reaction_count: 12 },
  ];
  assert.deepEqual(parser.processReactions(reactionsIn), { 讚: 30, 哈: 12 });
  assert.deepEqual(parser.processReactions([]), {});
});

test('collect_posts: builds post records from feedback list', () => {
  const parser = new ResponseParser();
  const feedback = {
    subscription_target_id: '987654321',
    reaction_count: { count: 42 },
    top_reactions: { edges: [] },
    share_count: { count: 5 },
    comment_rendering_instance: { comments: { total_count: 10 } },
    video_view_count: null,
  };
  parser.feedbackList = [feedback];
  const result = parser.collectPosts();
  assert.equal(result.length, 1);
  assert.equal(result[0].post_id, '987654321');
  assert.equal(result[0].reaction_count.count, 42);
});

test('parse_body: parses fixture response into feedback/context/creation', () => {
  const parser = new ResponseParser();
  parser.cleanRes();
  parser.parseBody([JSON.stringify(sampleGraphqlData)]);
  assert.equal(parser.feedbackList.length, 1);
  assert.equal(parser.feedbackList[0].subscription_target_id, '987654321');
  assert.equal(parser.contextList[0], 'This is a test post content.');
  assert.equal(parser.creationList[0], 1700000000);
  assert.deepEqual(parser.owningProfile[0], { id: '100044253168423', name: 'Test User' });
});

test('parse_body: skips invalid lines silently', () => {
  const parser = new ResponseParser();
  parser.cleanRes();
  parser.parseBody(['not json', JSON.stringify({ data: { other_key: {} } })]);
  assert.equal(parser.feedbackList.length, 0);
});

test('parse_body: tracks page_info for pagination', () => {
  const parser = new ResponseParser();
  parser.cleanRes();
  parser.parseBody([
    JSON.stringify({
      data: {
        node: {
          timeline_feed_units: {
            page_info: { end_cursor: 'CURSOR_1', has_next_page: true },
          },
        },
      },
    }),
  ]);
  assert.deepEqual(parser.pageInfo, { endCursor: 'CURSOR_1', hasNextPage: true });
});

test('find_feedback_with_subscription_target_id: finds nested feedback', () => {
  const result = findFeedbackWithSubscriptionTargetId(sampleGraphqlData);
  assert.ok(result);
  assert.equal(result.subscription_target_id, '987654321');
});

test('find_feedback_with_subscription_target_id: returns null when absent', () => {
  assert.equal(findFeedbackWithSubscriptionTargetId({ data: { node: { id: '123' } } }), null);
  assert.equal(findFeedbackWithSubscriptionTargetId({}), null);
  assert.equal(findFeedbackWithSubscriptionTargetId([]), null);
});

test('find_message_text: finds story.message.text', () => {
  assert.equal(findMessageText(sampleGraphqlData), 'This is a test post content.');
  assert.equal(findMessageText({ data: { node: { id: '123' } } }), null);
});

test('find_creation: finds story.creation_time', () => {
  assert.equal(findCreation(sampleGraphqlData), 1700000000);
  assert.equal(findCreation({ story: { message: { text: 'x' } } }), null);
});

test('find_creation: finds direct node.creation_time (new API format)', () => {
  assert.equal(findCreation(newFormatData), 1786593850);
  assert.equal(findCreation({ data: { node: { creation_time: 123 } } }), 123);
});

test('new API format: parse_body extracts feedback/context/creation', () => {
  const parser = new ResponseParser();
  parser.cleanRes();
  parser.parseBody([JSON.stringify(newFormatData)]);
  assert.equal(parser.feedbackList.length, 1);
  const feedback = parser.feedbackList[0] as Record<string, unknown>;
  assert.equal(feedback.subscription_target_id, '1473357528159472');
  assert.equal((feedback.reaction_count as { count: number }).count, 9519);
  assert.equal(
    ((feedback.top_reactions as { edges: unknown[] }).edges as Array<{ reaction_count: number }>)[0]
      .reaction_count,
    7187,
  );
  assert.equal(
    (feedback.comment_rendering_instance as { comments: { total_count: number } }).comments.total_count,
    140,
  );
  assert.equal(parser.creationList[0], 1786593850);
  assert.ok(parser.contextList[0]?.startsWith('Good News'));
  assert.equal((parser.owningProfile[0] as { id: string }).id, '100064557167145');
});

test('find_owning_profile: finds owning profile', () => {
  const result = findOwningProfile(sampleGraphqlData);
  assert.ok(result);
  assert.equal(result.id, '100044253168423');
  assert.equal(result.name, 'Test User');
});

test('find_page_info: handles missing page info gracefully', () => {
  const result = findPageInfo({ data: { node: {} } });
  assert.ok(result === null || result.hasNextPage === false);
});