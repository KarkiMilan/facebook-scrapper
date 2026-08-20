import { existsSync, readFileSync } from 'node:fs';
import type { Page, Request, Response } from 'playwright';
import { BrowserManager } from './browser.ts';
import type { BrowserLaunchOptions } from './browser.ts';
import { postForm } from './http.ts';
import { ResponseParser } from './parser.ts';
import { buildPayloadForm, parseGraphqlFormPayload } from './payload.ts';
import {
  compareTimestamp,
  daysDifferenceFromNow,
  findCreation,
  findFeedbackWithSubscriptionTargetId,
  getBeforeTime,
  isDateExceedLimit,
  sleep,
} from './utils.ts';
import type { CollectedPost, FormattedPost, InitPayload, ScrapeResult } from './types.ts';
import type { HttpPostResult } from './http.ts';

const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';

export interface ScraperOptions {
  fbAccount?: string;
  fbPwd?: string;
  openBrowser?: boolean;
  browserKind?: BrowserLaunchOptions['browserKind'];
  storageState?: string;
  locale?: string;
  debug?: boolean;
  /** Persistent browser profile directory (cookies accumulate across runs). */
  userDataDir?: string;
  /** Visit facebook.com once before the target page to warm the session. */
  warmUp?: boolean;
}

/**
 * Facebook GraphQL scraper — Playwright rewrite of the original
 * selenium-wire implementation.
 *
 * Strategy:
 * - No-login flow: open the profile in a real browser, dismiss the login
 *   popup, scroll to capture Facebook's initial GraphQL request (doc_id +
 *   id + cursor), then paginate https://www.facebook.com/api/graphql/
 *   directly with a plain HTTP client (like the original `requests` calls —
 *   a browser UA gets rejected with HTTP 400). This bypasses the
 *   anonymous-view login wall and can crawl the full timeline.
 * - Login flow: scroll the page and parse the GraphQL responses Facebook's
 *   own web app produces (captured via page.on('response')).
 */
export class FacebookGraphqlScraper {
  private readonly fbAccount?: string;
  private readonly fbPwd?: string;
  private readonly openBrowser: boolean;
  private readonly browserKind: BrowserLaunchOptions['browserKind'];
  private readonly storageState?: string;
  private readonly locale: string;
  private readonly debug: boolean;
  private readonly userDataDir?: string;
  private readonly warmUp: boolean;

  private browserManager: BrowserManager | null = null;
  private parser: ResponseParser = new ResponseParser();
  private graphqlRequests: Request[] = [];
  private graphqlResponses: Response[] = [];
  private initCursor: string | null = null;
  private initVariables: Record<string, unknown> | null = null;

  // stop-point state (mirrors _set_stop_point)
  private preDiffDays = Number.NEGATIVE_INFINITY;
  private countsOfSameDiffDays = 0;
  private lastCheckedResponseCreationCount = 0;
  private debugPostIds = new Set<string>();

