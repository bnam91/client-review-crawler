/**
 * 네이버 탭 클릭 및 정렬 옵션 관련 함수들
 *
 * 리뉴얼 후 리뷰/Q&A 모두 모달 진입 방식으로 통일.
 * - 리뷰(0): "리뷰 전체보기" 버튼 → 모달 + 정렬
 * - Q&A(1):  "Q&A 전체보기" 버튼 → 모달 (정렬 옵션 없음)
 */
import { REVIEW } from './naverSelectors.js';
import { openReviewModal, openQnAModal } from './naverNavigation.js';

/**
 * 비정상 페이지 감지 + 자동 회복 대기
 * URL이 /products/여도 실제 화면이 캡챠/장애 페이지일 때 0개 종료되는 사고 방지.
 *
 * 감지 케이스:
 *  - captcha: 사용자 액션 필요 (캡챠 풀기) — 풀면 자동 진행
 *  - serviceUnavailable: 네이버 인프라 장애 — 자동 reload 폴링
 *
 * 셀렉터는 productPageUtil.js의 검증된 4개 + 인프라 장애 페이지 1개.
 *
 * @param {object} page - Puppeteer page 객체
 * @param {Function|null} sendLog - 사용자 안내 로그 콜백
 * @param {number} maxMs - 최대 대기 시간 (기본 5분)
 * @returns {Promise<boolean>} true=정상 진입 가능 / false=시간 초과
 */
