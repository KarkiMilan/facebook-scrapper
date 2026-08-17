/**
 * GraphQL request payload builders for the timeline feed.
 * Ported from utils.py `get_payload` / `get_next_payload`.
 */

export interface PayloadOptions {
  docId: string;
  id: string;
  beforeTime: string | null;
  cursor: string | null;
}

export function buildTimelineVariables(options: PayloadOptions): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    afterTime: null,
    beforeTime: options.beforeTime,
    count: 3,
    cursor: options.cursor,
    feedLocation: 'TIMELINE',
    feedbackSource: 0,
    focusCommentID: null,
    memorializedSplitTimeFilter: null,
    omitPinnedPost: true,
    postedBy: { group: 'OWNER' },
    privacy: { exclusivity: 'INCLUSIVE', filter: 'ALL' },
    privacySelectorRenderLocation: 'COMET_STREAM',
    renderLocation: 'timeline',
    scale: 3,
    stream_count: 1,
    taggedInOnly: false,
    useDefaultActor: false,
    id: options.id,
    __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
    __relay_internal__pv__IsWorkUserrelayprovider: false,
    __relay_internal__pv__IsMergQAPollsrelayprovider: false,
    __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
    __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: false,
    __relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider: false,
    __relay_internal__pv__StoriesTrayShouldShowMetadatarelayprovider: false,
    __relay_internal__pv__StoriesRingrelayprovider: false,
    __relay_internal__pv__EventCometCardImage_prefetchEventImagerelayprovider: false,
    referringStoryRenderLocation: null,
    trackingCode: null,
    __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: false,
    __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: false,
    __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
    __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider: false,
    __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
    __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
    __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
    __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
    __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: false,
    __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: false,
    __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider: false,
    __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
    __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
    __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
    __relay_internal__pv__CometUFISingleLineUFIrelayprovider: false,
    __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider: true,
    __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
    __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider: false,
    __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: false,
    __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 150,
    __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
    __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: false,
  };
  return variables;
}

/** Build the form-encoded payload body posted to https://www.facebook.com/api/graphql/. */
export function buildPayloadForm(options: PayloadOptions): Record<string, string> {
  return {
    variables: JSON.stringify(buildTimelineVariables(options)),
    doc_id: options.docId,
  };
}

/**
 * Parse a captured form-encoded GraphQL request body
 * (equivalent of parser.py `extract_first_payload`).
 */
export function parseGraphqlFormPayload(payload: string): {
  doc_id?: string;
  variables?: Record<string, unknown>;
} | null {
  const params = new URLSearchParams(payload);
  const docId = params.get('doc_id');
  const variablesRaw = params.get('variables');
  if (!docId || !variablesRaw) return null;
  try {
    const variables = JSON.parse(variablesRaw) as Record<string, unknown>;
    return { doc_id: docId, variables };
  } catch {
    return null;
  }
}