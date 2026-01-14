# 빌드 및 배포 가이드

## 개발 모드 실행
```bash
npm install
npm run dev
```

## 프로덕션 빌드

### 전체 플랫폼 빌드
```bash
npm run build:all
```

### 플랫폼별 빌드
```bash
# macOS만
npm run build:mac

# Windows만
npm run build:win

# Linux만
npm run build:linux
```

## 빌드 산출물

빌드된 파일은 `dist/` 폴더에 생성됩니다:

- **macOS**: `.dmg`, `.zip`
- **Windows**: `.exe` (NSIS 설치 프로그램), `.exe` (Portable)
- **Linux**: `.AppImage`, `.deb`, `.rpm`

## 아이콘 설정

배포 전에 `assets/icons/` 폴더에 아이콘 파일을 추가하세요:
- macOS: `icon.icns`
- Windows: `icon.ico`
- Linux: `icon.png`

자세한 내용은 `assets/icons/README.md`를 참고하세요.

## package.json 설정 수정

배포 전에 `package.json`의 다음 항목을 수정하세요:
- `name`: 앱 이름 (소문자, 하이픈 사용)
- `version`: 버전 번호
- `description`: 앱 설명
- `author`: 작성자 정보
- `build.appId`: 고유한 앱 ID (예: `com.yourcompany.appname`)
- `build.productName`: 사용자에게 보이는 앱 이름

## macOS 실행 문제 해결

### 문제: 구글 드라이브 등에서 다운로드한 앱이 실행되지 않음

macOS Gatekeeper가 인터넷에서 다운로드한 앱을 차단할 수 있습니다.

#### 해결 방법 1: Quarantine 속성 제거 (권장)

터미널에서 다음 명령어 실행:

```bash
# .app 파일인 경우
xattr -cr /path/to/review-crawler.app

# .dmg 파일인 경우 (마운트 후)
xattr -cr /Volumes/review-crawler/review-crawler.app
```

#### 해결 방법 2: 우클릭으로 실행

1. Finder에서 앱을 찾기
2. 우클릭 → "열기" 선택
3. 보안 경고에서 "열기" 클릭

#### 해결 방법 3: 시스템 설정에서 허용

1. 시스템 설정 → 개인 정보 보호 및 보안
2. "확인되지 않은 개발자의 앱 허용" 활성화 (있는 경우)

### 코드 서명 및 공증 (선택사항)

Apple Developer 계정이 있다면 코드 서명을 추가할 수 있습니다:

1. `package.json`의 `build.mac` 섹션에 추가:
```json
"mac": {
  "identity": "Developer ID Application: Your Name (TEAM_ID)",
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist"
}
```

2. Notarization 설정 (환경 변수):
```bash
export APPLE_ID="your@email.com"
export APPLE_ID_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAM_ID"
```

3. 빌드 시 자동 공증:
```bash
npm run build:mac
```
