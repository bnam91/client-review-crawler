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
