/**
 * 네이버 Q&A 추출 — page.evaluate 일회 직렬화 방식
 *
 * 리뷰 측(naverReviewExtractor.js) 검증된 패턴 그대로 채택.
 * - ElementHandle을 들고 있다가 frame detach 당하지 않도록
 *   page.evaluate 두 번 호출(① 펼침 일괄 클릭 → ② 일괄 직렬화 추출)로 처리.
 * - 답변 본문에서 "판매자" 라벨(span.QnKjMlq02P)은 cloneNode 후 제거하여 안전 추출.
 * - 비밀글 li는 button.Zkm9D0uiDX(펼침 토글)이 없으므로 펼침 시도하지 않음.
 * - 작성일 YY.MM.DD. 패턴 정규식 보정.
 * - aria-expanded는 li에 위치 (button 아님 — 진단 보정 4번).
 */
import { QNA } from './naverSelectors.js';

/**
 * 비밀글 제외 체크박스 클릭 (input#qnaSecret)
 * — 옛 코드의 로직 유지. 새 페이지 구조에서도 동일 ID 사용.
 * @param {object} page - Puppeteer page 객체
 * @param {boolean} excludeSecret - 비밀글 제외 여부
 */
async function clickExcludeSecretCheckbox(page, excludeSecret) {
  if (!excludeSecret) {
    console.log(`[NaverQnAExtractor] 비밀글 제외 체크박스가 선택되지 않았습니다.`);
    return;
  }

  console.log(`[NaverQnAExtractor] 비밀글 제외 체크박스 클릭 시도...`);
  try {
    const checkboxClicked = await page.evaluate((cbId) => {
      const checkbox = document.querySelector(`input[type="checkbox"][id="${cbId}"]`);
      if (checkbox && !checkbox.checked) {
        checkbox.click();
        return true;
      }
      return false;
    }, QNA.secretCheckboxId);

    if (checkboxClicked) {
      console.log(`[NaverQnAExtractor] ✅ 비밀글 제외 체크박스를 클릭했습니다.`);
      // 체크박스 클릭 후 리스트 갱신 대기
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log(`[NaverQnAExtractor] ⚠️ 비밀글 제외 체크박스를 찾을 수 없거나 이미 선택됨.`);
    }
  } catch (error) {
    console.log(`[NaverQnAExtractor] ⚠️ 비밀글 제외 체크박스 클릭 중 오류: ${error.message}`);
  }
}

/**
 * Q&A 모달 안의 모든 li를 펼침 (비밀글이 아닌 li의 button.Zkm9D0uiDX 일괄 클릭)
 * — 펼침 후 리뷰 본문이 길어지므로 이후 추출 단계에서 전체 본문을 얻을 수 있음.
 * @param {object} page
 * @returns {Promise<{clicked: number, total: number}>}
 */
async function expandAllNonSecretQnAs(page) {
  const result = await page.evaluate((selectors) => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const dialog = dialogs.find(d => d.querySelector(selectors.modalDialogSelector));
    if (!dialog) return { clicked: 0, total: 0 };

    const items = Array.from(dialog.querySelectorAll(selectors.modalDialogSelector));
    let clicked = 0;
    for (const li of items) {
      // 이미 펼친 li는 스킵
      if (li.getAttribute('aria-expanded') === 'true') continue;

      // 비밀글 li에는 button.Zkm9D0uiDX이 없음 (보정 5)
      const expandBtn = li.querySelector(selectors.expandButtonSelector);
      if (expandBtn) {
        try {
          expandBtn.click();
          clicked++;
        } catch (e) { /* 무시 */ }
      }
    }
    return { clicked, total: items.length };
  }, QNA);

  return result;
}

/**
 * 모달 내 모든 li를 직렬화하여 Q&A 평문 객체 배열로 반환
 * @param {object} page
 * @returns {Promise<Array<object>>}
 */
