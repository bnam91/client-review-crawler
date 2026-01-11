# 릴리즈 가이드

## GitHub 토큰 설정

### PowerShell (Windows)
```powershell
$env:GH_TOKEN="your_github_token_here"
```

### Bash/Zsh (macOS/Linux)
```bash
export GH_TOKEN=your_github_token_here
```

### .env 파일 사용 (권장)
`.env` 파일에 토큰을 저장하고 사용:
```
GH_TOKEN=your_github_token_here
```

## 빌드 및 자동 퍼블리시

### macOS 릴리즈
```bash
npm run release:mac
```

### Windows 릴리즈
```bash
npm run release:win
```

### Linux 릴리즈
```bash
npm run release:linux
```

### 모든 플랫폼 릴리즈
```bash
npm run release:all
```

## 빌드만 하기 (퍼블리시 없이)

### macOS 빌드만
```bash
npm run build:mac
```

### Windows 빌드만
```bash
npm run build:win
```

## GitHub 토큰 생성 방법

1. GitHub → Settings → Developer settings
2. Personal access tokens → Tokens (classic)
3. "Generate new token (classic)" 클릭
4. `repo` 권한 체크
5. 토큰 생성 후 복사

## 주의사항

- `GH_TOKEN` 환경 변수가 설정되어 있어야 자동 퍼블리시가 작동합니다
- 토큰은 `repo` 권한이 필요합니다
- `.env` 파일은 `.gitignore`에 포함되어 있어 안전합니다

