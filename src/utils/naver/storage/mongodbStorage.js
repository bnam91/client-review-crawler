/**
 * MongoDB 저장 관련 유틸리티
 */

/**
 * 리뷰 데이터를 MongoDB에 저장
 * @param {Array<object>} reviews - 리뷰 데이터 배열
 * @param {string} collectionName - 컬렉션 이름 (기본값: 'reviews')
 * @param {string} uri - MongoDB 연결 URI
 * @returns {Promise<boolean>} 저장 성공 여부
 */
export async function saveReviewsToMongoDB(reviews, collectionName = 'reviews', uri = '') {
  try {
    if (!uri || uri.trim() === '') {
      throw new Error('MongoDB URI가 지정되지 않았습니다.');
    }
    
    console.log(`[MongoDBStorage] MongoDB 저장 시작...`);
    console.log(`[MongoDBStorage] URI: ${uri}`);
    console.log(`[MongoDBStorage] 컬렉션: ${collectionName}`);
    console.log(`[MongoDBStorage] 저장할 리뷰 수: ${reviews.length}개`);
    
    // TODO: MongoDB 연결 및 저장 로직 구현
    // const { MongoClient } = require('mongodb');
    // const client = new MongoClient(uri);
    // await client.connect();
    // const db = client.db();
    // const collection = db.collection(collectionName);
    // await collection.insertMany(reviews);
    // await client.close();
    
    console.log(`[MongoDBStorage] ⚠️ MongoDB 저장은 아직 구현되지 않았습니다.`);
    return false;
  } catch (error) {
    console.error(`[MongoDBStorage] ❌ MongoDB 저장 실패: ${error.message}`);
    throw error;
  }
}

