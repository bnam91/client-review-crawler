# Review Crawler

고객용 매뉴얼: https://www.notion.so/Review-Crawler_-2e6111a577888074bcd9c0707f344fbf

---

## 다음 사이클 배포 흐름 (v1.6.4 이후)

`v1.7.0` 같은 태그 push만 하면 **GitHub Actions가 자동으로** Mac/Windows 빌드 + Releases 업로드까지 처리한다.

```bash
# 1. 버전 sync (3곳 모두)
#    - package.json: "version": "1.7.0"
#    - preload.mjs: appVersion = 'v1.7.0'
#    - renderer/index.html: <span id="app-version">v1.7.0</span>
# 2. 커밋 + 푸시
git push origin main
# 3. 태그 push → Actions 자동 트리거
git tag v1.7.0 && git push origin v1.7.0
```

자동: Mac/Windows 매트릭스 빌드 → Releases에 .dmg/.exe + latest-mac.yml/latest.yml 자동 게시
수동: 빌드된 .dmg/.exe를 구글드라이브 OS별 폴더로 옮기고 이전 버전을 `v{old}/` 서브폴더로 정리. 노션 "앱 배포 관리" DB 버전 갱신.

> 워크플로우: `.github/workflows/release.yml` (top-level `permissions: contents: write` + `workflow_dispatch` 트리거 포함)

---

## 남은 권장사항 (선택)

### 1. 구글드라이브 업로드도 Actions로 자동화 (P2)
현재는 Actions가 GitHub Releases까지만 자동. 드라이브 업로드는 수동.

완전 자동화하려면 Google Service Account 키를 GitHub Secrets에 등록 + 워크플로우에 업로드 step 추가. 한 번 셋업(약 30분)하면 다음부터 태그 push 한 번으로 끝.

### 2. 노션 DB 타이틀 정리 (Minor)
"앱 배포 관리" DB(`32c111a5778880c0a2ecf0ee058cc5c9`)의 client-review-crawler 페이지 타이틀이 `client-review-crawler₩` — 끝의 `₩` 오타. 정리하면 좋음.

### 3. electron-deploy 스킬 자체 업데이트 (사용자 OK 필요)
이번 사이클 학습 사항 반영 권장:
- 버전 박힌 곳 다중 sync 점검 단계 (package.json + preload.mjs + index.html)
- Windows 빌드 병행 안내 (현재 Mac 위주)
- 자동업데이트 검증 단계 (`gh release view` + yml 무결성 체크)
- 임의 버전 직접 지정 케이스 (`npm version 1.6.4` 또는 직접 편집)
- macOS 코드서명/공증 본격 가이드

→ 시작 전 사용자 OK 필요.

### 4. 라이선스 시스템 보안 강화 (장기)
운영 키울 때 점검:
- MongoDB URI 평문 노출 → 백엔드 API 게이트웨이로 이전
- IPC 핸들러 root 권한 검증 (현재는 빌드 앱 devTools 차단으로 risk 낮음)
- 외부 IP API fallback 강화

---

## 운영 메타

- **현재 운영 버전**: v1.6.4 (2026-04-30)
- **GitHub Repo**: https://github.com/bnam91/client-review-crawler (PUBLIC)
- **MongoDB DB**: `client_db` (`review_crawler_license` + `review_crawler`)
- **Root 사용자**: bnam91@goyamkt.com (`isRoot: true`)
- **자동업데이트**: electron-updater + GitHub Releases (PUBLIC repo 유지가 자동업데이트 단순화 위해 필수)
