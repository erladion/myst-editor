// Launch the app on the e2e fixture and save a screenshot:
//   npx tsx scripts/screenshot.ts <out.png> [page title] [scroll px]
import { launch } from '../e2e/helpers.js';

const [out, pageName, scroll] = process.argv.slice(2);
const { app, page } = await launch();
page.on('console', (m) => console.log(`[renderer ${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[renderer error]', e.message));
await page.setViewportSize({ width: 1280, height: 900 });
if (pageName) await page.getByRole('button', { name: pageName }).click();
if (scroll) await page.locator('.scroll').evaluate((el, y) => el.scrollTo(0, y), Number(scroll));
await page.waitForTimeout(800);
await page.screenshot({ path: out });
await app.close();