  constructor(options: ScraperOptions = {}) {
    this.fbAccount = options.fbAccount;
    this.fbPwd = options.fbPwd;
    this.openBrowser = options.openBrowser ?? false;
    this.browserKind = options.browserKind;
    this.storageState = options.storageState;
    this.locale = options.locale ?? 'en_US';
    this.debug = options.debug ?? false;
    this.userDataDir = options.userDataDir;
    this.warmUp = options.warmUp ?? true;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  private get page(): Page {
    if (!this.browserManager?.page) throw new Error('Scraper is not initialized. Call init() first.');
    return this.browserManager.page;
  }

  async init(): Promise<void> {
    const storageState = resolveStorageState(this.storageState);
    if (this.storageState && !storageState) {
      console.warn(`Storage state file not found or invalid: ${this.storageState}`);
    }
    this.browserManager = new BrowserManager();
    await this.browserManager.launch({
      headless: !this.openBrowser,
      browserKind: this.browserKind,
      storageState,
      userDataDir: this.userDataDir,
      locale: this.locale.toLowerCase().replace('_', '-'),
    });

    this.wireNetworkListeners();

    if (this.fbAccount && this.fbPwd) {
      await this.browserManager.login(this.fbAccount, this.fbPwd);
    }
  }

  private wireNetworkListeners(): void {
    this.graphqlRequests = [];
    this.graphqlResponses = [];

    this.page.on('request', (request) => {
      if (request.url() === GRAPHQL_URL) this.graphqlRequests.push(request);
    });

    this.page.on('response', (response) => {
      if (response.url() === GRAPHQL_URL) this.graphqlResponses.push(response);
    });
  }

  async close(): Promise<void> {
    await this.browserManager?.close();
    this.browserManager = null;
  }

  // ── init payload extraction ──────────────────────────────────────────────

  /** Find the first captured GraphQL request carrying the timeline payload. */
  private getInitPayload(): InitPayload | null {
    for (const req of this.graphqlRequests) {
      if (req.url() !== GRAPHQL_URL) continue;
      const postData = req.postData();
      if (!postData) continue;
      try {
        const parsed = parseGraphqlFormPayload(postData);
        if (!parsed) continue;
        const variables = parsed.variables ?? {};
        if (variables['id'] && parsed.doc_id) {
          const cursor = typeof variables['cursor'] === 'string' ? variables['cursor'] : null;
          return { doc_id: parsed.doc_id, variables, cursor };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  // ── profile info ─────────────────────────────────────────────────────────

  private async getProfileFeed(): Promise<string[]> {
    await sleep(2000);
    const page = this.page;
    const selectors = [
      'div[data-pagelet="ProfileTilesFeed_0"]',
      'div.xieb3on',
      'div[data-pagelet^="Profile"]',
    ];
    for (const selector of selectors) {
      try {
        const text = await page.locator(selector).first().innerText({ timeout: 5000 });
        if (text) return text.split('\n').slice(2).map((line) => line.trim()).filter(Boolean);
      } catch {
        // try next selector
      }
    }
    return [];
  }

  private async getPluginPageFollowers(fbUsernameOrUserid: string): Promise<string | null> {
    const pluginUrl =
      `https://www.facebook.com/plugins/page.php?href=` +
      `https%3A%2F%2Fwww.facebook.com%2F${fbUsernameOrUserid}` +
      `&tabs=timeline&width=340&height=500&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=true&appId&locale=en_us`;
    try {
      const response = await this.browserManager!.context!.request.get(pluginUrl, {
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      const html = await response.text();
      const match = html.match(/<div class="_1drq">([\s\S]*?)<\/div>/i);
      if (match) {
        return match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      }
      const followerMatch = html.match(/(\d[\d,]*)\s*[Ff]ollowers?/);
      if (followerMatch) return followerMatch[0];
      return null;
    } catch {
      return null;
    }
  }

  private async safeProfileFeed(fbUsernameOrUserid: string): Promise<string[]> {
    let profileFeed: string[] = [];
    try {
      profileFeed = await this.getProfileFeed();
      if (profileFeed.includes('Page')) {
        const followers = await this.getPluginPageFollowers(fbUsernameOrUserid);
        if (followers) profileFeed.push(followers);
      }
    } catch {
      profileFeed = [];
    }
    return profileFeed;
  }

  // ── progress check ───────────────────────────────────────────────────────

  /** Returns true when the collected posts already go back further than `days_limit`. */
  private async checkProgress(daysLimit: number, displayProgress: boolean): Promise<boolean> {
    const tmpCreationArray: number[] = [];
    for (const response of this.graphqlResponses) {
      const bodyContent = await this.parser.getGraphqlBodyContent(response);
      if (!bodyContent) continue;
      for (const eachBody of bodyContent) {
        try {
          const jsonData = JSON.parse(eachBody);
          const data = (jsonData?.data ?? {}) as Record<string, unknown>;
          if (!data['node']) continue;
          const feedback = findFeedbackWithSubscriptionTargetId(data['node']);
          if (feedback) {
            if (this.debug) {
              const postId = (feedback as Record<string, unknown>)['subscription_target_id'];
              if (typeof postId === 'string') this.debugPostIds.add(postId);
            }
            const creationTime = findCreation(jsonData);
            if (creationTime !== null) tmpCreationArray.push(creationTime);
          }
        } catch {
          // not a post payload, skip
        }
      }
    }

    if (tmpCreationArray.length === 0) {
      if (displayProgress) console.log('No post timestamp parsed in current progress check.');
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const minAgeDays = Math.max(0, now - Math.min(...tmpCreationArray)) / 86400;
    const maxAgeDays = Math.max(0, now - Math.max(...tmpCreationArray)) / 86400;
    const deltaCreations = tmpCreationArray.length - this.lastCheckedResponseCreationCount;
    this.lastCheckedResponseCreationCount = tmpCreationArray.length;
    if (this.debug) {
      console.log(
        `[debug] check: responses=${this.graphqlResponses.length} unique_posts=${this.debugPostIds.size} ` +
          `creation_samples=${tmpCreationArray.length} delta=${deltaCreations} ` +
          `ages=[${minAgeDays.toFixed(2)}..${maxAgeDays.toFixed(2)}] days`,
      );
    }

    const diffDays = daysDifferenceFromNow(tmpCreationArray);
    if (this.preDiffDays === diffDays) {
      this.countsOfSameDiffDays += 1;
    } else {
      this.countsOfSameDiffDays = 0;
    }
    this.preDiffDays = Math.max(diffDays, this.preDiffDays);
    if (displayProgress) {
      console.log(`To access posts acquired within the past ${this.preDiffDays} days.`);
    }
    return isDateExceedLimit(diffDays, daysLimit);
  }

  // ── formatting ───────────────────────────────────────────────────────────

  private processReactions(resIn: CollectedPost[]): Record<string, number>[] {
    return resIn.map((eachRes) => {
      const reactionsIn = (eachRes.top_reactions?.edges ?? []) as Array<{
        node: { localized_name: string };
        reaction_count: number;
      }>;
      return this.parser.processReactions(reactionsIn);
    });
  }

  private formatData(
    resIn: CollectedPost[],
    fbUsernameOrUserid: string,
    newReactions: Record<string, number>[],
  ): FormattedPost[] {
    const formatted: FormattedPost[] = resIn.map((each, index) => {
      const time = index < this.parser.creationList.length ? this.parser.creationList[index] : null;
      return {
        post_id: each.post_id,
        post_url: `https://www.facebook.com/${each.post_id}`,
        username_or_userid: fbUsernameOrUserid,
        owing_profile: index < this.parser.owningProfile.length ? this.parser.owningProfile[index] : null,
        published_date: time !== null ? new Date(time * 1000).toISOString().slice(0, 19).replace('T', ' ') : null,
        published_date2: time !== null ? new Date(time * 1000).toISOString().slice(0, 10) : null,
        time,
        'reaction_count.count': each.reaction_count?.count ?? 0,
        'comment_rendering_instance.comments.total_count':
          each.comment_rendering_instance?.comments?.total_count ?? 0,
        'share_count.count': each.share_count?.count ?? 0,
        sub_reactions: newReactions[index] ?? {},
        context: index < this.parser.contextList.length ? this.parser.contextList[index] : null,
        video_view_count: each.video_view_count ?? null,
      };
    });

    // Deduplicate by post_id, keeping first occurrence (mirrors Python).
    const seen = new Set<string>();
    return formatted.filter((post) => {
      if (seen.has(post.post_id)) return false;
      seen.add(post.post_id);
      return true;
    });
  }

  // ── API request flow (no-login path) ────────────────────────────────────

  /**
   * Paginate the GraphQL timeline API directly (like the original Python
   * `requests_flow`). Returns null when the API refuses the request
   * (e.g. HTTP 400/403), so the caller can fall back to scroll capture.
   */
  private async apiFlow(
    docId: string,
    feedId: string,
    daysLimit: number,
    profileFeed: string[],
    displayProgress: boolean,
  ): Promise<ScrapeResult | null> {
    this.parser.cleanRes();
    let cursor = this.initCursor;
    let beforeTime = getBeforeTime();
    let noCreationRounds = 0;

    for (let i = 0; i < 5000; i++) {
      // Replay the exact variables Facebook's web app sent (the captured
      // doc_id may require variables that aren't in the hardcoded list).
      const variables: Record<string, unknown> = this.initVariables ?? {};
      variables['cursor'] = cursor;
      variables['beforeTime'] = beforeTime;
      const payloadForm = new URLSearchParams({
        variables: JSON.stringify(variables),
        doc_id: docId,
      }).toString();

      let response: HttpPostResult;
      try {
        response = await postForm(GRAPHQL_URL, payloadForm);
      } catch (error) {
        console.error(`GraphQL request failed: ${(error as Error).message}`);
        return null;
      }
      if (response.status !== 200) {
        console.warn(`GraphQL API returned HTTP ${response.status}; stopping API flow.`);
        return null;
      }

      const bodyContent = response.body
        .toString('utf-8')
        .split('\n')
        .filter((line) => line.trim().length > 0);
      if (this.debug) {
        console.log(
          `[debug] api round ${i}: status=${response.status} lines=${bodyContent.length} cursorLen=${cursor?.length ?? 0}`,
        );
        if (i === 0) {
          console.log('[debug] api body preview:', bodyContent[0]?.slice(0, 250));
        }
      }
      const preCreationLen = this.parser.creationList.length;
      this.parser.parseBody(bodyContent);
      const newCreationList = this.parser.creationList.slice(preCreationLen);
      const latestCreationTime = newCreationList.length > 0
        ? newCreationList[newCreationList.length - 1]
        : this.parser.creationList.length > 0
          ? this.parser.creationList[this.parser.creationList.length - 1]
          : null;

      const pageInfo = this.parser.pageInfo;
      this.parser.pageInfo = null; // reset for next round
      const hasNextPage = pageInfo ? pageInfo.hasNextPage : true;
      cursor = (pageInfo?.endCursor ?? null) ?? cursor;

      if (latestCreationTime !== null) {
        beforeTime = String(latestCreationTime);
        noCreationRounds = 0;
      } else {
        noCreationRounds += 1;
        if (displayProgress) console.log('No creation_time parsed from current graphql response; retrying next page.');
      }

      if (!hasNextPage) {
        console.log('There are no more posts.');
        break;
      }
      if (noCreationRounds >= 5) {
        console.log('Unable to parse post timestamps for multiple rounds, stop scraping early.');
        break;
      }
      if (latestCreationTime !== null && compareTimestamp(latestCreationTime, daysLimit, displayProgress)) {
        console.log(`The scraper has successfully retrieved posts from the past ${daysLimit} days.`);
        break;
      }

      await sleep(300);
    }

    const resOut = this.parser.collectPosts();
    if (resOut.length === 0) {
      console.warn('API flow returned no posts.');
    }
    const newReactions = this.processReactions(resOut);
    const finalRes = this.formatData(resOut, feedId, newReactions);
    return {
      fb_username_or_userid: feedId,
      profile: profileFeed,
      data: finalRes,
    };
  }

  // ── scroll capture flow (login path + API fallback) ─────────────────────

  private async scrollFlow(
    fbUsernameOrUserid: string,
    daysLimit: number,
    displayProgress: boolean,
    profileFeed: string[],
  ): Promise<ScrapeResult> {
    this.parser.cleanRes();
    // Scroll the page until the days limit is covered or the feed ends.
    let countsOfRound = 0;
    let checksWithoutNewResponses = 0;
    for (let i = 0; i < 1000; i++) {
      await this.browserManager!.scrollWindow();

      if (countsOfRound >= 5) {
        // Some interstitial dialogs reappear mid-scroll; try to dismiss them.
        if (i % 30 === 0) await this.browserManager!.clickRejectLoginButton();

        const walled = await this.browserManager!.isLoginWalled();
        if (walled) {
          console.log(
            'Facebook showed the login wall for this profile — anonymous viewing is limited. ' +
              'Use --fb-account/--fb-pwd or --storage-state to scrape further back.',
          );
          break;
        }

        if (displayProgress) console.log('Check spider progress..');

        // No new GraphQL responses across several checks => nothing is loading.
        const responseCountBefore = this.graphqlResponses.length;
        const exceeded = await this.checkProgress(daysLimit, displayProgress);
        if (this.graphqlResponses.length === responseCountBefore) {
          checksWithoutNewResponses += 1;
          if (checksWithoutNewResponses >= 3) {
            console.log('No new content loaded for several checks; nothing more to collect.');
            break;
          }
        } else {
          checksWithoutNewResponses = 0;
        }

        if (exceeded) {
          console.log(`The scraper has successfully retrieved posts from the past ${daysLimit} days.`);
          break;
        }
        // Same oldest-post date seen 5 times in a row -> page scrolled to the bottom.
        if (this.countsOfSameDiffDays >= 5) {
          console.log('There are no more posts.');
          break;
        }
        countsOfRound = 0;
      }
      countsOfRound += 1;
      await sleep(700);
    }

    // Collect data from the intercepted GraphQL responses.
    for (const response of this.graphqlResponses) {
      const bodyContent = await this.parser.getGraphqlBodyContent(response);
      if (bodyContent) this.parser.parseBody(bodyContent);
    }

    const resOut = this.parser.collectPosts();
    if (resOut.length === 0) {
      console.log(
        'No posts collected — the profile likely restricts anonymous viewing. ' +
          'Try --fb-account/--fb-pwd or --storage-state with a logged-in session.',
      );
    }
    const newReactions = this.processReactions(resOut);
    const finalRes = this.formatData(resOut, fbUsernameOrUserid, newReactions);
    return {
      fb_username_or_userid: fbUsernameOrUserid,
      profile: profileFeed,
      data: finalRes,
    };
  }

  // ── main entry ───────────────────────────────────────────────────────────

  async getUserPosts(
    fbUsernameOrUserid: string,
    daysLimit = 61,
    displayProgress = true,
  ): Promise<ScrapeResult> {
    // Warm up the session on the facebook.com root so FB sets base cookies
    // before we visit the profile (helps anonymous depth).
    if (this.warmUp) {
      await this.browserManager!.goto('https://www.facebook.com/', 45_000);
      await sleep(1500);
    }

    const url = `https://www.facebook.com/${fbUsernameOrUserid}?locale=${this.locale}`;
    await this.browserManager!.goto(url);

    this.parser.cleanRes();
    this.graphqlRequests = [];
    this.graphqlResponses = [];
    this.preDiffDays = Number.NEGATIVE_INFINITY;
    this.countsOfSameDiffDays = 0;
    this.lastCheckedResponseCreationCount = 0;
    this.initCursor = null;
    this.initVariables = null;

    if (!this.fbAccount) {
      // Not logged in: dismiss the login popup, then capture the initial
      // GraphQL payload (doc_id / id / cursor) from Facebook's own requests.
      await sleep(5000);
      for (let i = 0; i < 2; i++) {
        await this.browserManager!.clickRejectLoginButton();
        await sleep(2000);
      }
      await sleep(3000);

      // Trigger the initial feed request so posts start loading.
      for (let i = 0; i < 3; i++) {
        await this.browserManager!.scrollWindowBy(8000);
      }

      let initPayload: InitPayload | null = null;
      for (let i = 0; i < 60 && !initPayload; i++) {
        initPayload = this.getInitPayload();
        if (initPayload) {
          this.initCursor = initPayload.cursor;
          this.initVariables = { ...initPayload.variables };
          console.log('Collect posts without logging in.');
          break;
        }
        if (displayProgress) console.log('Wait 1 second to load page');
        await this.browserManager!.scrollWindowBy(1000);
        await sleep(1000);
      }

      if (!initPayload) {
        throw new Error(
          'Failed to extract initial graphql payload. Please retry or set openBrowser=true for diagnostics.',
        );
      }

      const userInfo = initPayload.variables as Record<string, unknown>;
      const feedId = String(userInfo['id']);
      const docId = initPayload.doc_id;
      if (this.debug) console.log(`[debug] init payload: doc_id=${docId} id=${feedId}`);

      const profileFeed = await this.safeProfileFeed(fbUsernameOrUserid);

      // Preferred path: direct API pagination (bypasses the anonymous wall).
      const apiResult = await this.apiFlow(docId, feedId, daysLimit, profileFeed, displayProgress);
      if (apiResult) return apiResult;

      // Fallback: scroll + intercept the responses Facebook's web app makes.
      console.log('Falling back to scroll-based capture.');
      return await this.scrollFlow(fbUsernameOrUserid, daysLimit, displayProgress, profileFeed);
    }

    // Logged-in path: scroll the page and parse intercepted responses.
    const profileFeed = await this.safeProfileFeed(fbUsernameOrUserid);
    return await this.scrollFlow(fbUsernameOrUserid, daysLimit, displayProgress, profileFeed);
  }
}

/** Load a Playwright storage-state JSON if present. */
export function resolveStorageState(path?: string): string | undefined {
  if (!path) return undefined;
  if (existsSync(path)) {
    JSON.parse(readFileSync(path, 'utf-8'));
    return path;
  }
  return undefined;
}