async function extractQnAsRaw(page) {
  return page.evaluate((selectors) => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const dialog = dialogs.find(d => d.querySelector(selectors.modalDialogSelector));
    if (!dialog) return [];

    const items = Array.from(dialog.querySelectorAll(selectors.modalDialogSelector));
    const SECRET_TITLE = selectors.secretTitleText;

    return items.map((li) => {
      // 답변 상태 (예: "답변완료")
      const answerStatusEl = li.querySelector(selectors.answerStatusSelector);
      const answerStatus = answerStatusEl ? (answerStatusEl.textContent || '').trim() : '';

      // 질문 본문 (펼침 전후 같은 위치, 펼친 후 길어짐)
      const questionEl = li.querySelector(selectors.questionParagraphSelector);
      const question = questionEl ? (questionEl.textContent || '').trim() : '';

      // 비밀글 판정: 제목 텍스트 = "비밀글입니다." OR expand 버튼 부재
      // (보정 5: 비밀글 li엔 button.Zkm9D0uiDX이 아예 없음)
      const expandBtn = li.querySelector(selectors.expandButtonSelector);
      const isSecret = question === SECRET_TITLE || !expandBtn;

      // 작성자 (질문 컨테이너 내 div.Iwqsybzn32 안의 span.c456r2HufF 중 2번째)
      let author = '';
      const authorContainer = li.querySelector(selectors.authorContainerSelector);
      if (authorContainer) {
        const spans = Array.from(authorContainer.querySelectorAll(selectors.authorSpanSelector));
        if (spans.length >= 2) {
          author = (spans[1].textContent || '').trim();
        } else if (spans.length === 1) {
          author = (spans[0].textContent || '').trim();
        }
      }

      // 작성일 (span.c456r2HufF._osoqps1Tp)
      const dateEl = li.querySelector(selectors.dateSelector);
      let date = dateEl ? (dateEl.textContent || '').trim() : '';
      // YY.MM.DD. 패턴 보정 (보정 6)
      const dateMatch = date.match(/\d{2}\.\d{2}\.\d{2}\.?/);
      if (dateMatch) date = dateMatch[0];

      // 답변 (div.cdwfrsSLiU 내부)
      let answer = '';
      let answerAuthor = '';
      let answerDate = '';
      const answerContainer = li.querySelector(selectors.answerContainerSelector);
      if (answerContainer) {
        // 답변 본문 — span.QnKjMlq02P("판매자") 라벨을 cloneNode 후 제거하여 안전 추출 (보정 3)
        const pEl = answerContainer.querySelector('p.JuWU27jX8V');
        if (pEl) {
          const clone = pEl.cloneNode(true);
          clone.querySelectorAll(selectors.answerLabelSelector).forEach(n => n.remove());
          answer = (clone.textContent || '').trim();
        }

        // 답변 작성자 (라벨 = "판매자" 텍스트 — 라벨 자체를 작성자로 기록)
        const labelEl = answerContainer.querySelector(selectors.answerLabelSelector);
        if (labelEl) {
          answerAuthor = (labelEl.textContent || '').trim();
        }

        // 답변 작성일 (div.cdwfrsSLiU > div.Iwqsybzn32 > span.c456r2HufF 1번째)
        const ansAuthorContainer = answerContainer.querySelector('div.Iwqsybzn32');
        if (ansAuthorContainer) {
          const spans = Array.from(ansAuthorContainer.querySelectorAll(selectors.answerAuthorDateSpanSelector));
          if (spans.length >= 1) {
            const raw = (spans[0].textContent || '').trim();
            const m = raw.match(/\d{2}\.\d{2}\.\d{2}\.?/);
            answerDate = m ? m[0] : raw;
          }
        }
      }

      // 비밀글이면 question을 "비밀글입니다."로 강제 (옛 코드 호환)
      const finalQuestion = isSecret ? SECRET_TITLE : question;
      // 비밀글이면 title도 동일
      const title = isSecret ? SECRET_TITLE : question;

      return {
        answerStatus,
        title,
        question: finalQuestion,
        author,
        date,
        isSecret,
        answer: isSecret ? '' : answer,
        answerAuthor: isSecret ? '' : answerAuthor,
        answerDate: isSecret ? '' : answerDate,
      };
    });
  }, QNA);
}

/**
 * Q&A 모달에서 모든 Q&A 추출 (단일 모달, 무한 스크롤 후 호출되는 가정)
 *
 * @param {object} page - Puppeteer page 객체
 * @param {boolean} excludeSecret - 비밀글 제외 여부 (input#qnaSecret 체크)
 * @param {object} options - 추가 옵션 (또는 옛 호환용 pageNumber 숫자도 허용)
 * @param {Function} options.sendLog - sendLog 콜백 (선택)
 * @returns {Promise<Array<object>>} 추출된 Q&A 데이터 배열
 */
