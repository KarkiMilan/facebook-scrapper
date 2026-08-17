import { writeFileSync } from 'node:fs';
import { FacebookGraphqlScraper } from './scraper.ts';

/**
 * Example.1 - without logging in
 * Scrapes a public Facebook page/profile and saves posts to JSON.
 */
const facebookUserOrId = ''; // e.g. RONB page
const daysLimit = 30;
const outputFile = `${facebookUserOrId}_posts.json`;

const scraper = new FacebookGraphqlScraper({ openBrowser: false });
await scraper.init();

try {
  const res = await scraper.getUserPosts(facebookUserOrId, daysLimit, true);
  console.log(`Number of posts: ${res.data.length}`);
  writeFileSync(outputFile, JSON.stringify(res, null, 4), 'utf-8');
  console.log(`Saved ${res.data.length} posts to ${outputFile}`);
} finally {
  await scraper.close();
}
