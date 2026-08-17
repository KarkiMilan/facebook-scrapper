import { writeFileSync } from 'node:fs';
import { FacebookGraphqlScraper } from './scraper.ts';

interface CliArgs {
  target: string;
  days: number;
  output?: string;
  openBrowser: boolean;
  displayProgress: boolean;
  fbAccount?: string;
  fbPwd?: string;
  browserKind?: 'chromium' | 'firefox' | 'webkit';
  storageState?: string;
  locale: string;
  debug: boolean;
  userDataDir?: string;
  warmUp: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    target: '',
    days: 61,
    openBrowser: false,
    displayProgress: true,
    locale: 'en_US',
    debug: false,
    userDataDir: undefined,
    warmUp: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string | undefined => argv[i + 1];
    switch (arg) {
      case '--target':
      case '-t':
        args.target = next() ?? '';
        i++;
        break;
      case '--days':
      case '-d':
        args.days = Number.parseInt(next() ?? '61', 10);
        i++;
        break;
      case '--output':
      case '-o':
        args.output = next();
        i++;
        break;
      case '--open-browser':
        args.openBrowser = true;
        break;
      case '--no-progress':
        args.displayProgress = false;
        break;
      case '--debug':
        args.debug = true;
        break;
      case '--user-data-dir':
        args.userDataDir = next();
        i++;
        break;
      case '--no-warm-up':
        args.warmUp = false;
        break;
      case '--fb-account':
        args.fbAccount = next();
        i++;
        break;
      case '--fb-pwd':
        args.fbPwd = next();
        i++;
        break;
      case '--browser':
        args.browserKind = next() as CliArgs['browserKind'];
        i++;
        break;
      case '--storage-state':
        args.storageState = next();
        i++;
        break;
      case '--locale':
        args.locale = next() ?? 'en_US';
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
        if (!args.target) args.target = arg;
        break;
    }
  }

  if (!args.target) {
    console.error('Missing required --target <username_or_user_id>.');
    printHelp();
    process.exit(1);
  }
  return args;
}

function printHelp(): void {
  console.log(`
Facebook GraphQL Scraper (Playwright + TypeScript)

Usage:
  node src/cli.ts <username_or_user_id> [options]

Options:
  -t, --target <id>         Facebook user / page ID or username (required)
  -d, --days <n>            Number of days of posts to scrape (default: 61)
  -o, --output <file>       Output JSON file (default: <target>_posts.json)
      --open-browser        Show the browser window (headless by default)
      --no-progress         Disable progress messages
      --fb-account <email>  Facebook account for login-based scraping
      --fb-pwd <password>   Facebook password for login-based scraping
      --browser <kind>      chromium | firefox | webkit (default: chromium)
      --storage-state <f>   Playwright storage-state JSON (logged-in session)
      --locale <code>       FB UI locale, default en_US
      --debug               Print per-check progress diagnostics
      --user-data-dir <d>   Persistent browser profile dir (accumulates cookies)
      --no-warm-up          Skip the facebook.com pre-visit
  -h, --help                Show this help
`);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const outputFile = cli.output ?? `${cli.target}_posts.json`;

  const scraper = new FacebookGraphqlScraper({
    fbAccount: cli.fbAccount,
    fbPwd: cli.fbPwd,
    openBrowser: cli.openBrowser,
    browserKind: cli.browserKind,
    storageState: cli.storageState,
    locale: cli.locale,
    debug: cli.debug,
    userDataDir: cli.userDataDir,
    warmUp: cli.warmUp,
  });

  console.log(`Scraping facebook.com/${cli.target} for the past ${cli.days} days...`);
  await scraper.init();
  try {
    const result = await scraper.getUserPosts(cli.target, cli.days, cli.displayProgress);
    writeFileSync(outputFile, JSON.stringify(result, null, 4), 'utf-8');
    console.log(`\nSaved ${result.data.length} posts to ${outputFile}`);
    console.log(`Profile info: ${result.profile.length} entries`);
  } finally {
    await scraper.close();
  }
}

main().catch((error) => {
  console.error(`Scraping failed: ${(error as Error).message}`);
  process.exit(1);
});