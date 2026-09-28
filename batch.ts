import { writeFileSync, readFileSync } from 'node:fs';
import { FacebookGraphqlScraper } from './scraper.ts';

export interface BatchTarget {
  target: string;
  days?: number;
  output?: string;
}

interface BatchOptions {
  concurrency?: number;
  fbAccount?: string;
  fbPwd?: string;
  browserKind?: 'chromium' | 'firefox' | 'webkit';
  storageState?: string;
  locale?: string;
  debug?: boolean;
  userDataDir?: string;
  warmUp?: boolean;
}

interface ScrapeResult {
  fb_username_or_userid: string;
  profile: string[];
  data: unknown[];
}

/**
 * Scrape multiple Facebook pages concurrently with a concurrency limit.
 *
 * CLI usage:
 *   node src/batch.ts --concurrency 3 --user-data-dir ~/.fb-profile target1 target2 target3
 *   node src/batch.ts --targets-file targets.json --user-data-dir ~/.fb-profile
 */
export async function scrapeBatch(
  targets: BatchTarget[],
  options: BatchOptions = {},
): Promise<Map<string, { data: ScrapeResult | null; error?: string }>> {
  const concurrency = options.concurrency ?? 3;
  const results = new Map<string, { data: ScrapeResult | null; error?: string }>();

  const queue = [...targets];
  let active = 0;

  const runNext = async (): Promise<void> => {
    const target = queue.shift();
    if (!target) return;
    active++;
    const outputFile = target.output ?? `${target.target}_posts.json`;
    console.log(`[${active}/${targets.length}] Starting: ${target.target} (${target.days ?? 61}d)`);
    try {
      const scraper = new FacebookGraphqlScraper({
        fbAccount: options.fbAccount,
        fbPwd: options.fbPwd,
        browserKind: options.browserKind,
        storageState: options.storageState,
        locale: options.locale ?? 'en_US',
        debug: options.debug ?? false,
        userDataDir: options.userDataDir,
        warmUp: options.warmUp ?? true,
      });
      await scraper.init();
      try {
        const result = await scraper.getUserPosts(target.target, target.days ?? 61, true);
        writeFileSync(outputFile, JSON.stringify(result, null, 4), 'utf-8');
        results.set(target.target, { data: result, error: undefined });
        console.log(`[${active}/${targets.length}] Done: ${target.target} → ${result.data.length} posts`);
      } finally {
        await scraper.close();
      }
    } catch (err) {
      results.set(target.target, { data: null, error: (err as Error).message });
      console.error(`[${active}/${targets.length}] FAILED: ${target.target} — ${(err as Error).message}`);
    }
    active--;
    await runNext();
  };

  const starters = Array.from({ length: Math.min(concurrency, targets.length) }, () => runNext());
  await Promise.all(starters);

  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opts: BatchOptions = { concurrency: 3 };
  const targets: BatchTarget[] = [];
  let targetsFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--concurrency':
        opts.concurrency = parseInt(args[++i] ?? '3', 10);
        break;
      case '--fb-account':
        opts.fbAccount = args[++i] ?? '';
        break;
      case '--fb-pwd':
        opts.fbPwd = args[++i] ?? '';
        break;
      case '--browser':
        opts.browserKind = args[++i] as BatchOptions['browserKind'];
        break;
      case '--storage-state':
        opts.storageState = args[++i];
        break;
      case '--locale':
        opts.locale = args[++i] ?? 'en_US';
        break;
      case '--debug':
        opts.debug = true;
        break;
      case '--user-data-dir':
        opts.userDataDir = args[++i];
        break;
      case '--no-warm-up':
        opts.warmUp = false;
        break;
      case '--targets-file':
        targetsFile = args[++i];
        break;
      default:
        if (!arg.startsWith('-')) targets.push({ target: arg });
        break;
    }
  }

  let finalTargets: BatchTarget[];

  if (targetsFile) {
    try {
      const fileTargets = JSON.parse(readFileSync(targetsFile, 'utf-8')) as BatchTarget[];
      finalTargets = fileTargets;
    } catch (err) {
      console.error(`Failed to read targets file: ${(err as Error).message}`);
      process.exit(1);
    }
  } else if (targets.length > 0) {
    finalTargets = targets;
  } else {
    console.error('No targets provided. Pass target usernames as args or use --targets-file.');
    process.exit(1);
  }

  const results = await scrapeBatch(finalTargets, opts);
  const failed = [...results.entries()].filter(([, r]) => r.error);
  const succeeded = results.size - failed.length;
  console.log(`\nDone: ${succeeded}/${results.size} succeeded`);
  if (failed.length > 0) {
    console.log(`${failed.length} FAILED:`);
    failed.forEach(([name, r]) => console.log(`  - ${name}: ${r?.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Batch scraping failed: ${(err as Error).message}`);
  process.exit(1);
});
