import { chromium, firefox, webkit } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

export type BrowserKind = 'chromium' | 'firefox' | 'webkit';

export interface BrowserLaunchOptions {
  browserKind?: BrowserKind;
  headless?: boolean;
  userAgent?: string;
  locale?: string;
  viewport?: { width: number; height: number };
  /** Path to a Playwright storage-state JSON exported from a logged-in session. */
  storageState?: string;
  /** Persistent browser profile directory (cookies accumulate across runs). */
  userDataDir?: string;
}

/**
 * Playwright replacement of base_page.py + page_optional.py.
 * Owns the browser lifecycle and shared page/context.
 */
export class BrowserManager {
  browser: Browser | null = null;
  context: BrowserContext | null = null;
  page: Page | null = null;
  persistent = false;

  async launch(options: BrowserLaunchOptions = {}): Promise<void> {
    const {
      browserKind = 'chromium',
      headless = true,
      userAgent,
      locale = 'en-US',
      viewport = { width: 1920, height: 1080 },
      storageState,
      userDataDir,
    } = options;

    const common = {
      headless,
      viewport,
      locale,
      userAgent,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-notifications',
        '--blink-settings=imagesEnabled=false',
        '--window-size=1920,1080',
      ],
    };

    if (userDataDir) {
      if (browserKind !== 'chromium') {
        throw new Error('userDataDir (persistent profile) is only supported with chromium.');
      }
      this.persistent = true;
      this.browser = null;
      this.context = await chromium.launchPersistentContext(userDataDir, common);
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
    } else {
      switch (browserKind) {
        case 'firefox':
          this.browser = await firefox.launch({ headless });
          break;
        case 'webkit':
          this.browser = await webkit.launch({ headless });
          break;
        default:
          this.browser = await chromium.launch(common);
      }
      this.context = await this.browser.newContext({
        locale,
        viewport,
        userAgent,
        storageState,
      });
      this.page = await this.context.newPage();
    }

    const stealth = () => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    };
    await this.context.addInitScript(stealth);
    await this.page.addInitScript(stealth);
  }

  async close(): Promise<void> {
    if (this.persistent) {
      await this.context?.close();
    } else {
      await this.browser?.close();
    }
    this.persistent = false;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async goto(url: string, timeoutMs = 60_000): Promise<void> {
    if (!this.page) throw new Error('BrowserManager is not launched.');
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }

  async scrollWindow(): Promise<void> {
    if (!this.page) throw new Error('BrowserManager is not launched.');
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  async scrollWindowBy(amount: number): Promise<void> {
    if (!this.page) throw new Error('BrowserManager is not launched.');
    await this.page.evaluate((offset) => window.scrollBy(0, offset), amount);
  }

  /** Dismiss the "Log in to continue" / "Not now" popup (click X icon). */
  async clickRejectLoginButton(timeoutMs = 10_000): Promise<boolean> {
    if (!this.page) throw new Error('BrowserManager is not launched.');
    const candidates = [
      '//div[@role="dialog"]//div[@aria-label="Close"]',
      '//div[@role="dialog"]//i[contains(@class,"x1i10hfl")]',
      '/html/body/div[1]/div/div[1]/div/div[5]/div/div/div[1]/div/div[2]/div/div/div/div[1]/div/i',
      '/html/body/div[2]/div/div[1]/div/div[5]/div/div/div[1]/div/div[2]/div/div/div/div[1]/div/i',
    ];
    for (const selector of candidates) {
      try {
        const locator = this.page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: timeoutMs });
        await locator.click({ timeout: timeoutMs });
        return true;
      } catch {
        // try next candidate
      }
    }
    return false;
  }

  /**
   * True when the page has been replaced by Facebook's anonymous-view login
   * wall (no feed left, nothing new can load).
   */
  async isLoginWalled(): Promise<boolean> {
    if (!this.page) throw new Error('BrowserManager is not launched.');
    return this.page.evaluate(() => {
      const dialogText = Array.from(document.querySelectorAll('[role="dialog"]'))
        .map((d) => (d as HTMLElement).innerText ?? '')
        .join('\n');
      if (
        /See more on Facebook|You must log in|Log in to continue|Something went wrong/i.test(dialogText) &&
        /(Email|phone number|Password|Log In)/i.test(dialogText)
      ) {
        return true;
      }
      const feed = document.querySelector('[role="feed"]');
      const body = document.body;
      if (feed) return false;
      if (!body) return false;
      return body.scrollHeight <= window.innerHeight + 50;
    });
  }

  /** Login flow using account credentials (fbAccount + fbPwd). */
  async login(account: string, password: string): Promise<void> {
    if (!this.page || !this.context) throw new Error('BrowserManager is not launched.');
    await this.context.clearCookies();
    await this.goto('https://www.facebook.com/login');
    await this.page.fill('input[name="email"]', account);
    await this.page.fill('input[name="pass"]', password);
    await this.page.click('button[name="login"]');
    // Wait until the login form disappears (successful login) or timeout.
    await this.page.locator('input[name="email"]').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {
      /* login may have failed, left to the caller */
    });
    const stillOnLogin = await this.page
      .locator('input[name="email"]')
      .count()
      .catch(() => 0);
    if (stillOnLogin > 0) {
      console.warn('Login may have failed — the login form is still visible. Check credentials/2FA.');
    } else {
      console.log('Login successful.');
    }
  }
}