/**
 * 라이선스 키 발급 스크립트 (관리자용)
 * 사용법: node create-license.mjs --name "홍길동" --plan 2
 *   plan: 1=네이버만, 2=네이버+쿠팡
 */
import { MongoClient } from 'mongodb';

const MONGO_URI = 'mongodb+srv://coq3820:JmbIOcaEOrvkpQo1@cluster0.qj1ty.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'client_db';
const COL_LICENSE = 'review_crawler_license';

function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `RC-${part(3)}${part(3)}`;
}

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const planIdx = args.indexOf('--plan');

const userName = nameIdx !== -1 ? args[nameIdx + 1] : null;
const plan = planIdx !== -1 ? parseInt(args[planIdx + 1]) : 1;

if (!userName) {
  console.error('사용법: node create-license.mjs --name "홍길동" --plan 2');
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
await client.connect();
const col = client.db(DB_NAME).collection(COL_LICENSE);

// 중복 없는 키 생성
let licenseKey;
do {
  licenseKey = generateKey();
} while (await col.findOne({ licenseKey }));

await col.insertOne({
  licenseKey,
  plan,
  active: true,
  createdAt: new Date(),
  memo: userName,
});

console.log('\n========================================');
console.log('✅ 라이선스 발급 완료');
console.log('========================================');
console.log(`이름:  ${userName}`);
console.log(`키:    ${licenseKey}`);
console.log(`플랜:  ${plan === 2 ? '2 (네이버+쿠팡)' : '1 (네이버만)'}`);
console.log('========================================\n');

await client.close();
