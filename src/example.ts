import { writeFileSync } from 'node:fs';
import { FacebookGraphqlScraper } from './scraper.ts';
import { scrapeBatch } from './batch.ts';
import type { BatchTarget } from './batch.ts';

/**
 * Example 1 - single target without logging in
 */
async function exampleSingle(): Promise<void> {
  const facebookUserOrId = 'RONB';
  const daysLimit = 30;
  const outputFile = `${facebookUserOrId}_posts.json`;

  const scraper = new FacebookGraphqlScraper({ openBrowser: false });
  await scraper.init();
  try {
    const res = await scraper.getUserPosts(facebookUserOrId, daysLimit, true);
    writeFileSync(outputFile, JSON.stringify(res, null, 4), 'utf-8');
    console.log(`Saved ${res.data.length} posts to ${outputFile}`);
  } finally {
    await scraper.close();
  }
}

/**
 * Example 2 - scrape multiple targets concurrently
 * Uses persistent browser profile (--user-data-dir) to avoid relaunching browsers.
 */
async function exampleBatch(): Promise<void> {
  const targets: BatchTarget[] = [
    { target: 'worldlink', days: 30, output: 'worldlink_posts.json' },
    { target: 'onlinekhabar-news', days: 30 },
    { target: 'ratopati-news', days: 30 },
    { target: 'dishhome', days: 30 },
    { target: 'techpana-news', days: 30 },
  ];
  const results = await scrapeBatch(targets, {
    concurrency: 3,
    userDataDir: process.env.HOME + '/.fb-profile',
  });
  for (const [name, result] of results) {
    if (result.error) {
      console.error(`Failed: ${name} — ${result.error}`);
    } else {
      console.log(`Success: ${name} → ${(result.data as { data: unknown[] }).data?.length ?? 0} posts`);
    }
  }
}

// Uncomment whichever you want to run:
// exampleSingle();
// exampleBatch();
