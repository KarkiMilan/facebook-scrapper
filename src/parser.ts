import type { Response } from 'playwright';
import {
  findFeedbackWithSubscriptionTargetId,
  findMessageText,
  findCreation,
  findOwningProfile,
  findPageInfo,
} from './utils.ts';
import type { CollectedPost, FeedbackNode, OwningProfile, PageInfo } from './types.ts';

/** Parse a raw GraphQL timeline response captured from the network / API. */
export class ResponseParser {
  resNew: unknown[] = [];
  feedbackList: FeedbackNode[] = [];
  contextList: (string | null)[] = [];
  creationList: number[] = [];
  owningProfile: (OwningProfile | null)[] = [];
  pageInfo: PageInfo | null = null;

  cleanRes(): void {
    this.resNew = [];
    this.feedbackList = [];
    this.contextList = [];
    this.creationList = [];
    this.owningProfile = [];
    this.pageInfo = null;
  }

  /** Extract the newline-separated JSON body lines of a GraphQL response (or null). */
  async getGraphqlBodyContent(response: Response): Promise<string[] | null> {
    if (response.url() !== 'https://www.facebook.com/api/graphql/') return null;
    try {
      const body = await response.body();
      return body.toString('utf-8').split('\n').filter((line) => line.trim().length > 0);
    } catch {
      return null;
    }
  }

  /** Parse every JSON line of a GraphQL body and collect feed information. */
  parseBody(bodyContent: string[]): void {
    for (const eachBody of bodyContent) {
      let jsonData: unknown;
      try {
        jsonData = JSON.parse(eachBody);
      } catch {
        continue;
      }
      this.resNew.push(jsonData);

      if (jsonData === null || typeof jsonData !== 'object') continue;
      const data = (jsonData as Record<string, unknown>)['data'];
      if (data === null || typeof data !== 'object') continue;
      const node = (data as Record<string, unknown>)['node'];
      if (node === null || typeof node !== 'object') continue;

      // Track pagination cursor across the whole body.
      const pageInfo = findPageInfo(jsonData);
      if (pageInfo && (pageInfo.hasNextPage || pageInfo.endCursor !== null)) {
        this.pageInfo = pageInfo;
      }

      const feedback = findFeedbackWithSubscriptionTargetId(node);
      if (feedback && typeof feedback === 'object') {
        this.feedbackList.push(feedback as FeedbackNode);
        this.contextList.push(findMessageText(jsonData));
        this.owningProfile.push(findOwningProfile(jsonData));
        const creationTime = findCreation(jsonData);
        if (creationTime !== null) this.creationList.push(creationTime);
      }
    }
  }

  /** Build the target post records from collected feedback. */
  collectPosts(): CollectedPost[] {
    return this.feedbackList.map((each) => ({
      post_id: each['subscription_target_id'],
      reaction_count: each['reaction_count'],
      top_reactions: each['top_reactions'],
      share_count: each['share_count'],
      comment_rendering_instance: each['comment_rendering_instance'],
      video_view_count: each['video_view_count'],
    }));
  }

  /** Map reaction edges -> { localized_name: reaction_count }. */
  processReactions(
    reactionsIn: Array<{ node: { localized_name: string }; reaction_count: number }>,
  ): Record<string, number> {
    const reactionHash: Record<string, number> = {};
    for (const eachReact of reactionsIn) {
      reactionHash[eachReact['node']['localized_name']] = eachReact['reaction_count'];
    }
    return reactionHash;
  }
}