/**
 * 네이버 Q&A 추출 관련 함수들
 */

/**
 * 비밀글 제외 체크박스 클릭
 * @param {object} page - Puppeteer page 객체
 * @param {boolean} excludeSecret - 비밀글 제외 여부
 */
async function clickExcludeSecretCheckbox(page, excludeSecret) {
  if (excludeSecret) {
    console.log(`[NaverQnAExtractor] 비밀글 제외 체크박스가 선택되어 있습니다. 체크박스를 클릭합니다...`);
    try {
      const checkboxClicked = await page.evaluate(() => {
        const checkbox = document.querySelector('input[type="checkbox"][id="qnaSecret"]');
        if (checkbox && !checkbox.checked) {
          checkbox.click();
          return true;
        }
        return false;
      });
      
      if (checkboxClicked) {
        console.log(`[NaverQnAExtractor] ✅ 비밀글 제외 체크박스를 클릭했습니다.`);
        // 체크박스 클릭 후 페이지 로딩 대기
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(`[NaverQnAExtractor] ⚠️ 비밀글 제외 체크박스를 찾을 수 없거나 이미 선택되어 있습니다.`);
      }
    } catch (error) {
      console.log(`[NaverQnAExtractor] ⚠️ 비밀글 제외 체크박스 클릭 중 오류: ${error.message}`);
    }
  } else {
    console.log(`[NaverQnAExtractor] 비밀글 제외 체크박스가 선택되지 않았습니다.`);
  }
}

/**
 * Q&A 리스트 추출 및 상세 내용 크롤링
 * @param {object} page - Puppeteer page 객체
 * @param {boolean} excludeSecret - 비밀글 제외 여부
 * @returns {Promise<Array<object>>} 추출된 Q&A 데이터 배열
 */