export async function waitForCaptchaIfNeeded(page, sendLog = null, maxMs = 300000) {
  const start = Date.now();
  let captchaDetected = false;
  let serviceDownDetected = false;
  let loginWallDetected = false;
  // ★막힌 상태는 «도중에 바뀐다»(실측: 장애 → 새로고침 → 로그인).
  //   타임아웃 문구를 «처음 만난» 상태로 쓰면 사용자가 엉뚱한 걸 고치려 든다.
  //   그래서 «마지막으로 관측된» 상태를 따로 기억해 그걸로 말한다.
  let lastBlock = null;   // 'captcha' | 'outage' | 'login'
  let lastReloadAt = 0;
  const RELOAD_INTERVAL_MS = 30000; // 서비스 장애 시 30초마다 reload

  while (Date.now() - start < maxMs) {
    let probe;
    try {
      probe = await page.evaluate(() => {
        const captcha = !!(
          document.querySelector('[data-component="cpt_main"]') ||
          document.querySelector('.captcha_wrap') ||
          document.querySelector('#rcptForm') ||
          document.querySelector('#vcptForm')
        );
        // ★로그인 리다이렉트도 «막힌 상태»다 (2026-09-19 실측으로 추가).
        //   naverService는 «최초 진입 직후 1회»만 로그인 URL을 본다. 그 뒤에 리다이렉트되면
        //   아무도 안 본다 — 실제로 「장애 페이지 → 새로고침 → 로그인 페이지」로 넘어갔는데
        //   캡차·장애 마커가 없다는 이유로 「✅서비스 회복」이라 선언하고 진행해 0건으로 끝났다.
        //   ⇒ «마커의 부재»를 «정상»으로 읽지 않으려면, 막힌 상태를 빠짐없이 알아야 한다.
        //   ⚠️URL «전체»에 정규식을 걸면 쿼리스트링에 같은 문자열이 들어간 상품 URL을 오판한다.
        //     판정은 «호스트»로 한다 — 로그인 페이지인지 아닌지는 호스트가 말해준다.
        const loginWall = location.hostname === 'nid.naver.com';
        // 네이버 페이 인프라 장애 페이지: <strong class="title_error">현재 서비스 접속이 불가합니다.</strong>
        const errEl = document.querySelector('strong.title_error');
        const serviceUnavailable = !!errEl &&
          (errEl.textContent || '').includes('접속이 불가');
        return { captcha, serviceUnavailable, loginWall };
      });
    } catch (e) {
      // navigation 중 evaluate 실패 — 잠시 대기 후 재시도
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    if (!probe.captcha && !probe.serviceUnavailable && !probe.loginWall) {
      if (captchaDetected) {
        console.log('[NaverTabActions] ✅ 캡챠 통과 — 크롤링 계속 진행');
        sendLog?.('[정보] 캡챠 통과 — 크롤링 계속 진행', 'success');
      }
      if (serviceDownDetected) {
        console.log('[NaverTabActions] ✅ 서비스 회복 — 크롤링 계속 진행');
        sendLog?.('[정보] 네이버 서비스 회복 — 크롤링 계속 진행', 'success');
      }
      if (loginWallDetected) {
        console.log('[NaverTabActions] ✅ 로그인 완료 — 크롤링 계속 진행');
        sendLog?.('[정보] 로그인 완료 — 크롤링 계속 진행', 'success');
      }
      return true;
    }

    if (probe.loginWall) {
      lastBlock = 'login';
      if (!loginWallDetected) {
        console.log('[NaverTabActions] 🔒 네이버 로그인 페이지 감지 — 사용자 로그인 대기');
        sendLog?.('[🔒 로그인 필요] 열린 Chrome 창에서 네이버 로그인을 완료해 주세요. 완료하면 자동으로 이어집니다.', 'warning');
        loginWallDetected = true;
      }
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    if (probe.captcha) {
      lastBlock = 'captcha';
      if (!captchaDetected) {
        console.log('[NaverTabActions] ⚠️ 캡챠 페이지 감지 — 사용자 해결 대기');
        sendLog?.('[⚠️ 캡챠 감지] 브라우저에서 캡챠를 풀어주세요. 풀면 자동으로 진행됩니다 (최대 5분 대기)', 'warning');
        captchaDetected = true;
      }
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    if (probe.serviceUnavailable) {
      lastBlock = 'outage';
      if (!serviceDownDetected) {
        console.log('[NaverTabActions] ⚠️ "현재 서비스 접속이 불가합니다" 페이지 감지 — 자동 새로고침 시도');
        sendLog?.('[⚠️ 네이버 일시 장애] "현재 서비스 접속이 불가합니다" 페이지 감지. 30초마다 자동 새로고침 (최대 5분 대기)', 'warning');
        serviceDownDetected = true;
        lastReloadAt = Date.now();
      } else if (Date.now() - lastReloadAt >= RELOAD_INTERVAL_MS) {
        try {
          console.log('[NaverTabActions] 🔄 자동 새로고침');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
          console.log(`[NaverTabActions] ⚠️ reload 실패 (계속 폴링): ${e.message}`);
        }
        lastReloadAt = Date.now();
      }
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
  }

  // ★«마지막으로 막고 있던» 상태로 말한다 (처음 만난 상태가 아니라).
  // ⚠️maxMs는 «함수 시작부터»의 총 예산이다. 장애로 이미 몇 분 쓰고 로그인으로 넘어왔다면
  //   로그인에 실제로 주어진 시간은 그보다 짧다 — 「5분 줬다」처럼 읽히지 않게 «총 대기»라고 쓴다.
  const mins = Math.round(maxMs / 60000);
  if (lastBlock === 'login') {
    console.log('[NaverTabActions] ❌ 로그인 대기 시간 초과');
    sendLog?.(`[오류] 총 ${mins}분을 기다렸지만 마지막까지 «로그인 화면»이었습니다. Chrome 창에서 네이버 로그인을 마친 뒤 다시 실행해 주세요.`, 'error');
  } else if (lastBlock === 'captcha') {
    console.log('[NaverTabActions] ❌ 캡챠 대기 시간 초과');
    sendLog?.(`[오류] 총 ${mins}분을 기다렸지만 마지막까지 «보안확인(캡챠) 화면»이었습니다. Chrome 창에서 확인을 마친 뒤 다시 실행해 주세요.`, 'error');
  } else if (lastBlock === 'outage') {
    console.log('[NaverTabActions] ❌ 서비스 장애 회복 대기 시간 초과');
    sendLog?.(`[오류] 네이버 접속 장애가 ${mins}분 안에 풀리지 않았습니다. 잠시 후 다시 시도해 주세요.`, 'error');
  }
  return false;
}

/**
 * 모달 내부 정렬 옵션 적용
 * @param {object} page - Puppeteer page 객체
 * @param {number} sortOption - 0: 랭킹순, 1: 최신순, 2: 평점낮은순, 3: 평점높은순
 */
export async function setSortOption(page, sortOption) {
  // sortOption을 숫자로 변환 (문자열로 전달될 수 있음)
  const sortNum = typeof sortOption === 'string' ? parseInt(sortOption, 10) : sortOption;
  const sortNames = ['랭킹순', '최신순', '평점낮은순', '평점높은순'];
  console.log(`[NaverTabActions] 🔧 정렬 옵션 설정 중... (받은 값: ${sortOption}, 변환 후: ${sortNum}, ${sortNames[sortNum] || '알 수 없음'})`);

  try {
    // 정렬 옵션 로딩을 위해 잠시 대기 (모달 안 정렬 컨트롤이 마운트되도록)
    console.log('[NaverTabActions] ⏳ 정렬 컨트롤 로딩을 위해 1.5초 대기...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 0(랭킹순)은 기본값이므로 skip
    if (sortNum === 0) {
      console.log('[NaverTabActions] 랭킹순 정렬 (기본값) — 별도 처리 없음');
      return;
    }

    let targetText = '';
    if (sortNum === 1) targetText = REVIEW.sortOptionTextLatest;
    else if (sortNum === 2) targetText = REVIEW.sortOptionTextLow;
    else if (sortNum === 3) targetText = REVIEW.sortOptionTextHigh;
    else {
      console.log(`[NaverTabActions] ⚠️ 알 수 없는 정렬 옵션: ${sortNum}`);
      return;
    }

    console.log(`[NaverTabActions] '${targetText}' 정렬 적용 중...`);

    // 현재 정렬 라벨 텍스트 (변경 확인용)
    const beforeLabel = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || '').trim() : '';
    }, REVIEW.currentSortLabel);

    const clicked = await page.evaluate((btnSel, txt) => {
      const buttons = Array.from(document.querySelectorAll(btnSel));
      const btn = buttons.find(b => (b.textContent || '').trim() === txt);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, REVIEW.sortOptionButton, targetText);

    if (!clicked) {
      console.log(`[NaverTabActions] ⚠️ '${targetText}' 정렬 버튼을 찾을 수 없습니다.`);
      return;
    }

    console.log(`[NaverTabActions] ✅ '${targetText}' 클릭 완료. 라벨 변경 확인 중...`);

    // 정렬 적용 후 라벨 변경 확인 (최대 5초 폴링)
    const start = Date.now();
    let labelChanged = false;
    while (Date.now() - start < 5000) {
      const afterLabel = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? (el.textContent || '').trim() : '';
      }, REVIEW.currentSortLabel);

      if (afterLabel && afterLabel !== beforeLabel) {
        console.log(`[NaverTabActions] ✅ 정렬 라벨 변경 확인: '${beforeLabel}' → '${afterLabel}'`);
        labelChanged = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (!labelChanged) {
      console.log(`[NaverTabActions] ⚠️ 정렬 라벨 변경을 확인하지 못했습니다.`);
    }

    // 정렬 적용 후 리스트 갱신 대기
    await new Promise(resolve => setTimeout(resolve, 1500));

  } catch (e) {
    console.log(`[NaverTabActions] ❌ 정렬 옵션 처리 중 오류: ${e.message}`);
  }
}

/**
 * 리뷰 또는 Q&A 진입
 * - 리뷰(0): "리뷰 전체보기" 버튼 클릭 → role="dialog" 모달 진입
 * - Q&A(1): a[data-name="QNA"] 탭 클릭 (기존 흐름 유지)
 *
 * @param {object} page - Puppeteer page 객체
 * @param {number} collectionType - 0: 리뷰 수집, 1: Q&A 수집
 * @param {number} sortOption - 0: 랭킹순, 1: 최신순, 2: 평점낮은순
 */
export async function clickReviewOrQnATab(page, collectionType, sortOption = 0, sendLog = null) {
  // sortOption을 숫자로 변환 (문자열로 전달될 수 있음)
  const sortNum = typeof sortOption === 'string' ? parseInt(sortOption, 10) : (sortOption || 0);
  const sortNames = ['랭킹순', '최신순', '평점낮은순', '평점높은순'];

  // 캡챠 페이지 감지 + 사용자 해결 대기 (URL이 /products/여도 캡챠 화면일 수 있음)
  const captchaOk = await waitForCaptchaIfNeeded(page, sendLog);
  if (!captchaOk) {
    // ★이 함수는 이제 캡차뿐 아니라 «장애 페이지·로그인 벽»도 기다린다.
    //   사유를 뭉뚱그려 「캡챠 미해결」이라 적으면 로그를 읽는 사람이 엉뚱한 데를 본다.
    console.log('[NaverTabActions] ❌ 페이지가 «막힌 상태»(캡차/장애/로그인)로 남아 모달 진입 중단');
    return;
  }

  if (collectionType === 0) {
    // 리뷰: 모달 진입
    console.log(`[NaverTabActions] 🔍 리뷰 모달 진입 중... (sortOption: ${sortOption}, 변환 후: ${sortNum}, ${sortNames[sortNum] || '알 수 없음'})`);

    try {
      // 페이지 안정화 대기
      await page.waitForLoadState?.('networkidle') || await new Promise(resolve => setTimeout(resolve, 1500));

      const opened = await openReviewModal(page);
      if (!opened) {
        throw new Error('리뷰 모달을 열 수 없습니다.');
      }

      console.log('[NaverTabActions] ✅ 리뷰 모달 진입 완료');

      // 모달 내부 정렬 적용
      console.log(`[NaverTabActions] 정렬 옵션 적용 - sortOption: ${sortOption}, 변환 후: ${sortNum} (${sortNames[sortNum] || '알 수 없음'})`);
      await setSortOption(page, sortNum);

      // 정렬 적용 후 리뷰 로딩 대기
      console.log('[NaverTabActions] ⏳ 정렬 적용 후 리뷰 로딩 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.log(`[NaverTabActions] ❌ 리뷰 모달 진입 실패: ${e.message}`);
    }
    return;
  }

  // Q&A: 모달 진입 (정렬 옵션 없음)
  console.log(`[NaverTabActions] 🔍 Q&A 모달 진입 중...`);

  try {
    // 페이지 안정화 대기
    await page.waitForLoadState?.('networkidle') || await new Promise(resolve => setTimeout(resolve, 1500));

    const opened = await openQnAModal(page);
    if (!opened) {
      throw new Error('Q&A 모달을 열 수 없습니다.');
    }

    console.log('[NaverTabActions] ✅ Q&A 모달 진입 완료');

    // 모달 안정화 대기 (체크박스/리스트 첫 렌더)
    await new Promise(resolve => setTimeout(resolve, 1500));
  } catch (e) {
    console.log(`[NaverTabActions] ❌ Q&A 모달 진입 실패: ${e.message}`);
  }
}
