# 아이콘 파일 안내

배포를 위해 다음 아이콘 파일들을 준비해주세요:

## macOS
- `icon.icns` (512x512 이상 권장)
  - 생성 방법: 여러 크기의 PNG를 .icns로 변환
  - 도구: `iconutil` (macOS 기본 제공) 또는 온라인 변환기

## Windows
- `icon.ico` (256x256 이상 권장)
  - 생성 방법: 여러 크기의 PNG를 .ico로 변환
  - 도구: 온라인 변환기 또는 ImageMagick

## Linux
- `icon.png` (512x512 권장)
  - PNG 형식의 정사각형 이미지

## 빠른 시작
임시로 사용할 수 있는 기본 아이콘을 생성하려면:
1. 512x512 PNG 이미지를 준비
2. macOS: `iconutil -c icns icon.iconset` (iconset 폴더 필요)
3. Windows: 온라인 변환기 사용 (예: convertio.co)
4. Linux: PNG 파일 그대로 사용

아이콘 파일이 없어도 빌드는 가능하지만, 기본 일렉트론 아이콘이 사용됩니다.
