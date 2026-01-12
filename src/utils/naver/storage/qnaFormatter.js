/**
 * QnA 데이터 포맷팅 유틸리티
 */

/**
 * 날짜 형식 변환 (2025.10.30. -> 2025-10-30)
 * @param {string} dateStr - 날짜 문자열
 * @returns {string} 변환된 날짜 문자열
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  
  // "2025.10.30." 형식을 "2025-10-30" 형식으로 변환
  const cleaned = dateStr.replace(/\./g, '').trim();
  if (cleaned.length >= 8) {
    const year = cleaned.substring(0, 4);
    const month = cleaned.substring(4, 6);
    const day = cleaned.substring(6, 8);
    return `${year}-${month}-${day}`;
  }
  
  return dateStr;
}

/**
 * QnA 데이터를 새로운 형식으로 변환
 * @param {Array<object>} qnaList - 기존 QnA 데이터 배열
 * @returns {Array<object>} 변환된 QnA 데이터 배열
 */
export function formatQnAData(qnaList) {
  if (!qnaList || qnaList.length === 0) {
    return [];
  }
  
  const formattedQnAs = [];
  let threadCounter = 1;
  
  for (const qna of qnaList) {
    // 날짜 형식 변환
    const questionDate = formatDate(qna.date || '');
    const answerDate = formatDate(qna.answerDate || '');
    
    // threadId 생성 (QNA-{date}-{순번})
    const dateForId = questionDate || answerDate || new Date().toISOString().split('T')[0];
    const threadId = `QNA-${dateForId.replace(/-/g, '')}-${String(threadCounter).padStart(4, '0')}`;
    threadCounter++;
    
    // status 결정
    let status = 'pending';
    const answerStatusText = qna.answerStatus || '';
    if (answerStatusText.includes('미답변')) {
      status = 'unanswered';
    } else if (answerStatusText.includes('답변완료')) {
      status = 'answered';
    }
    
    // messages 배열 생성
    const messages = [];
    
    // 질문 메시지 추가 (비밀글도 포함)
    if (qna.question || qna.title) {
      messages.push({
        type: 'question',
        author: qna.author || '',
        role: 'customer',
        date: questionDate,
        content: qna.question || qna.title || ''
      });
    }
    
    // 답변 메시지 추가 (있는 경우, 비밀글은 답변이 없을 수 있음)
    if (qna.answer && qna.answerAuthor) {
      messages.push({
        type: 'answer',
        author: qna.answerAuthor || '판매자',
        role: 'seller',
        date: answerDate,
        content: qna.answer
      });
    }
    
    // 변환된 QnA 객체 생성
    const formattedQna = {
      threadId,
      status,
      messages
    };
    
    formattedQnAs.push(formattedQna);
  }
  
  console.log(`[QnAFormatter] QnA 데이터 변환 완료: ${qnaList.length}개 → ${formattedQnAs.length}개`);
  return formattedQnAs;
}

