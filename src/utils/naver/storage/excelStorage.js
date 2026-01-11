/**
 * Excel 저장 관련 유틸리티
 */
import { mkdir } from 'fs/promises';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { removeDuplicateReviews, getStorageDirectory } from './common.js';

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
    
    // 리뷰 데이터를 Excel 형식으로 변환
    // Photos 배열을 문자열로 변환
    const excelData = uniqueReviews.map(review => {
      const row = { ...review };
      // Photos 배열을 쉼표로 구분된 문자열로 변환
      if (Array.isArray(row.Photos)) {
        row.Photos = row.Photos.join(', ');
      }
      return row;
    });
    
    // 워크북 생성
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // 컬럼 너비 자동 조정
    const columnWidths = Object.keys(excelData[0]).map(key => ({
      wch: Math.max(key.length, 20)
    }));
    worksheet['!cols'] = columnWidths;
    
    // 워크시트 추가
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reviews');
    
    // 파일명 결정: 청크 번호가 있으면 reviews_chunk_N.xlsx 형식, 없으면 기존 형식
    let filepath;
    if (chunkNumber !== null && chunkNumber > 0) {
      filepath = join(storageDir, `${filename}_chunk_${chunkNumber}.xlsx`);
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      filepath = join(storageDir, `${filename}_${timestamp}.xlsx`);
    }
    
    // Excel 파일로 저장
    XLSX.writeFile(workbook, filepath);
    
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

