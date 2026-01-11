# GitHub 설정 가이드

## ✅ 현재 설정 상태

현재 `electron-updater`를 사용하여 GitHub Releases에서 자동 업데이트를 체크하도록 설정되어 있습니다.

## 🔍 확인해야 할 사항

### 1. 리포지토리 공개 여부
- **공개 리포지토리**: ✅ 토큰 불필요 (현재 설정으로 충분)
- **비공개 리포지토리**: ❌ GitHub Token 필요

현재 리포지토리: `bnam91/client-review-crawler` - 공개 리포지토리이므로 **토큰 불필요** ✅

### 2. GitHub Releases에 파일 업로드

`electron-updater`가 작동하려면 **GitHub Releases에 실제 앱 파일**이 업로드되어 있어야 합니다.

#### 방법 1: 수동 업로드 (현재 방식)
1. `npm run build:mac` 또는 `npm run build:win` 등으로 빌드
2. GitHub Releases 페이지에서:
   - 새 릴리즈 생성
   - 태그 선택 (예: `v0.0.0`)
   - 빌드된 파일들을 수동으로 업로드:
     - macOS: `.dmg` 또는 `.zip` 파일
     - Windows: `.exe` 파일 (NSIS 또는 Portable)
     - Linux: `.AppImage`, `.deb`, `.rpm` 파일

#### 방법 2: 자동 퍼블리시 (선택사항)
electron-builder가 자동으로 GitHub에 업로드하려면:

**필요한 설정:**
1. GitHub Personal Access Token 생성:
   - GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - `repo` 권한 체크
   - 토큰 생성 후 복사

2. 환경 변수 설정:
   ```bash
   export GH_TOKEN=your_github_token_here
   ```
   또는 `.env` 파일에:
   ```
   GH_TOKEN=your_github_token_here
   ```

3. 빌드 및 자동 퍼블리시:
   ```bash
   npm run build:mac -- --publish=always
   npm run build:win -- --publish=always
   ```

## 📋 체크리스트

### 필수 사항 (현재 설정으로 가능)
- [x] `package.json`에 `build.publish` 설정 완료
- [x] GitHub 리포지토리 공개 설정
- [ ] GitHub Releases에 실제 앱 파일 업로드 (수동 또는 자동)

### 선택 사항 (자동 퍼블리시 원할 경우)
- [ ] GitHub Personal Access Token 생성
- [ ] `GH_TOKEN` 환경 변수 설정
- [ ] `electron-builder` 자동 퍼블리시 테스트

## 🚀 현재 상태

**현재 설정으로는 토큰 없이도 작동합니다!**

다만 다음을 확인하세요:
1. GitHub Releases에 릴리즈가 생성되어 있는지
2. 릴리즈에 실제 앱 파일(.dmg, .exe 등)이 업로드되어 있는지

## 📝 참고

- 공개 리포지토리: 토큰 없이 릴리즈 정보 읽기 가능 ✅
- 비공개 리포지토리: 토큰 필요 (현재는 공개이므로 불필요)
- 자동 퍼블리시: 토큰 필요 (선택사항)

