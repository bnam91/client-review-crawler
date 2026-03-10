/**
 * 라이선스 인증 서비스
 * - DB: client_db
 * - review_crawler_license: 발급된 키 목록 (관리자 관리)
 * - review_crawler: 유저 정보 + 등록 IP 목록
 */
import { MongoClient } from 'mongodb';

const MONGO_URI = 'mongodb+srv://coq3820:JmbIOcaEOrvkpQo1@cluster0.qj1ty.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'client_db';
const COL_LICENSE = 'review_crawler_license';
const COL_USER = 'review_crawler';
const MAX_IPS = 5;

let client = null;

async function getClient() {
  if (!client) {
    client = new MongoClient(MONGO_URI);
    await client.connect();
  }
  return client;
}

function getDb() {
  return client.db(DB_NAME);
}

/**
 * 현재 IP로 등록된 유저 조회
 * @returns {{ found: boolean, user?, error? }}
 */
export async function findUserByIp(ip) {
  try {
    await getClient();
    const user = await getDb().collection(COL_USER).findOne({
      'allowedIps.ip': ip,
    });
    if (!user) return { found: false };

    // 라이선스 활성 여부 확인
    const license = await getDb().collection(COL_LICENSE).findOne({
      licenseKey: user.licenseKey,
    });
    if (!license) return { found: false };
    if (!license.active) return { found: false, reason: 'inactive' };

    // lastAccessAt 업데이트
    await getDb().collection(COL_USER).updateOne(
      { licenseKey: user.licenseKey },
      { $set: { lastAccessAt: new Date() } }
    );

    return {
      found: true,
      user: {
        licenseKey: user.licenseKey,
        userId: user.userId,
        plan: license.plan,
        allowedIps: user.allowedIps,
      },
    };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

/**
 * 라이선스 키 유효성 확인 + 새 IP 등록
 * @returns {{ success: boolean, user?, reason?, allowedIps? }}
 */
export async function registerLicense(licenseKey, ip, userId = '') {
  try {
    await getClient();

    // 1. 라이선스 키 확인
    const license = await getDb().collection(COL_LICENSE).findOne({ licenseKey });
    if (!license) return { success: false, reason: 'invalid_key' };
    if (!license.active) return { success: false, reason: 'inactive' };

    // 2. 예약된 userId 차단
    const RESERVED_IDS = ['root', 'admin', 'manager'];
    if (userId && RESERVED_IDS.includes(userId.toLowerCase())) {
      return { success: false, reason: 'userId_reserved' };
    }

    // 3. userId 중복 확인 (다른 라이선스에 이미 등록된 userId인지)
    if (userId) {
      const takenBy = await getDb().collection(COL_USER).findOne({ userId, licenseKey: { $ne: licenseKey } });
      if (takenBy) return { success: false, reason: 'userId_taken' };
    }

    // 3. 기존 유저 도큐 확인
    const existing = await getDb().collection(COL_USER).findOne({ licenseKey });

    if (existing) {
      // 이미 이 IP가 등록된 경우
      const alreadyRegistered = existing.allowedIps.some(e => e.ip === ip);
      if (alreadyRegistered) {
        await getDb().collection(COL_USER).updateOne(
          { licenseKey },
          { $set: { lastAccessAt: new Date() } }
        );
        return {
          success: true,
          user: { licenseKey, userId: existing.userId, plan: license.plan, allowedIps: existing.allowedIps },
        };
      }

      // IP 5개 초과
      if (existing.allowedIps.length >= MAX_IPS) {
        return {
          success: false,
          reason: 'ip_limit',
          allowedIps: existing.allowedIps,
          userId: existing.userId,
        };
      }

      // IP 추가
      const newIpEntry = { ip, alias: '', registeredAt: new Date() };
      await getDb().collection(COL_USER).updateOne(
        { licenseKey },
        {
          $push: { allowedIps: newIpEntry },
          $set: { lastAccessAt: new Date(), ...(userId && { userId }) },
        }
      );
      const updated = existing.allowedIps.concat(newIpEntry);
      return {
        success: true,
        user: { licenseKey, userId: userId || existing.userId, plan: license.plan, allowedIps: updated },
      };
    }

    // 3. 신규 유저 도큐 생성
    const newUser = {
      licenseKey,
      userId,
      allowedIps: [{ ip, alias: '', registeredAt: new Date() }],
      lastAccessAt: new Date(),
    };
    await getDb().collection(COL_USER).insertOne(newUser);
    return {
      success: true,
      user: { licenseKey, userId, plan: license.plan, allowedIps: newUser.allowedIps },
      isNew: true,
    };
  } catch (e) {
    return { success: false, reason: 'error', error: e.message };
  }
}

/**
 * IP 별칭 업데이트
 */
export async function updateIpAlias(licenseKey, ip, alias) {
  try {
    await getClient();
    await getDb().collection(COL_USER).updateOne(
      { licenseKey, 'allowedIps.ip': ip },
      { $set: { 'allowedIps.$.alias': alias } }
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * IP 삭제 (기기 한도 초과 시 유저가 직접 삭제)
 */
export async function removeIp(licenseKey, ip) {
  try {
    await getClient();
    await getDb().collection(COL_USER).updateOne(
      { licenseKey },
      { $pull: { allowedIps: { ip } } }
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * userName 저장 (신규 등록 시)
 */
export async function updateUserName(licenseKey, userName) {
  try {
    await getClient();
    await getDb().collection(COL_USER).updateOne(
      { licenseKey },
      { $set: { userName } }
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 라이선스 키 신규 발급 (root 전용)
 * @returns {{ success: boolean, licenseKey?, reason? }}
 */
export async function createLicenseKey(plan, memo = '') {
  try {
    await getClient();

    // RC-XXXXXX 형식 고유 키 생성
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let licenseKey;
    let attempts = 0;
    do {
      const rand = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      licenseKey = `RC-${rand}`;
      const exists = await getDb().collection(COL_LICENSE).findOne({ licenseKey });
      if (!exists) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) return { success: false, reason: 'generate_failed' };

    await getDb().collection(COL_LICENSE).insertOne({
      licenseKey,
      plan,
      active: true,
      memo,
      createdAt: new Date(),
    });

    return { success: true, licenseKey };
  } catch (e) {
    return { success: false, reason: 'error', error: e.message };
  }
}

/**
 * 발급된 라이선스 키 목록 조회 (root 전용)
 */
export async function listLicenseKeys() {
  try {
    await getClient();
    const list = await getDb().collection(COL_LICENSE)
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();
    return { success: true, list };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function closeLicenseClient() {
  if (client) {
    await client.close();
    client = null;
  }
}
