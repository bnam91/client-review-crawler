/**
 * Excel 저장 관련 유틸리티
 */
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { removeDuplicateReviews, getStorageDirectory } from './common.js';

/**
 * ★사진 열 배치 (v1.7.2) — 「사진(그림) / 사진수 / 사진주소」 3열.
 *
 * 왜 그림을 «H열 그대로» 두고 새 열을 오른쪽에 붙였나:
 *  - 그림 삽입은 열 인덱스(col:7)와 그 열의 width(=87px 계산)에 «둘 다» 묶여 있다.
 *    그림 열을 옮기면 인덱스·폭 계산·행 높이(75pt)를 전부 다시 맞춰야 하고, 어긋나면
 *    「파일은 생겼는데 그림이 엉뚱한 칸에」가 된다(v1.7.0 사고와 같은 종류의 무증상 결함).
 *  - 새 열을 «오른쪽 끝»에 붙이면 기존 좌표계가 그대로라 그림은 손댈 필요가 없고,
 *    사진주소(긴 텍스트)도 맨 오른쪽이라 표를 읽는 데 방해가 안 된다.
 *
 * 열 인덱스(0-based): 7=사진(그림), 8=사진수, 9=사진주소
 */
const PHOTO_IMAGE_COL_LETTER = 'H';
const PHOTO_IMAGE_COL_INDEX = 7; // ExcelJS addImage는 0-based
// 사진주소 구분자 — 개행. 셀에 wrapText가 걸려 있어 한 줄에 하나씩 보인다.
const PHOTO_URL_SEPARATOR = '\n';

/**
 * 값을 배열로 정규화 (배열 / 쉼표구분 문자열 / 빈 값 모두 허용)
 * @param {any} value
 * @returns {string[]}
 */
function toPathList(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim() !== '');
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(',').map((p) => p.trim()).filter((p) => p);
  }
  return [];
}

/**
 * 리뷰 한 건의 «사진 주소»(원본 URL)와 «사진 수»를 뽑는다.
 *
 * ★사진주소는 «다운로드 여부와 무관하게» 항상 남는다 — PhotoUrls는 추출 단계에서
 *   원본 URL을 그대로 담아 두기 때문(이미지 OFF/주소만 모드에서도 채워진다).
 * ★구버전/타 플랫폼 호환: PhotoUrls가 없으면 Photos에서 http(s)로 시작하는 항목만 주소로 인정한다
 *   (Photos는 다운로드 성공 시 «로컬 경로»가 들어가므로 주소가 아니다).
 *
 * @param {object} review
 * @returns {{urls: string[], count: number}} count = 이 리뷰가 «가진» 사진 수 (0 포함, 항상 채움)
 */
