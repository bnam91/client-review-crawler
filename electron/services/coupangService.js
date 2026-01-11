/**
 * 쿠팡 플랫폼 전용 서비스
 */

/**
 * 쿠팡 검색 페이지 URL 생성
 */
export function createCoupangSearchUrl(query) {
  const encodedQuery = encodeURIComponent(query);
  return `https://www.coupang.com/np/search?component=&q=${encodedQuery}`;
}

/**
 * 쿠팡 플랫폼 처리 메인 함수
 */
export async function handleCoupang(browser, page, input, isUrl) {
  if (isUrl) {
    // URL인 경우 새 탭 열고 해당 URL로 이동
    console.log('[CoupangService] 쿠팡 URL로 인식, 새 탭에서 해당 URL로 이동:', input);
    
    // 새 탭 열기
    const newPage = await browser.newPage();
    await newPage.goto(input, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // 새 탭으로 전환
    await newPage.bringToFront();
    
    console.log('[CoupangService] 새 탭에서 쿠팡 URL로 이동 완료:', input);
    
    return {
      success: true,
      message: '브라우저에서 쿠팡 URL을 열었습니다.',
      isUrl: true,
      platform: '쿠팡',
      finalUrl: input,
    };
  } else {
    // 검색어인 경우 새 탭 열고 쿠팡 검색 URL로 이동
    const searchUrl = createCoupangSearchUrl(input);
    
    console.log('[CoupangService] 쿠팡 검색어로 인식, 새 탭에서 검색 페이지로 이동:', searchUrl);
    
    // 새 탭 열기
    const newPage = await browser.newPage();
    await newPage.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // 새 탭으로 전환
    await newPage.bringToFront();
    
    console.log('[CoupangService] 쿠팡 검색 페이지로 이동 완료:', searchUrl);
    
    return {
      success: true,
      message: '쿠팡 검색 페이지로 이동했습니다.',
      isUrl: false,
      platform: '쿠팡',
      searchQuery: input,
      searchUrl: searchUrl,
    };
  }
}