export async function extractAllQnAs(page, excludeSecret = false) {
  const allQnAs = []; // 수집한 Q&A 데이터 배열
  
  try {
    // Q&A 탭 로딩 대기
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 비밀글 제외 체크박스 확인 및 클릭
    await clickExcludeSecretCheckbox(page, excludeSecret);
    
    // 먼저 기본 정보 추출
    const qnaList = await page.evaluate(() => {
      const items = [];
      const listItems = document.querySelectorAll('ul.GGh6cWty5B > li.US1r5ZhKHv');
      
      listItems.forEach((item, index) => {
        const answerStatus = item.querySelector('div.ZWnjTIgQbe')?.textContent?.trim() || '';
        const titleElement = item.querySelector('div.X59BRDJMf2 > a > span.mBAnjcgCAm > span.u5LpLpO6OE');
        const title = titleElement?.textContent?.trim() || '';
        const author = item.querySelector('div.mOPZSaJl4b')?.textContent?.trim() || '';
        const date = item.querySelector('div.ysDyZDZUJu')?.textContent?.trim() || '';
        const titleLink = item.querySelector('div.X59BRDJMf2 > a');
        
        // 비밀글 여부 확인 (제목이 "비밀글입니다."이거나 링크에 _TrftBjfAx 클래스가 있는 경우)
        const isSecret = title === '비밀글입니다.' || (titleLink && titleLink.classList.contains('_TrftBjfAx'));
        
        items.push({
          index,
          answerStatus,
          title,
          author,
          date,
          hasLink: !!titleLink,
          isSecret
        });
      });
      
      return items;
    });
    
    console.log(`[NaverQnAExtractor] 📋 추출된 Q&A 개수: ${qnaList.length}`);
    
    // 각 Q&A 항목을 클릭하고 상세 내용 추출
    for (let i = 0; i < qnaList.length; i++) {
      const qna = qnaList[i];
      
      // 비밀글 여부 확인
      const isSecret = qna.isSecret;
      
      // 비밀글인 경우 클릭하지 않고 기본 정보만 저장
      if (isSecret) {
        console.log(`[NaverQnAExtractor] Q&A ${i + 1}: 비밀글입니다. 클릭하지 않고 기본 정보만 저장합니다. (작성자: ${qna.author}, 작성일: ${qna.date})`);
        
        const qnaData = {
          answerStatus: qna.answerStatus,
          title: qna.title,
          author: qna.author,
          date: qna.date,
          question: '비밀글입니다.',
          answer: '',
          answerAuthor: '',
          answerDate: '',
          isSecret: true
        };
        
        allQnAs.push(qnaData);
        console.log(`[NaverQnAExtractor] Q&A ${i + 1}: 비밀글 기본 정보 저장 완료`);
        continue; // 비밀글은 클릭하지 않고 다음 항목으로
      }
      
      try {
        // 제목 링크 클릭
        const clicked = await page.evaluate((index) => {
          const listItems = document.querySelectorAll('ul.GGh6cWty5B > li.US1r5ZhKHv');
          if (index >= listItems.length) return false;
          
          const item = listItems[index];
          const titleLink = item.querySelector('div.X59BRDJMf2 > a');
          if (titleLink) {
            titleLink.click();
            return true;
          }
          return false;
        }, i);
        
        if (!clicked) {
          console.log(`[NaverQnAExtractor] Q&A ${i + 1}: 제목 링크를 찾을 수 없습니다.`);
          continue;
        }
        
        // 펼쳐질 때까지 대기
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // aria-expanded가 true가 될 때까지 대기 (최대 3초)
        let expanded = false;
        for (let waitCount = 0; waitCount < 6; waitCount++) {
          expanded = await page.evaluate((index) => {
            const listItems = document.querySelectorAll('ul.GGh6cWty5B > li.US1r5ZhKHv');
            if (index >= listItems.length) return false;
            const item = listItems[index];
            return item.getAttribute('aria-expanded') === 'true';
          }, i);
          
          if (expanded) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        if (!expanded) {
          console.log(`[NaverQnAExtractor] Q&A ${i + 1}: 펼쳐지지 않았습니다.`);
          continue;
        }
        
        // 상세 내용 추출
        const detail = await page.evaluate((index) => {
          const listItems = document.querySelectorAll('ul.GGh6cWty5B > li.US1r5ZhKHv');
          if (index >= listItems.length) return null;
          
          const item = listItems[index];
          
          // 질문 내용
          const questionElement = item.querySelector('div.Covx0ErD70 > div.VU7ivWBaeC > p.Db5mhQ9Y2S');
          const question = questionElement?.textContent?.trim() || '';
          
          // 답변 내용
          const answerElement = item.querySelector('div.Covx0ErD70 > div.X0_luDBHRA > div.FbrjsQ_5Kt > p.Db5mhQ9Y2S');
          const answer = answerElement?.textContent?.trim() || '';
          
          // 답변 작성자 (판매자)
          const answerAuthorElement = item.querySelector('div.Covx0ErD70 > div.X0_luDBHRA > div.f8TdRCqMqv');
          const answerAuthor = answerAuthorElement?.textContent?.trim() || '';
          
          // 답변 작성일
          const answerDateElement = item.querySelector('div.Covx0ErD70 > div.X0_luDBHRA > div.HUQ3Rc4mKQ');
          const answerDate = answerDateElement?.textContent?.trim() || '';
          
          return {
            question,
            answer,
            answerAuthor,
            answerDate
          };
        }, i);
        
        if (detail) {
          // Q&A 데이터 객체 생성
          const qnaData = {
            answerStatus: qna.answerStatus,
            title: qna.title,
            author: qna.author,
            date: qna.date,
            question: detail.question || qna.title || '',
            answer: detail.answer || '',
            answerAuthor: detail.answerAuthor || '',
            answerDate: detail.answerDate || '',
            isSecret: false
          };
          
          allQnAs.push(qnaData);
          
          console.log(`[NaverQnAExtractor] Q&A ${i + 1}:`);
          console.log(`  - 답변상태: ${qna.answerStatus}`);
          console.log(`  - 제목: ${qna.title}`);
          console.log(`  - 작성자: ${qna.author}`);
          console.log(`  - 작성일: ${qna.date}`);
          console.log(`  - 질문 내용: ${detail.question || qna.title || ''}`);
          console.log(`  - 답변 내용: ${detail.answer || '(없음)'}`);
          console.log(`  - 답변 작성자: ${detail.answerAuthor || '(없음)'}`);
          console.log(`  - 답변 작성일: ${detail.answerDate || '(없음)'}`);
        } else {
          console.log(`[NaverQnAExtractor] Q&A ${i + 1}: 상세 내용을 추출할 수 없습니다.`);
        }
        
        // 다음 항목을 위해 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`[NaverQnAExtractor] Q&A ${i + 1} 처리 중 오류: ${error.message}`);
      }
    }
    
    console.log(`[NaverQnAExtractor] ✅ 총 ${allQnAs.length}개의 Q&A를 추출했습니다.`);
    return allQnAs;
    
  } catch (error) {
    console.error(`[NaverQnAExtractor] ❌ Q&A 추출 중 오류: ${error.message}`);
    return allQnAs;
  }
}