function getPhotoInfo(review) {
  const urlsFromField = toPathList(review.PhotoUrls);
  const photos = toPathList(review.Photos);

  if (urlsFromField.length > 0) {
    return { urls: urlsFromField, count: urlsFromField.length };
  }
  // PhotoUrls 자체가 «있는데 비었으면» 사진 0장이 확정이다 (추정하지 않는다).
  if (review.PhotoUrls !== undefined && review.PhotoUrls !== null) {
    return { urls: [], count: 0 };
  }
  const urlLike = photos.filter((p) => /^https?:\/\//i.test(p));
  return { urls: urlLike, count: photos.length };
}

/**
 * 리뷰 이미지를 엑셀에 삽입
 * @param {ExcelJS.Worksheet} worksheet - 워크시트 객체
 * @param {object} review - 리뷰 데이터 객체
 * @param {number} rowIndex - 행 인덱스 (1부터 시작)
 */
async function insertReviewImage(worksheet, review, rowIndex) {
  try {
    let firstPhotoPath = null;
    
    // Photos 배열에서 첫 번째 이미지 경로 가져오기
    if (Array.isArray(review.Photos) && review.Photos.length > 0) {
      firstPhotoPath = review.Photos[0];
    } else if (typeof review.Photos === 'string' && review.Photos.trim() !== '') {
      // 문자열인 경우 (쉼표로 구분된 경로들)
      const paths = review.Photos.split(',').map(p => p.trim()).filter(p => p);
      if (paths.length > 0) {
        firstPhotoPath = paths[0];
      }
    }
    
    if (!firstPhotoPath || !existsSync(firstPhotoPath)) {
      return;
    }
    
    try {
      // 이미지 로드 및 처리
      const imageBuffer = await sharp(firstPhotoPath)
        .resize(null, null, { withoutEnlargement: true })
        .toBuffer();
      
      const metadata = await sharp(imageBuffer).metadata();
      const origWidth = metadata.width;
      const origHeight = metadata.height;
      
      // 중앙 정사각형 크롭
      const side = Math.min(origWidth, origHeight);
      const left = Math.floor((origWidth - side) / 2);
      const top = Math.floor((origHeight - side) / 2);
      
      // 정사각형으로 크롭
      const croppedBuffer = await sharp(imageBuffer)
        .extract({ left, top, width: side, height: side })
        .toBuffer();
      
      // 셀 크기 기준 제한
      const colWidthChars = worksheet.getColumn(PHOTO_IMAGE_COL_LETTER).width || 12;
      const maxCellWidthPx = Math.max(1, Math.floor(colWidthChars * 7 + 5));
      const maxCellHeightPx = Math.max(1, Math.floor(75 * 4 / 3));
      const targetPx = Math.max(1, Math.min(maxCellWidthPx - 2, maxCellHeightPx - 2));
      
      // 정사각형 리사이즈
      const resizedBuffer = await sharp(croppedBuffer)
        .resize(targetPx, targetPx, { fit: 'fill' })
        .png()
        .toBuffer();
      
      // 엑셀에 이미지 삽입
      const imageId = worksheet.workbook.addImage({
        buffer: resizedBuffer,
        extension: 'png',
      });
      
      worksheet.addImage(imageId, {
        // ★열 인덱스는 상수로 고정 — 열이 늘어나도 «사진» 열을 벗어나지 않게 한 곳에서 관리한다.
        tl: { col: PHOTO_IMAGE_COL_INDEX, row: rowIndex - 1 }, // H열 = 인덱스 7 (0부터 시작)
        ext: { width: targetPx, height: targetPx }
      });
      
      console.log(`[ExcelStorage] 이미지 삽입 완료: ${firstPhotoPath} (${targetPx}x${targetPx})`);
    } catch (error) {
      console.error(`[ExcelStorage] 이미지 처리 실패: ${error.message}`);
    }
  } catch (error) {
    console.error(`[ExcelStorage] 이미지 삽입 실패: ${error.message}`);
  }
}

/**
 * 리뷰 데이터를 Excel 파일로 저장
 * @param {Array<object>} reviews - 리뷰 데이터 배열
 * @param {string} filename - 저장할 파일명 (확장자 제외)
 * @param {string} customPath - 저장 경로 (선택)
 * @param {number} chunkNumber - 청크 번호 (50페이지 단위, 선택)
 * @returns {Promise<string>} 저장된 파일 경로
 */
export async function saveReviewsToExcel(reviews, filename = 'reviews', customPath = '', chunkNumber = null) {
  try {
    const storageDir = getStorageDirectory(customPath);
    
    console.log(`[ExcelStorage] 저장 디렉토리: ${storageDir}`);
    
    // 저장 폴더가 없으면 생성
    try {
      await mkdir(storageDir, { recursive: true });
      console.log(`[ExcelStorage] 저장 폴더 생성/확인: ${storageDir}`);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
    
    // 중복 제거
    const uniqueReviews = removeDuplicateReviews(reviews);
    
    if (uniqueReviews.length === 0) {
      console.log(`[ExcelStorage] ⚠️ 저장할 리뷰가 없습니다.`);
      return null;
    }
    
    // ExcelJS 워크북 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reviews');
    
    // 컬럼 정의
    const columns = [
      { header: 'Page_Review', key: 'Page_Review', width: 15 },
      { header: 'Review Score', key: 'Review Score', width: 12 },
      { header: 'Reviewer Name', key: 'Reviewer Name', width: 15 },
      { header: 'Review Date', key: 'Review Date', width: 15 },
      { header: 'Product(Option) Name', key: 'Product(Option) Name', width: 25 },
      { header: 'Review Type', key: 'Review Type', width: 15 },
      { header: 'Content', key: 'Content', width: 60 },
      // ★H열 = 그림 삽입 전용 (열 인덱스 7 고정, 87×87 계산이 이 width에 묶여 있다)
      { header: '사진', key: 'Photo', width: 12 },
      // ★사진수 = 항상 채운다(0 포함). 정렬·필터로 「사진 있는 리뷰만」 고르는 용도.
      { header: '사진수', key: 'PhotoCount', width: 8 },
      // ★사진주소 = 항상 채운다. 사진을 받든 안 받든 원본 URL은 남는다.
      { header: '사진주소', key: 'PhotoUrls', width: 50 }
    ];
    
    worksheet.columns = columns;
    
    // 헤더 스타일 설정
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // 리뷰 데이터 추가
    let startRow = 2; // 헤더 다음 행부터
    
    for (let i = 0; i < uniqueReviews.length; i++) {
      const review = uniqueReviews[i];
      
      // Page_Review 컬럼 값 생성
      // 1순위: extractor에서 채운 review.Page_Review (100% 채움 보장)
      // 2순위: 이미지 파일명에서 페이지 정보 추출 (구버전 호환)
      let pageReview = review['Page_Review'] || '';
      if (!pageReview) {
        if (Array.isArray(review.Photos) && review.Photos.length > 0) {
          const firstPhoto = review.Photos[0];
          // 파일명 형식: review_page{페이지번호}_{리뷰순서}_photo_{사진순서}.jpg
          const match = firstPhoto.match(/review_page(\d+)_(\d+)_photo_/);
          if (match) {
            pageReview = `${match[1]}_${match[2]}`;
          }
        } else if (typeof review.Photos === 'string' && review.Photos.trim() !== '') {
          const paths = review.Photos.split(',').map(p => p.trim()).filter(p => p);
          if (paths.length > 0) {
            const match = paths[0].match(/review_page(\d+)_(\d+)_photo_/);
            if (match) {
              pageReview = `${match[1]}_${match[2]}`;
            }
          }
        }
      }
      
      // 사진 정보 — 수/주소는 «다운로드 여부와 무관하게» 항상 기록한다.
      const photoInfo = getPhotoInfo(review);

      const row = worksheet.addRow({
        'Page_Review': pageReview,
        'Review Score': review['Review Score'] || '',
        'Reviewer Name': review['Reviewer Name'] || '',
        'Review Date': review['Review Date'] || '',
        'Product(Option) Name': review['Product(Option) Name'] || '',
        'Review Type': review['Review Type'] || '',
        'Content': review['Content'] || '',
        'Photo': '', // 이미지는 별도로 삽입 (H열)
        'PhotoCount': photoInfo.count, // ★숫자로 넣는다 — 정렬/필터가 되어야 하므로 문자열 금지
        'PhotoUrls': photoInfo.urls.join(PHOTO_URL_SEPARATOR)
      });
      
      // 행 높이 설정 (75pt)
      row.height = 75;
      
      // 셀 스타일 설정
      row.alignment = { vertical: 'top', wrapText: true };
      
      // 이미지 삽입
      await insertReviewImage(worksheet, review, startRow);
      
      startRow++;
    }
    
    // 파일명 결정: 청크 번호가 있으면 reviews_chunk_N.xlsx 형식, 없으면 기존 형식
    let filepath;
    if (chunkNumber !== null && chunkNumber > 0) {
      filepath = join(storageDir, `${filename}_chunk_${chunkNumber}.xlsx`);
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      filepath = join(storageDir, `${filename}_${timestamp}.xlsx`);
    }
    
    // Excel 파일로 저장
    await workbook.xlsx.writeFile(filepath);
    
    console.log(`[ExcelStorage] ✅ Excel 저장 완료: ${filepath}`);
    console.log(`[ExcelStorage] 저장된 리뷰 수: ${uniqueReviews.length}개`);
    if (chunkNumber !== null) {
      console.log(`[ExcelStorage] 청크 번호: ${chunkNumber}`);
    }
    
    return filepath;
  } catch (error) {
    console.error(`[ExcelStorage] ❌ Excel 저장 실패: ${error.message}`);
    throw error;
  }
}

/**
 * QnA 데이터를 Excel 파일로 저장 (메시지 단위로 행 생성)
 * @param {Array<object>} qnaList - QnA 데이터 배열 (formatQnAData로 변환된 형식)
 * @param {string} filename - 저장할 파일명 (확장자 제외)
 * @param {string} customPath - 저장 경로 (선택)
 * @returns {Promise<string>} 저장된 파일 경로
 */
export async function saveQnAToExcel(qnaList, filename = 'naver_qna', customPath = '') {
  try {
    const storageDir = getStorageDirectory(customPath);
    
    console.log(`[ExcelStorage] QnA 저장 디렉토리: ${storageDir}`);
    
    // 저장 폴더가 없으면 생성
    try {
      await mkdir(storageDir, { recursive: true });
      console.log(`[ExcelStorage] 저장 폴더 생성/확인: ${storageDir}`);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
    
    if (!qnaList || qnaList.length === 0) {
      console.log(`[ExcelStorage] ⚠️ 저장할 QnA가 없습니다.`);
      return null;
    }
    
    // ExcelJS 워크북 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('QnA');
    
    // 컬럼 정의
    const columns = [
      { header: 'Page_Review', key: 'Page_Review', width: 15 },
      { header: 'threadId', key: 'threadId', width: 20 },
      { header: '유형', key: 'type', width: 12 },
      { header: '역할', key: 'role', width: 12 },
      { header: '작성자', key: 'author', width: 20 },
      { header: '작성일', key: 'date', width: 15 },
      { header: '내용', key: 'content', width: 80 }
    ];
    
    worksheet.columns = columns;
    
    // 헤더 스타일 설정
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // QnA 데이터를 메시지 단위로 행으로 변환
    let rowCount = 0;
    
    for (const qna of qnaList) {
      const threadId = qna.threadId || '';
      
      // messages 배열의 각 메시지를 행으로 추가
      if (Array.isArray(qna.messages) && qna.messages.length > 0) {
        for (const message of qna.messages) {
          const row = worksheet.addRow({
            Page_Review: qna.Page_Review || '',
            threadId: threadId,
            type: message.type || '',
            role: message.role || '',
            author: message.author || '',
            date: message.date || '',
            content: message.content || ''
          });
          
          // 행 높이 설정 (내용에 따라 자동 조정)
          row.height = 60;
          
          // 셀 스타일 설정
          row.alignment = { vertical: 'top', wrapText: true };
          
          rowCount++;
        }
      } else {
        // messages가 없는 경우에도 기본 정보라도 저장
        const row = worksheet.addRow({
          Page_Review: qna.Page_Review || '',
          threadId: threadId,
          type: '',
          role: '',
          author: '',
          date: '',
          content: ''
        });
        
        row.height = 60;
        row.alignment = { vertical: 'top', wrapText: true };
        rowCount++;
      }
    }
    
    // 파일명 결정
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filepath = join(storageDir, `${filename}_${timestamp}.xlsx`);
    
    // Excel 파일로 저장
    await workbook.xlsx.writeFile(filepath);
    
    console.log(`[ExcelStorage] ✅ QnA Excel 저장 완료: ${filepath}`);
    console.log(`[ExcelStorage] 저장된 메시지 수: ${rowCount}개 (QnA ${qnaList.length}개)`);
    
    return filepath;
  } catch (error) {
    console.error(`[ExcelStorage] ❌ QnA Excel 저장 실패: ${error.message}`);
    throw error;
  }
}
