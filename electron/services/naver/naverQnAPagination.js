// import { writeFile, mkdir } from 'fs/promises';
// import { join } from 'path';

/**
 * 네이버 Q&A 페이지네이션 관련 함수들
 * Q&A 페이지네이션은 리뷰 페이지네이션과 다름:
 * - 처음에는 1-10 페이지가 보이고 "다음" 버튼이 있음
 * - 10페이지 도달 후 "다음" 버튼을 누르면 11-20 페이지가 나타남
 * - "이전" 버튼과 함께 11이 선택되어 있음
 * - 20 크롤링 완료 후 "다음" 버튼을 누르면 21이 선택됨
 */

/**
 * 현재 페이지 번호 확인
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<number|null>} 현재 페이지 번호 또는 null
 */
async function getCurrentQnAPageNumber(page) {
  console.log('[NaverQnAPagination] 📍 현재 Q&A 페이지를 확인합니다...');
  
  try {
    const pageNumber = await page.evaluate(() => {
      // 현재 페이지는 aria-current="true"인 요소
      const currentPageElement = document.querySelector('a.F0MhmLrV2F[aria-current="true"]');
      if (currentPageElement && currentPageElement.textContent) {
        const text = currentPageElement.textContent.trim();
        const num = parseInt(text);
        return isNaN(num) ? null : num;
      }
      return null;
    });
    
    if (pageNumber !== null) {
      console.log(`[NaverQnAPagination]   ✅ 현재 페이지: ${pageNumber}`);
      return pageNumber;
    }
    
    console.log('[NaverQnAPagination]   ⚠️ 현재 페이지를 찾을 수 없습니다.');
    return null;
  } catch (e) {
    console.log(`[NaverQnAPagination]   ❌ 현재 페이지 확인 실패: ${e.message}`);
    return null;
  }
}

