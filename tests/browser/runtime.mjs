import {pathToFileURL} from 'node:url';
// Optional browser checks require Playwright. Point POLYCUP_PLAYWRIGHT at its
// index.mjs when using a separately managed runtime instead of a local install.
export const {chromium} = await import(process.env.POLYCUP_PLAYWRIGHT
  ? pathToFileURL(process.env.POLYCUP_PLAYWRIGHT).href : 'playwright');
