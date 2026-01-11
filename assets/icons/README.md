# 아이콘 파일 안내

배포를 위해 다음 아이콘 파일들을 준비해주세요:

## 현재 상태
- ✅ `icon.png` (1024x1024) - 준비 완료

## macOS - icon.icns 생성 방법

### 방법 1: 온라인 변환기 (가장 간단) ⭐ 추천
1. https://cloudconvert.com/png-to-icns 접속
2. `icon.png` 파일 업로드
3. 변환 후 `icon.icns` 다운로드
4. `assets/icons/` 폴더에 저장

### 방법 2: Image2icon 앱 사용
1. Mac App Store에서 "Image2icon" 다운로드
2. `icon.png`를 앱에 드래그 앤 드롭
3. `.icns` 형식으로 저장

### 방법 3: electron-icon-builder 사용
```bash
npm install -g electron-icon-builder
electron-icon-builder --input=./assets/icons/icon.png --output=./assets/icons
```

## Windows - icon.ico 생성 방법
1. 온라인 변환기 사용: https://convertio.co/png-ico/
2. `icon.png` 업로드 후 `icon.ico` 다운로드
3. `assets/icons/` 폴더에 저장

## Linux
- `icon.png` 파일 그대로 사용 (이미 준비됨)

## 참고
- 아이콘 파일이 없어도 빌드는 가능하지만, 기본 일렉트론 아이콘이 사용됩니다
- macOS 빌드 시 `icon.icns`가 있으면 해당 아이콘이 사용됩니다