export async function extractAllQnAs(page, excludeSecret = false, options = {}) {
  // pageNumber 호환 처리: 옛 호출부가 숫자를 넘겨도 안전하게 무시
  let opts = options;
  if (typeof options === 'number' || options === null || options === undefined) {
    opts = {};
  }
  const { sendLog = null } = opts;

  console.log('[NaverQnAExtractor] Q&A 추출 시작 (page.evaluate 일회 직렬화)...');

  try {
    // 모달 안정화 대기
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 비밀글 제외 체크박스 처리
    await clickExcludeSecretCheckbox(page, excludeSecret);

    // ① 모든 비밀글 아닌 li 일괄 펼침
    const expandResult = await expandAllNonSecretQnAs(page);
    console.log(`[NaverQnAExtractor] 📂 펼침 시도: ${expandResult.clicked}/${expandResult.total} (비밀글 제외)`);

    // 펼침 애니메이션/본문 lazy load 대기 + aria-expanded 수렴 폴링
    // (펼침 직후 본문 비동기 로드로 짧은 본문 잡힐 위험 방지 — 최대 4초)
    await new Promise(resolve => setTimeout(resolve, 1500));
    const POLL_MAX_MS = 2500;
    const POLL_INTERVAL_MS = 250;
    const pollStart = Date.now();
    while (Date.now() - pollStart < POLL_MAX_MS) {
      const stat = await page.evaluate((selectors) => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
        const dialog = dialogs.find(d => d.querySelector(selectors.modalDialogSelector));
        if (!dialog) return { expanded: 0, expandable: 0 };
        const items = Array.from(dialog.querySelectorAll(selectors.modalDialogSelector));
        let expanded = 0, expandable = 0;
        for (const li of items) {
          if (li.querySelector(selectors.expandButtonSelector)) {
            expandable++;
            if (li.getAttribute('aria-expanded') === 'true') expanded++;
          }
        }
        return { expanded, expandable };
      }, QNA);
      if (stat.expandable === 0 || stat.expanded >= stat.expandable) {
        console.log(`[NaverQnAExtractor] ✅ aria-expanded 수렴: ${stat.expanded}/${stat.expandable}`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // ② 단일 evaluate에서 직렬화 추출
    const rawQnAs = await extractQnAsRaw(page);
    console.log(`[NaverQnAExtractor] ${rawQnAs.length}개의 Q&A 메타데이터를 직렬화 추출했습니다.`);

    if (rawQnAs.length === 0) {
      console.log('[NaverQnAExtractor] ❌ 추출된 Q&A가 없습니다.');
      return [];
    }

    // ③ 객체 조립 + Page_Review 부여 (리뷰와 동일한 1_${i+1} 패턴)
    const allQnAs = [];
    for (let i = 0; i < rawQnAs.length; i++) {
      const raw = rawQnAs[i];

      // 진행률 로그 (매 50개)
      if (i === 0 || (i + 1) % 50 === 0 || i === rawQnAs.length - 1) {
        console.log(`[NaverQnAExtractor] 📊 진행: ${i + 1}/${rawQnAs.length}`);
      }

      const qnaData = {
        answerStatus: raw.answerStatus || '',
        title: raw.title || '',
        author: raw.author || '',
        date: raw.date || '',
        question: raw.question || raw.title || '',
        answer: raw.answer || '',
        answerAuthor: raw.answerAuthor || '',
        answerDate: raw.answerDate || '',
        isSecret: !!raw.isSecret,
        Page_Review: `1_${i + 1}`,
      };

      allQnAs.push(qnaData);
    }

    console.log(`[NaverQnAExtractor] ✅ 총 ${allQnAs.length}개의 Q&A를 추출했습니다.`);
    sendLog?.(`[완료] Q&A 메타데이터 추출 완료 (${allQnAs.length}개)`, 'success');
    return allQnAs;
  } catch (error) {
    console.error(`[NaverQnAExtractor] ❌ Q&A 추출 중 오류: ${error.message}`);
    return [];
  }
}