// 실패 시 페이지네이션 HTML을 저장 (디버깅용)
async function savePaginationHtml(page, targetPage, reason = 'unknown') {
  try {
    const snapshot = await page.evaluate(() => {
      const getContainer = () =>
        document.querySelector('div[role="menubar"][data-shp-inventory="qna"]') ||
        document.querySelector('div.heUg1l_zzF.t_Jt5dgEqS[data-shp-inventory="qna"]') ||
        document.querySelector('div.bJ45eIkmCE.heUg1l_zzF.t_Jt5dgEqS') ||
        document.querySelector('div.B1cSiaH8W3.heUg1l_zzF.t_Jt5dgEqS');
      const container = getContainer();
      return {
        url: location.href,
        containerHtml: container ? container.outerHTML : '',
        bodyHtml: document.body?.innerHTML || '',
      };
    });

    const dir = join(process.cwd(), 'results', 'debug');
    await mkdir(dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `pagination_fail_target-${targetPage}_${timestamp}.html`;
    const filepath = join(dir, filename);

    const content = [
      `<!-- url: ${snapshot.url} -->`,
      `<!-- reason: ${reason} -->`,
      '<!-- container -->',
      snapshot.containerHtml || '<!-- container missing -->',
      '<!-- full body (for 추가 확인) -->',
      snapshot.bodyHtml,
    ].join('\n');

    await writeFile(filepath, content, 'utf-8');
    console.log(`[NaverQnAPagination]     📝 페이지네이션 HTML 저장: ${filepath}`);
    return filepath;
  } catch (err) {
    console.log(`[NaverQnAPagination]     ❌ 페이지네이션 HTML 저장 실패: ${err.message}`);
    return null;
  }
}

/**
 * 다음 페이지로 이동 (Q&A 전용)
 * @param {object} page - Puppeteer page 객체
 * @param {number} targetPage - 이동할 페이지 번호
 * @returns {Promise<boolean>} 이동 성공 여부
 */
export async function navigateToNextQnAPage(page, targetPage) {
  console.log(`[NaverQnAPagination] 🔍 Q&A 페이지 ${targetPage}로 이동을 시도합니다...`);
  
  // 현재 페이지 확인
  const currentPage = await getCurrentQnAPageNumber(page);
  
  if (currentPage === null) {
    console.log(`[NaverQnAPagination]   ⚠️ 현재 페이지를 확인할 수 없어 페이지 이동을 시도합니다.`);
  } else {
    console.log(`[NaverQnAPagination]   현재 페이지: ${currentPage}, 목표 페이지: ${targetPage}`);
  }
  
  let pageClicked = false;

  // 페이지네이션 영역이 보이도록 스크롤 다운
  try {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  } catch (e) {
    console.log(`[NaverQnAPagination]     ⚠️ 스크롤 이동 실패: ${e.message}`);
  }
  
  // 페이지네이션 컨테이너가 렌더될 시간을 잠시 대기
  try {
    await page.waitForSelector('div[role="menubar"][data-shp-inventory="qna"]', { timeout: 3000 });
  } catch (e) {
    console.log(`[NaverQnAPagination]     ⚠️ 페이지네이션 컨테이너 대기 실패: ${e.message}`);
  }
  
  const blockSize = 10;

  // 현재 보이는 페이지 범위와 컨테이너 정보를 반환
  const getVisibleRange = async () => {
    return page.evaluate(() => {
      const getContainer = () =>
        document.querySelector('div[role="menubar"][data-shp-inventory="qna"]') ||
        document.querySelector('div.heUg1l_zzF.t_Jt5dgEqS[data-shp-inventory="qna"]') ||
        document.querySelector('div.bJ45eIkmCE.heUg1l_zzF.t_Jt5dgEqS') ||
        document.querySelector('div.B1cSiaH8W3.heUg1l_zzF.t_Jt5dgEqS');

      const container = getContainer();
      const pageNumbers = [];
      if (container) {
        const pageButtons = container.querySelectorAll('a.F0MhmLrV2F[role="menuitem"]');
        pageButtons.forEach(btn => {
          const text = btn.textContent?.trim();
          if (text && /^\d+$/.test(text)) pageNumbers.push(parseInt(text));
        });
      }

      const minPage = pageNumbers.length ? Math.min(...pageNumbers) : null;
      const maxPage = pageNumbers.length ? Math.max(...pageNumbers) : null;
      return { minPage, maxPage };
    });
  };

  // 페이지 묶음 이동 전용 클릭 함수 (다음/이전 모두 10단위)
  const clickBundleNav = async (direction) => {
    return page.evaluate((dir) => {
      const getContainer = () =>
        document.querySelector('div[role="menubar"][data-shp-inventory="qna"]') ||
        document.querySelector('div.heUg1l_zzF.t_Jt5dgEqS[data-shp-inventory="qna"]') ||
        document.querySelector('div.bJ45eIkmCE.heUg1l_zzF.t_Jt5dgEqS') ||
        document.querySelector('div.B1cSiaH8W3.heUg1l_zzF.t_Jt5dgEqS');

      const container = getContainer();
      if (!container) return false;

      const selector = dir === 'next'
        ? 'a.g58k3AtMIx.jFLfdWHAWX'
        : 'a.g58k3AtMIx.UNYVRHeLjs';

      const buttons = container.querySelectorAll(selector);
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim();
        const ariaHidden = btn.getAttribute('aria-hidden');
        const ariaDisabled = btn.getAttribute('aria-disabled');
        const isNext = dir === 'next' && text.includes('다음');
        const isPrev = dir === 'prev' && text.includes('이전');
        if ((isNext || isPrev) && ariaHidden !== 'true' && ariaDisabled !== 'true') {
          btn.click();
          return true;
        }
      }
      return false;
    }, direction);
  };

  // 실제 페이지 번호 버튼 클릭 (한 페이지 이동 전용) - 디버깅 강화
  const clickPageNumber = async (targetPageNum) => {
    const result = await page.evaluate((pageNum) => {
      const getContainer = () =>
        document.querySelector('div[role="menubar"][data-shp-inventory="qna"]') ||
        document.querySelector('div.heUg1l_zzF.t_Jt5dgEqS[data-shp-inventory="qna"]') ||
        document.querySelector('div.bJ45eIkmCE.heUg1l_zzF.t_Jt5dgEqS') ||
        document.querySelector('div.B1cSiaH8W3.heUg1l_zzF.t_Jt5dgEqS');

      const container = getContainer();
      if (!container) {
        return { success: false, error: '컨테이너를 찾을 수 없음' };
      }

      const pageButtons = container.querySelectorAll('a.F0MhmLrV2F[role="menuitem"]');
      const buttonCount = pageButtons.length;
      
      for (const button of pageButtons) {
        const text = button.textContent?.trim();
        if (text && /^\d+$/.test(text) && parseInt(text) === pageNum) {
          const buttonInfo = {
            href: button.href,
            ariaCurrent: button.getAttribute('aria-current'),
            ariaDisabled: button.getAttribute('aria-disabled'),
            className: button.className,
            offsetTop: button.offsetTop,
            offsetLeft: button.offsetLeft
          };
          
          try {
            // 클릭 전 스크롤로 노출 보장
            button.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } catch (e) {
            return { success: false, error: `scrollIntoView 실패: ${e.message}`, buttonInfo };
          }
          
          // 네이티브 click() 사용
          button.click();
          return { success: true, buttonCount, buttonInfo };
        }
      }
      return { success: false, error: `페이지 ${pageNum} 버튼을 찾지 못함`, buttonCount };
    }, targetPageNum);
    
    // Node.js 콘솔에 로그 출력
    console.log(`[NaverQnAPagination]       [DEBUG] clickPageNumber(${targetPageNum}) 결과:`, JSON.stringify(result, null, 2));
    
    return result.success;
  };

  // 페이지 선택 완료까지 폴링 - 디버깅 강화
  const waitForPageSelection = async (expectedPage, maxRetries = 8, interval = 800) => {
    console.log(`[NaverQnAPagination]     🔍 페이지 ${expectedPage} 선택 대기 시작 (최대 ${maxRetries}회, ${interval}ms 간격)`);
    for (let i = 0; i < maxRetries; i++) {
      const current = await getCurrentQnAPageNumber(page);
      console.log(`[NaverQnAPagination]       폴링 ${i+1}/${maxRetries}: 현재=${current}, 목표=${expectedPage}`);
      if (current === expectedPage) {
        console.log(`[NaverQnAPagination]     ✅ 페이지 ${expectedPage} 선택 확인됨`);
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    console.log(`[NaverQnAPagination]     ❌ ${maxRetries}회 폴링 후에도 페이지 ${expectedPage}로 변경 안 됨`);
    return false;
  };

  // 1) 필요한 만큼 묶음 이동 (10단위) 후 2) 해당 숫자 클릭
  const current = currentPage ?? 1;
  const targetBlock = Math.floor((targetPage - 1) / blockSize);
  let currentBlock = Math.floor((current - 1) / blockSize);
  const blockDelta = targetBlock - currentBlock;

  if (blockDelta > 0) {
    const nextPageLabel = (currentBlock + 1) * blockSize + 1; // 21, 31, 41...
    console.log(`[NaverQnAPagination]     🔀 다음 버튼을 눌러 ${nextPageLabel}페이지로 이동 (묶음 이동: +${blockDelta * blockSize}페이지)`);
    for (let i = 0; i < blockDelta; i++) {
      const targetPageInBlock = (currentBlock + i + 1) * blockSize + 1;
      console.log(`[NaverQnAPagination]       다음 버튼 클릭 → ${targetPageInBlock}페이지 묶음으로 이동 시도...`);
      
      const moved = await clickBundleNav('next');
      if (!moved) {
        console.log('[NaverQnAPagination]     ❌ 다음 묶음 버튼 클릭 실패');
        break;
      }
      
      console.log(`[NaverQnAPagination]       ✅ 다음 버튼 클릭 완료 → ${targetPageInBlock}페이지 묶음으로 이동 대기 중...`);
      currentBlock += 1;
      
      // 묶음 이동 후 페이지 렌더링 대기 시간 증가 (800ms → 2000ms)
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } else if (blockDelta < 0) {
    const prevPageLabel = (currentBlock - 1) * blockSize + 1;
    console.log(`[NaverQnAPagination]     🔀 이전 버튼을 눌러 ${prevPageLabel}페이지로 이동 (묶음 이동: ${blockDelta * blockSize}페이지)`);
    for (let i = 0; i < Math.abs(blockDelta); i++) {
      const targetPageInBlock = (currentBlock - i - 1) * blockSize + 1;
      console.log(`[NaverQnAPagination]       이전 버튼 클릭 → ${targetPageInBlock}페이지 묶음으로 이동 시도...`);
      
      const moved = await clickBundleNav('prev');
      if (!moved) {
        console.log('[NaverQnAPagination]     ❌ 이전 묶음 버튼 클릭 실패');
        break;
      }
      
      console.log(`[NaverQnAPagination]       ✅ 이전 버튼 클릭 완료 → ${targetPageInBlock}페이지 묶음으로 이동 대기 중...`);
      currentBlock -= 1;
      
      // 묶음 이동 후 페이지 렌더링 대기 시간 증가 (800ms → 2000ms)
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } else {
    console.log('[NaverQnAPagination]     ℹ️ 묶음 이동 없이 동일 묶음 내에서 진행');
  }

  // 묶음 이동 후 목표 숫자 버튼 클릭 시도
  console.log(`[NaverQnAPagination]     📄 페이지 번호 버튼을 찾는 중...`);
  try {
    const range = await getVisibleRange();
    console.log(`[NaverQnAPagination]       현재 보이는 페이지 범위: ${range.minPage}~${range.maxPage}`);
    
    const inVisibleRange = range.minPage !== null && range.maxPage !== null &&
      targetPage >= range.minPage && targetPage <= range.maxPage;

    if (!inVisibleRange) {
      console.log(`[NaverQnAPagination]     ⚠️ 목표 페이지 ${targetPage}가 현재 묶음(${range.minPage}~${range.maxPage})에 없습니다.`);
    } else {
      console.log(`[NaverQnAPagination]     ✅ 목표 페이지 ${targetPage}가 가시 범위 내에 있음. 클릭 시도...`);
      const clicked = await clickPageNumber(targetPage);
      if (clicked) {
        pageClicked = true;
        console.log(`[NaverQnAPagination]     ✅ 페이지 ${targetPage} 번호 버튼을 클릭했습니다.`);
      } else {
        console.log(`[NaverQnAPagination]     ⚠️ 페이지 ${targetPage} 번호 버튼을 찾을 수 없습니다.`);
      }
    }
  } catch (e) {
    console.log(`[NaverQnAPagination]     ❌ 페이지 번호 클릭 실패: ${e.message}`);
  }

  // 묶음 이동 직후 11, 21 등 첫 페이지가 자동 선택되는 경우를 허용
  if (!pageClicked && (targetPage - 1) % blockSize === 0 && currentBlock === targetBlock) {
    console.log('[NaverQnAPagination]     🔄 묶음 이동 후 첫 페이지 자동 선택 여부 확인 중...');
    pageClicked = true; // 이후 검증 단계에서 실제 페이지 번호를 확인
  }
  
  if (!pageClicked) {
    console.log(`[NaverQnAPagination]     ❌ 페이지 ${targetPage}로 이동할 수 없습니다.`);
    // await savePaginationHtml(page, targetPage, 'no_page_button');
    return false;
  }
  
  // 페이지 변경 완료 대기 (폴링 기반) - 최대 3회 클릭 시도
  const maxAttempts = 3;
  let attempt = 1;
  
  console.log(`[NaverQnAPagination]     ⏳ 첫 클릭 후 대기 시간 추가 (500ms)...`);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  let confirmed = await waitForPageSelection(targetPage);

  while (!confirmed && attempt < maxAttempts) {
    console.log(`[NaverQnAPagination]     ⚠️ 시도 ${attempt}/${maxAttempts} 실패 → 재클릭 시도...`);
    
    // 재클릭 전 페이지 상태 덤프
    const debugInfo = await page.evaluate(() => {
      const container = document.querySelector('div[role="menubar"][data-shp-inventory="qna"]');
      const currentEl = container?.querySelector('a.F0MhmLrV2F[aria-current="true"]');
      const allButtons = Array.from(container?.querySelectorAll('a.F0MhmLrV2F[role="menuitem"]') || []);
      return {
        currentPage: currentEl?.textContent?.trim(),
        allPageNumbers: allButtons.map(btn => btn.textContent?.trim()).filter(t => /^\d+$/.test(t))
      };
    });
    console.log(`[NaverQnAPagination]       재시도 전 상태:`, debugInfo);
    
    const retryClicked = await clickPageNumber(targetPage);
    if (!retryClicked) {
      console.log(`[NaverQnAPagination]     ❌ 재시도 클릭 실패`);
      return false;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    attempt += 1;
    confirmed = await waitForPageSelection(targetPage, 10, 1000);
  }

  if (!confirmed) {
    console.log(`[NaverQnAPagination]     ❌ ${maxAttempts}회 시도 후에도 페이지 선택 실패`);
    // await savePaginationHtml(page, targetPage, 'selection_timeout');
    return false;
  }

  // 클릭 후 페이지네이션 영역이 다시 렌더되도록 스크롤 유지
  try {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  } catch (e) {
    console.log(`[NaverQnAPagination]     ⚠️ 클릭 후 스크롤 이동 실패: ${e.message}`);
  }
  
  // 이동 후 현재 페이지 확인 (시도한 페이지와 실제 선택 페이지 일치 여부 검증)
  const newCurrentPage = await getCurrentQnAPageNumber(page);
  if (newCurrentPage !== null && newCurrentPage === targetPage) {
    console.log(`[NaverQnAPagination]     ✅ 페이지 ${targetPage}로 이동 확인 완료.`);
    return true;
  }

  console.log(`[NaverQnAPagination]     ❌ 페이지 이동 불일치: 현재=${newCurrentPage}, 목표=${targetPage}`);
  // await savePaginationHtml(page, targetPage, 'page_mismatch');
  return false;
}

/**
 * Q&A 페이지네이션이 가능한지 확인
 * @param {object} page - Puppeteer page 객체
 * @returns {Promise<boolean>} 페이지네이션 가능 여부
 */
export async function hasNextQnAPage(page) {
  try {
    const hasNext = await page.evaluate(() => {
      const paginationContainer = document.querySelector('div.bJ45eIkmCE.heUg1l_zzF.t_Jt5dgEqS, div.B1cSiaH8W3.heUg1l_zzF.t_Jt5dgEqS, div[role="menubar"][data-shp-inventory="qna"]');

      // 현재 페이지 번호/다음 버튼 탐색을 위한 헬퍼
      const getCurrentPage = (root) => {
        const currentEl = root?.querySelector?.('a.F0MhmLrV2F[aria-current="true"]');
        if (currentEl?.textContent) {
          const num = parseInt(currentEl.textContent.trim());
          if (!isNaN(num)) return num;
        }
        return 1;
      };

      // 1) 페이지네이션 컨테이너 기반 체크
      if (paginationContainer) {
        const pageButtons = paginationContainer.querySelectorAll('a.F0MhmLrV2F[role="menuitem"]');
        const pageNumbers = [];
        pageButtons.forEach(btn => {
          const text = btn.textContent?.trim();
          if (text && /^\d+$/.test(text)) pageNumbers.push(parseInt(text));
        });
        const maxPage = pageNumbers.length > 0 ? Math.max(...pageNumbers) : null;
        const currentPage = getCurrentPage(paginationContainer);

        // "다음" 버튼 존재 여부
        const nextButtons = paginationContainer.querySelectorAll('a.g58k3AtMIx.jFLfdWHAWX');
        for (const button of nextButtons) {
          const buttonText = (button.textContent || '').trim();
          const ariaHidden = button.getAttribute('aria-hidden');
          const ariaDisabled = button.getAttribute('aria-disabled');
          if (buttonText.includes('다음') && ariaHidden !== 'true' && ariaDisabled !== 'true') {
            return true;
          }
        }

        // 현재 페이지보다 큰 번호가 존재하면 다음 페이지 가능
        if (maxPage !== null && maxPage > currentPage) {
          return true;
        }
      }

      // 2) 컨테이너가 없거나 실패한 경우, 전역 fallback: 텍스트에 "다음"이 포함된 링크 탐색
      const allAnchors = document.querySelectorAll('a');
      for (const a of allAnchors) {
        const text = (a.textContent || '').trim();
        if (text.includes('다음')) {
          const ariaHidden = a.getAttribute('aria-hidden');
          const ariaDisabled = a.getAttribute('aria-disabled');
          if (ariaDisabled !== 'true' && ariaHidden !== 'true') {
            return true;
          }
        }
      }

      return false;
    });
    
    return hasNext;
  } catch (e) {
    console.log(`[NaverQnAPagination] 다음 페이지 확인 실패: ${e.message}`);
    return false;
  }
}

