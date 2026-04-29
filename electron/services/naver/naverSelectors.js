/**
 * 네이버 스마트스토어 리뷰 모달 신규 셀렉터/보정 헬퍼 모음
 */

export const REVIEW = {
  // 모달 식별 (dialog 다중 존재 가능 — id-pattern으로 식별)
  DIALOG_ITEM_ID_PREFIX: 'REVIEW_ITEM_',
  modalDialogSelector: 'li[id^="REVIEW_ITEM_"]',  // 이게 안에 있어야 리뷰 모달
  closeButtonSelector: 'button.ohszb8eHEV',  // 텍스트 "닫기"

  // 진입 트리거 (페이지 본문에 있는 버튼, 텍스트 매칭)
  openModalButtonText: '리뷰 전체보기',

  // 모달 내부 구조
  scrollContainerSelector: 'div.ckqgS03UN6',  // overflowY:auto
  reviewItemSelector: 'li.N9LWAcN4hj',  // === li[id^="REVIEW_ITEM_"]

  // 리뷰 필드
  scoreContainer: 'div.F6N7Rr56mQ',  // textContent 직접 사용 금지 — firstChild.nodeValue 또는 정규식
  authorDateContainer: 'div.dgOMiF9qbL',  // 안에 span.sDXjr3m0LZ가 2개 (1번째: 작성자, 2번째: 날짜)
  authorDateSpan: 'span.sDXjr3m0LZ',
  contentParagraph: 'p.Uv4T3VkhKU',  // === p[id^="review_content_"]
  reviewTypeBadge: 'em.FJNePG7vwX',  // textContent에 "한달사용" 또는 "재구매" (옛 한달+재구매 분기 유지)

  // 사진
  photoListItem: 'li.uVSJ8fwmPd',  // 캐러셀 안의 사진 li
  photoImg: 'img.G6QVe8dT5G',  // src/data-src로 URL 추출

  // 정렬
  currentSortLabel: 'li.ro3GJ_QEfF button.YM3lYgYggL',  // 정렬 옵션 컨테이너 한정 ('전체' 필터 버튼과 동일 클래스 충돌 회피)
  sortOptionButton: 'button.laRRkiyiCf',  // 클릭 가능한 정렬 옵션들
  sortOptionTextRanking: '랭킹순정렬하기',
  sortOptionTextLatest: '최신순정렬하기',
  sortOptionTextHigh: '평점 높은순정렬하기',
  sortOptionTextLow: '평점 낮은순정렬하기',
};

// 보정 헬퍼
export function extractScore(el) {
  // div.F6N7Rr56mQ는 자식 em이 "한달사용" 등을 가질 수 있어 textContent 노이즈 발생
  // firstChild가 텍스트 노드면 그 nodeValue를, 아니면 정규식으로 1~5 추출
  if (!el) return '';
  const first = el.firstChild;
  if (first && first.nodeType === 3 && first.nodeValue) {
    const m = first.nodeValue.match(/[1-5]/);
    if (m) return m[0];
  }
  const m = (el.textContent || '').match(/[1-5]/);
  return m ? m[0] : '';
}

export function extractDate(text) {
  // 새 형식: YY.MM.DD. (예: "26.04.25.")
  if (!text) return '';
  const m = text.match(/\d{2}\.\d{2}\.\d{2}\.?/);
  return m ? m[0] : text.trim();
}

export function isReviewModal(dialog) {
  return !!dialog?.querySelector('li[id^="REVIEW_ITEM_"]');
}
