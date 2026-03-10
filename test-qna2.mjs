import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PRODUCT_URL = 'https://www.coupang.com/vp/products/8283831895?itemId=23884153522&vendorItemId=91002023030';
const PRODUCT_ID = '8283831895';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  const results = await page.evaluate(async (productId) => {
    const headers = { 'Accept': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
    const out = [];
    const tests = [
      `productId=${productId}&pageNo=2&isPreview=true`,
      `productId=${productId}&page=2&isPreview=false`,
      `productId=${productId}&pageNo=2`,
      `productId=${productId}&pageNo=2&isPreview=false`,
    ];
    for (const qs of tests) {
      const url = `https://www.coupang.com/next-api/products/inquiries?${qs}`;
      const res = await fetch(url, { headers, credentials: 'include' });
      const text = await res.text();
      let parsed = null;
      let parseErr = null;
      try { parsed = JSON.parse(text); } catch(e) { parseErr = text.slice(0, 100); }
      const nav = parsed?.success?.rData?.navigation ?? {};
      const contents = nav.contents ?? [];
      out.push({ qs, status: res.status, isJson: !!parsed, count: contents.length, firstId: contents[0]?.inquiryId ?? null, parseErr });
    }
    return out;
  }, PRODUCT_ID);

  console.log('파라미터 조합 테스트:');
  results.forEach(r => {
    if (r.parseErr) console.log(`  [${r.status}] JSON아님: ${r.parseErr}\n    → ${r.qs}`);
    else console.log(`  [${r.status}] ${r.count}개 firstId=${r.firstId}\n    → ${r.qs}`);
  });

  await browser.close();
})();
