/**
 * isPreview=true(1페이지) + isPreview=false(2페이지~) 방식 검증
 */
import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PRODUCT_URL = 'https://www.coupang.com/vp/products/8283831895?itemId=23884153522&vendorItemId=91002023030';
const PRODUCT_ID = '8283831895';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    defaultViewport: null,
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  const results = await page.evaluate(async (productId) => {
    const headers = { 'Accept': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
    const out = [];
    // 1페이지: isPreview=true, 2~4페이지: isPreview=false
    const tests = [
      { pageNo: 1, isPreview: 'true' },
      { pageNo: 2, isPreview: 'false' },
      { pageNo: 3, isPreview: 'false' },
      { pageNo: 4, isPreview: 'false' },
    ];
    for (const { pageNo, isPreview } of tests) {
      const url = `https://www.coupang.com/next-api/products/inquiries?productId=${productId}&pageNo=${pageNo}&isPreview=${isPreview}`;
      const res = await fetch(url, { headers, credentials: 'include' });
      const data = await res.json();
      const nav = data.success?.rData?.navigation ?? {};
      const contents = nav.contents ?? [];
      out.push({
        pageNo, isPreview, status: res.status,
        count: contents.length,
        pageCount: nav.lastPageUnit?.displayPageNo ?? nav.pageList?.length ?? 0,
        // 첫번째 항목 ID만 비교
        firstId: contents[0]?.inquiryId ?? null,
        firstContent: (contents[0]?.content ?? '').slice(0, 30),
      });
    }
    return out;
  }, PRODUCT_ID);

  console.log('페이지별 결과:');
  results.forEach(r => {
    console.log(`  page${r.pageNo} isPreview=${r.isPreview}: [${r.status}] ${r.count}개, 총${r.pageCount}p, firstId=${r.firstId}, "${r.firstContent}"`);
  });

  await browser.close();
})();
