export interface FeedbackNode {
  subscription_target_id: string;
  reaction_count: { count: number };
  top_reactions: { edges: Array<{ node: { localized_name: string }; reaction_count: number }> };
  share_count: { count: number };
  comment_rendering_instance: { comments: { total_count: number } };
  video_view_count: number | null;
  [key: string]: unknown;
}

export interface OwningProfile {
  __typename?: string;
  name?: string;
  short_name?: string;
  id?: string;
  [key: string]: unknown;
}

export interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

/** Shape returned by `collect_posts()` (parser.py). */
export interface CollectedPost {
  post_id: string;
  reaction_count: { count: number };
  top_reactions: { edges: Array<{ node: { localized_name: string }; reaction_count: number }> };
  share_count: { count: number };
  comment_rendering_instance: { comments: { total_count: number } };
  video_view_count: number | null;
}

/**
 * Final output record — mirrors the original `format_data` result
 * (keys kept identical to the Python version for compatibility).
 */
export interface FormattedPost {
  post_id: string;
  post_url: string;
  username_or_userid: string;
  owing_profile: OwningProfile | null;
  published_date: string | null;
  published_date2: string | null;
  time: number | null;
  'reaction_count.count': number;
  'comment_rendering_instance.comments.total_count': number;
  'share_count.count': number;
  sub_reactions: Record<string, number>;
  context: string | null;
  video_view_count: number | null;
}

export interface ScrapeResult {
  fb_username_or_userid: string;
  profile: string[];
  data: FormattedPost[];
}

export interface InitPayload {
  doc_id: string;
  variables: Record<string, unknown>;
  cursor: string | null;
}