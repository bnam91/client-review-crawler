#!/bin/bash

# macOS .icns 파일 생성 스크립트
# 사용법: ./create_icns.sh

cd "$(dirname "$0")"

# iconset 폴더 생성
rm -rf icon.iconset
mkdir -p icon.iconset

# icon.png가 있는지 확인
if [ ! -f "icon.png" ]; then
    echo "❌ icon.png 파일이 없습니다!"
    exit 1
fi

echo "📦 iconset 생성 중..."

# macOS iconset에 필요한 모든 크기 생성
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png

echo "🔨 .icns 파일 생성 중..."
iconutil -c icns icon.iconset -o icon.icns

if [ -f "icon.icns" ]; then
    echo "✅ icon.icns 생성 완료!"
    rm -rf icon.iconset
    echo "🧹 임시 iconset 폴더 삭제 완료"
else
    echo "❌ icon.icns 생성 실패"
    exit 1
fi

