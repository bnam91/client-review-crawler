// Renderer 프로세스 스크립트

document.addEventListener('DOMContentLoaded', () => {
  const state = {
    platform: 0, // 0: 네이버, 1: 쿠팡
    collectionType: 0, // 0: 리뷰 수집, 1: Q&A 수집, 2: 리뷰 + Q&A 수집
    sort: 0,     // 0: 랭킹순, 1: 최신순, 2: 평점낮은순
    pages: 0     // 0:5, 1:15, 2:50, 3:max, 4:직접입력
  };

  // 수집 타입 드롭다운
  const collectionTypeSelect = document.getElementById('collection-type-select');
  const sortSelect = document.getElementById('sort-select');
  const excludeSecretGroup = document.getElementById('exclude-secret-group');
  const excludeSecretCheckbox = document.getElementById('exclude-secret');
  
  if (collectionTypeSelect) {
    collectionTypeSelect.addEventListener('change', (e) => {
      const newCollectionType = parseInt(e.target.value);
      state.collectionType = newCollectionType;
      const collectionTypeNames = ['리뷰 수집', 'Q&A 수집'];
      
      // 즉시 콘솔 로그 출력
      console.log(`[Renderer] 🎯 항목 및 순서 변경: ${collectionTypeNames[newCollectionType]} (값: ${newCollectionType})`);
      
      // Q&A 수집 시 정렬 드롭다운 숨기고 비밀 글 제외 체크박스 표시
      if (state.collectionType === 1) {
        // Q&A 수집
        if (sortSelect) {
          sortSelect.style.display = 'none';
        }
        // 비밀글 제외: 네이버만 지원 (쿠팡 Q&A는 비밀글 없음)
        if (excludeSecretGroup) {
          excludeSecretGroup.style.display = state.platform === 0 ? 'flex' : 'none';
        }
      } else {
        // 리뷰 수집
        if (sortSelect) {
          sortSelect.style.display = 'block';
        }
        if (excludeSecretGroup) {
          excludeSecretGroup.style.display = 'none';
        }
      }
      
      updateLog();
      updateExpected();
    });
  }
  
  // 비밀글 제외 체크박스
  const excludeSecretLabel = document.getElementById('exclude-secret-label');
  if (excludeSecretCheckbox) {
    excludeSecretCheckbox.addEventListener('click', () => {
      excludeSecretCheckbox.classList.toggle('checked');
    });
  }
  
  // 라벨 클릭 시 체크박스 토글
  if (excludeSecretLabel) {
    excludeSecretLabel.addEventListener('click', () => {
      if (excludeSecretCheckbox) {
        excludeSecretCheckbox.classList.toggle('checked');
      }
    });
  }

  // 플랫폼 토글 버튼
  const platformToggleBtn = document.getElementById('platform-toggle-btn');
  const platformNameElement = document.getElementById('platform-name');
  
  // config에서 plan 값 가져오기
  let configPlan = null;
  if (window.electronAPI && window.electronAPI.getConfig) {
    try {
      const config = window.electronAPI.getConfig();
      configPlan = config?.plan;
      console.log('[Renderer] Config plan:', configPlan);
    } catch (error) {
      console.error('[Renderer] Config 가져오기 실패:', error);
    }
  }
  
  // 수집 시작 버튼 활성화/비활성화 함수
  function updateStartButtonState() {
    const startBtn = document.getElementById('start-btn');
    if (!startBtn) return;
    
    // plan 1=네이버만, 2=쿠팡만, 3=전체
    const blocked =
      (configPlan === 1 && state.platform === 1) || // 네이버 플랜 → 쿠팡 차단
      (configPlan === 2 && state.platform === 0);   // 쿠팡 플랜 → 네이버 차단
    if (blocked) {
      startBtn.disabled = true;
      startBtn.style.opacity = '0.5';
      startBtn.style.cursor = 'not-allowed';
      console.log('[Renderer] 현재 플랜에서 지원하지 않는 플랫폼 - 수집 시작 버튼 비활성화');
    } else {
      startBtn.disabled = false;
      startBtn.style.opacity = '1';
      startBtn.style.cursor = 'pointer';
    }
  }
  
  // 플랫폼별 정렬/수집 옵션 업데이트
  function updateOptionsForPlatform(platform) {
    if (!sortSelect || !collectionTypeSelect) return;

    if (platform === 1) {
      // 쿠팡: 베스트순 / 최신순
      sortSelect.innerHTML = `
        <option value="0">베스트순</option>
        <option value="1">최신순</option>
      `;
      // Q&A 옵션 활성화 (쿠팡 Q&A 지원)
      const qnaOption = collectionTypeSelect.querySelector('option[value="1"]');
      if (qnaOption) {
        qnaOption.disabled = false;
        qnaOption.textContent = 'Q&A 수집';
      }
    } else {
      // 네이버: 랭킹순 / 최신순 / 평점낮은순
      sortSelect.innerHTML = `
        <option value="0">랭킹순</option>
        <option value="1">최신순</option>
        <option value="2">평점낮은순</option>
      `;
      // Q&A 옵션 복구
      const qnaOption = collectionTypeSelect.querySelector('option[value="1"]');
      if (qnaOption) {
        qnaOption.disabled = false;
        qnaOption.textContent = 'Q&A 수집';
      }
    }
    // 정렬 상태 초기화
    state.sort = 0;
    sortSelect.value = '0';
  }

  if (platformToggleBtn && platformNameElement) {
    // 초기 플랫폼 설정 (네이버)
    const platformNames = ['네이버', '쿠팡'];
    platformNameElement.textContent = platformNames[state.platform];

    platformToggleBtn.addEventListener('click', () => {
      // 네이버(0) ↔ 쿠팡(1) 전환
      const next = state.platform === 0 ? 1 : 0;
      // plan 1=네이버만, 2=쿠팡만 → 단일 플랫폼 플랜은 토글 불가
      if (configPlan === 1 && next === 1) {
        showModal('현재 플랜(네이버 전용)에서는 쿠팡을 사용할 수 없습니다.');
        return;
      }
      if (configPlan === 2 && next === 0) {
        showModal('현재 플랜(쿠팡 전용)에서는 네이버를 사용할 수 없습니다.');
        return;
      }
      state.platform = next;
      platformNameElement.textContent = platformNames[state.platform];

      // 쿠팡일 때 버튼 스타일 변경
      if (state.platform === 1) {
        platformToggleBtn.classList.add('coupang');
      } else {
        platformToggleBtn.classList.remove('coupang');
      }

      // 플랫폼별 옵션 업데이트
      updateOptionsForPlatform(state.platform);

      // 쿠팡 Q&A 선택 상태였으면 비밀글 제외 숨기기
      if (excludeSecretGroup && state.collectionType === 1) {
        excludeSecretGroup.style.display = state.platform === 0 ? 'flex' : 'none';
      }

      console.log(`[Renderer] 🎯 플랫폼 변경: ${platformNames[state.platform]} (값: ${state.platform})`);

      updateStartButtonState();
      updateLog();
      updateExpected();
    });
  }

  // URL 입력 감지 및 플랫폼 자동 인식
  const productUrlInput = document.getElementById('product-url');
  const statusElement = document.getElementById('status');
  
  function detectPlatformFromUrl(url) {
    if (!url) return null;
    
    const urlLower = url.toLowerCase();
    
    // 네이버 쇼핑 URL 패턴
    if (urlLower.includes('shopping.naver.com') || 
        urlLower.includes('smartstore.naver.com') ||
        urlLower.includes('naver.com') && (urlLower.includes('/products/') || urlLower.includes('/items/'))) {
      return 0; // 네이버
    }
    
    // 쿠팡 URL 패턴
    if (urlLower.includes('coupang.com') || 
        urlLower.includes('coupang.co.kr')) {
      return 1; // 쿠팡
    }
    
    return null;
  }
  
  if (productUrlInput && statusElement) {
    productUrlInput.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      
      if (url) {
        // 플랫폼 자동 감지
        const detectedPlatform = detectPlatformFromUrl(url);
        
        if (detectedPlatform !== null) {
          // 플랫폼 자동 감지
          state.platform = detectedPlatform;
          const platformNames = ['네이버', '쿠팡'];
          
          // 플랫폼 버튼 텍스트 및 스타일 업데이트
          if (platformNameElement && platformToggleBtn) {
            platformNameElement.textContent = platformNames[detectedPlatform];
            if (detectedPlatform === 1) {
              platformToggleBtn.classList.add('coupang');
            } else {
              platformToggleBtn.classList.remove('coupang');
            }
          }
          
          if (detectedPlatform === 0) {
            // 네이버
            statusElement.textContent = '네이버 상품 감지됨';
            addLog('[자동] 네이버 상품 URL이 감지되었습니다.');
            showStatusMessage('네이버 상품 URL이 감지되었습니다.', 'success');
          } else if (detectedPlatform === 1) {
            // 쿠팡
            statusElement.textContent = '쿠팡 상품 감지됨';
            addLog('[자동] 쿠팡 상품 URL이 감지되었습니다.');
            showStatusMessage('쿠팡 상품 URL이 감지되었습니다.', 'success');
          }
          
          // 플랫폼별 옵션 업데이트
          updateOptionsForPlatform(detectedPlatform);

          // 수집 시작 버튼 상태 업데이트
          updateStartButtonState();

          updateLog();
          updateExpected();
        } else {
          // statusElement.textContent = 'URL 입력됨 (플랫폼 미인식)';
          // showStatusMessage('URL 입력됨 (플랫폼 미인식)', 'warning');
        }
      } else {
        statusElement.textContent = '대기';
        hideStatusMessage();
      }
    });
  }

  // 페이지 태그 토글 기능
  const pageTags = document.querySelectorAll('[data-pages]');
  const customPagesInput = document.getElementById('custom-pages');
  const customPagesRow = document.getElementById('custom-pages-row');

  pageTags.forEach(btn => {
    btn.addEventListener('click', () => {
      pageTags.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      state.pages = parseInt(btn.dataset.pages);
      const pageNames = ['5페이지', '15페이지', '50페이지', '최대', '직접입력'];
      
      // 즉시 콘솔 로그 출력
      console.log(`[Renderer] 🎯 페이지 변경: ${pageNames[state.pages]} (값: ${state.pages})`);
      
      if (state.pages === 4) {
        // 직접 입력 선택 시 필드 표시
        if (customPagesRow) {
          customPagesRow.style.display = 'flex';
        }
        if (customPagesInput) {
          customPagesInput.disabled = false;
          customPagesInput.classList.remove('disabled');
        }
      } else {
        // 직접 입력이 아닐 때 필드 숨김
        if (customPagesRow) {
          customPagesRow.style.display = 'none';
        }
        if (customPagesInput) {
          customPagesInput.disabled = true;
          customPagesInput.classList.add('disabled');
        }
      }
      updateLog();
      updateExpected();
    });
  });

  // 정렬 드롭다운 (이미 위에서 선언됨)
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      const newSort = parseInt(e.target.value);
      state.sort = newSort;
      const sortNames = state.platform === 1
        ? ['베스트순', '최신순']
        : ['랭킹순', '최신순', '평점낮은순'];

      console.log(`[Renderer] 🎯 정렬 변경: ${sortNames[newSort] ?? newSort} (값: ${newSort})`);

      updateLog();
      updateExpected();
    });
  }

  // 체크박스 토글
  const openFolderCheckbox = document.getElementById('open-folder');
  if (openFolderCheckbox) {
    openFolderCheckbox.addEventListener('click', () => {
      openFolderCheckbox.classList.toggle('checked');
    });
  }

  // 업데이트 체크 버튼
  const updateCheckBtn = document.getElementById('update-check-btn');
  if (updateCheckBtn && window.electronAPI && window.electronAPI.checkForUpdates) {
    updateCheckBtn.addEventListener('click', () => {
      console.log('[Renderer] 업데이트 체크 버튼 클릭');
      window.electronAPI.checkForUpdates();
    });
  }

  // 노션 문서 버튼
  const notionBtn = document.getElementById('notion-btn');
  if (notionBtn && window.electronAPI && window.electronAPI.openExternalUrl) {
    notionBtn.addEventListener('click', () => {
      console.log('[Renderer] 노션 문서 버튼 클릭');
      window.electronAPI.openExternalUrl('https://crystalline-trapezoid-61b.notion.site/Review-Crawler-2e6111a577888074bcd9c0707f344fbf');
    });
  }

  // 타이틀 클릭 시 노션 링크 열기
  const appTitle = document.getElementById('app-title');
  if (appTitle && window.electronAPI && window.electronAPI.openExternalUrl) {
    appTitle.addEventListener('click', () => {
      console.log('[Renderer] 타이틀 클릭 - 노션 문서 열기');
      window.electronAPI.openExternalUrl('https://crystalline-trapezoid-61b.notion.site/Review-Crawler-2e6111a577888074bcd9c0707f344fbf');
    });
  }

  // 노션 링크 버튼
  const notionLinkBtn = document.getElementById('notion-link-btn');
  if (notionLinkBtn && window.electronAPI && window.electronAPI.openExternalUrl) {
    notionLinkBtn.addEventListener('click', () => {
      console.log('[Renderer] 노션 링크 버튼 클릭');
      window.electronAPI.openExternalUrl('https://crystalline-trapezoid-61b.notion.site/Review-Crawler-2e6111a577888074bcd9c0707f344fbf');
    });
  }

  // 메뉴 버튼 클릭 시 패널 토글
  const menuBtn = document.getElementById('menu-btn');
  const menuPanel = document.getElementById('menu-panel');
  const menuUserName = document.getElementById('menu-user-name');
  const menuUserIp = document.getElementById('menu-user-ip');
  const userName = document.getElementById('user-name');
  const userIp = document.getElementById('user-ip');

  if (menuBtn && menuPanel) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = menuPanel.style.display !== 'none';
      menuPanel.style.display = isVisible ? 'none' : 'block';
      
      // user와 ip 정보를 패널에 동기화
      if (userName && menuUserName) {
        menuUserName.textContent = userName.textContent.replace('user: ', '');
      }
      if (userIp && menuUserIp) {
        menuUserIp.textContent = userIp.textContent.replace('ip: ', '');
      }
    });

    // 패널 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
      if (menuPanel && !menuPanel.contains(e.target) && e.target !== menuBtn) {
        menuPanel.style.display = 'none';
      }
    });
  }

  // 저장 경로 선택 버튼
  const selectPathBtn = document.getElementById('select-path');
  const savePathInput = document.getElementById('save-path');
  
  // 디버깅: electronAPI 확인
  console.log('[Renderer] window.electronAPI:', window.electronAPI);
  console.log('[Renderer] window.electronAPI?.selectFolder:', window.electronAPI?.selectFolder);
  
  if (selectPathBtn && savePathInput) {
    selectPathBtn.addEventListener('click', async () => {
      console.log('[Renderer] Select path button clicked');
      try {
        console.log('[Renderer] Checking electronAPI...');
        console.log('[Renderer] window.electronAPI:', window.electronAPI);
        console.log('[Renderer] typeof window.electronAPI:', typeof window.electronAPI);
        
        if (!window.electronAPI) {
          console.error('[Renderer] window.electronAPI is not defined');
          showModal('Electron API를 사용할 수 없습니다. (window.electronAPI가 정의되지 않음)');
          return;
        }
        
        if (!window.electronAPI.selectFolder) {
          console.error('[Renderer] window.electronAPI.selectFolder is not defined');
          console.log('[Renderer] Available methods:', Object.keys(window.electronAPI));
          showModal('selectFolder 메서드를 사용할 수 없습니다.');
          return;
        }
        
        console.log('[Renderer] Calling selectFolder...');
        const selectedPath = await window.electronAPI.selectFolder();
        console.log('[Renderer] Selected path:', selectedPath);
        
        if (selectedPath) {
          savePathInput.value = selectedPath;
          addLog(`[경로] 저장 경로 선택: ${selectedPath}`);
        } else {
          console.log('[Renderer] No path selected (user cancelled)');
        }
      } catch (error) {
        console.error('[Renderer] 경로 선택 오류:', error);
        console.error('[Renderer] Error stack:', error.stack);
        showModal(`경로 선택 중 오류가 발생했습니다: ${error.message}`);
      }
    });
  } else {
    console.error('[Renderer] selectPathBtn or savePathInput not found');
  }

  // 수집 시작 버튼
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      // plan 1=네이버만, 2=쿠팡만, 3=전체
      const planBlocked =
        (configPlan === 1 && state.platform === 1) ||
        (configPlan === 2 && state.platform === 0);
      if (planBlocked) {
        const planName = configPlan === 1 ? '네이버 전용' : '쿠팡 전용';
        showModal(`현재 플랜(${planName})에서는 해당 플랫폼 수집을 사용할 수 없습니다.`);
        return;
      }
      
      const url = document.getElementById('product-url').value.trim();
      if (!url) {
        showModal('상품 URL 혹은 검색어를 입력하세요.');
        return;
      }
      
      addLog('[시작] 리뷰 수집을 시작합니다...', 'waiting');
      showStatusMessage('리뷰 수집을 시작합니다...', 'info');
      startBtn.disabled = true;
      startBtn.classList.add('loading');
      startBtn.innerHTML = '<span class="loading-spinner"></span> 수집 중...';
      
      // 브라우저에서 URL 열기 (플랫폼 정보 포함)
      if (window.electronAPI && window.electronAPI.openUrlInBrowser) {
        try {
          const platformNames = ['네이버', '쿠팡'];
          const collectionTypeNames = ['리뷰 수집', 'Q&A 수집'];
          const sortNames = state.platform === 1 ? ['베스트순', '최신순'] : ['랭킹순', '최신순', '평점낮은순'];
          const pageNames = ['5페이지', '15페이지', '50페이지', '최대', '직접입력'];
          
          // 현재 state 값 전체 출력
          console.log('[Renderer] 🚀 브라우저 열기 버튼 클릭 - 현재 설정:');
          console.log(`  - 플랫폼: ${platformNames[state.platform]} (값: ${state.platform})`);
          console.log(`  - 항목 및 순서: ${collectionTypeNames[state.collectionType]} (값: ${state.collectionType})`);
          console.log(`  - 정렬: ${sortNames[state.sort]} (값: ${state.sort})`);
          console.log(`  - 페이지: ${pageNames[state.pages]} (값: ${state.pages})`);
          
          // 직접 입력인 경우 입력값 가져오기
          let customPages = null;
          if (state.pages === 4 && customPagesInput) {
            const customValue = parseInt(customPagesInput.value);
            if (!isNaN(customValue) && customValue > 0) {
              customPages = customValue;
              console.log(`  - 직접 입력 페이지 수: ${customPages}`);
            } else {
              showModal('직접 입력 페이지 수를 올바르게 입력해주세요.');
              return;
            }
          }
          
          console.log(`  - URL: ${url}`);
          
          // 저장 경로 가져오기 (필수)
          const savePathElement = document.getElementById('save-path');
          const savePath = savePathElement ? savePathElement.value.trim() : '';
          console.log(`[Renderer] 저장 경로 입력 필드 값: "${savePath}"`);
          
          // 경로 필수 체크
          if (!savePath || savePath === '') {
            showModal('저장 경로를 반드시 선택해주세요.');
            startBtn.disabled = false;
            startBtn.classList.remove('loading');
            startBtn.textContent = '수집 시작하기';
            return;
          }
          
          // 폴더 열기 체크박스 상태 확인
          const openFolderCheckbox = document.getElementById('open-folder');
          const openFolder = openFolderCheckbox && openFolderCheckbox.classList.contains('checked');
          console.log(`[Renderer] 폴더 열기 체크박스 상태: ${openFolder}`);
          
          // 비밀글 제외 체크박스 상태 확인 (Q&A 수집일 때만)
          const excludeSecret = excludeSecretCheckbox && excludeSecretCheckbox.classList.contains('checked');
          console.log(`[Renderer] 비밀글 제외 체크박스 상태: ${excludeSecret}`);
          
          console.log(`  - 저장 경로: ${savePath}`);
          addLog(`[경로] 저장 경로: ${savePath}`);
          
          addLog(`[브라우저] ${url}를 브라우저에서 엽니다...`);
          showStatusMessage('브라우저를 열고 있습니다...', 'info');
          const result = await window.electronAPI.openUrlInBrowser(url, state.platform, state.collectionType, state.sort, state.pages, customPages, savePath, openFolder, excludeSecret);
          if (result.success) {
            addLog(`[브라우저] 브라우저에서 URL을 열었습니다.`);
            showStatusMessage('브라우저에서 URL을 열었습니다.', 'success');
          } else {
            const errorMessage = result.error || '알 수 없는 오류';
            addLog(`[오류] 브라우저 열기 실패: ${errorMessage}`);
            showStatusMessage(`브라우저 열기 실패: ${errorMessage}`, 'error');
            // 캡챠 관련 에러는 모달을 띄우지 않음 (로그 박스에만 표시)
            if (!errorMessage.includes('캡챠')) {
              showModal(`브라우저 열기 실패: ${errorMessage}`);
            }
            startBtn.disabled = false;
            startBtn.classList.remove('loading');
            startBtn.textContent = '수집 시작하기';
          }
        } catch (error) {
          console.error('[Renderer] 브라우저 열기 오류:', error);
          addLog(`[오류] 브라우저 열기 중 오류가 발생했습니다.`);
          showStatusMessage(`브라우저 열기 중 오류가 발생했습니다: ${error.message}`, 'error');
          showModal(`브라우저 열기 중 오류가 발생했습니다: ${error.message}`);
          startBtn.disabled = false;
          startBtn.classList.remove('loading');
          startBtn.textContent = '수집 시작하기';
        }
      } else {
        addLog('[오류] 브라우저 API를 사용할 수 없습니다.');
        showStatusMessage('브라우저 API를 사용할 수 없습니다.', 'error');
        showModal('브라우저 API를 사용할 수 없습니다.');
        startBtn.disabled = false;
        startBtn.classList.remove('loading');
        startBtn.textContent = '수집 시작하기';
      }
      
      // 시뮬레이션 (실제로는 크롤링 로직 실행)
      setTimeout(() => {
        addLog('[완료] 리뷰 수집이 완료되었습니다.');
        showStatusMessage('리뷰 수집이 완료되었습니다.', 'success');
        startBtn.disabled = false;
        startBtn.classList.remove('loading');
        startBtn.textContent = '수집 시작하기';
      }, 2000);
    });
  }

  function updateLog() {
    const logBox = document.getElementById('log-box');
    if (!logBox) return;
    
    const platformNames = ['네이버', '쿠팡'];
    const collectionTypeNames = ['리뷰 수집', 'Q&A 수집', '리뷰 + Q&A 수집'];
    const sortNames = state.platform === 1 ? ['베스트순', '최신순'] : ['랭킹순', '최신순', '평점낮은순'];
    const pageNames = ['5', '15', '50', 'max', '직접 입력'];

    const lines = [
      '<div class="log-line waiting">[대기] 상품 URL 입력을 기다리는 중…</div>',
      `<div class="log-line">[정보] 플랫폼: ${platformNames[state.platform]}</div>`,
      `<div class="log-line">[정보] 수집 타입: ${collectionTypeNames[state.collectionType]}</div>`,
      `<div class="log-line">[정보] 정렬: ${sortNames[state.sort]}</div>`,
      `<div class="log-line">[정보] 페이지: ${pageNames[state.pages]}</div>`
    ];
    
    logBox.innerHTML = lines.join('');
  }

  function updateExpected() {
    const expectedInfo = document.getElementById('expected-info');
    if (!expectedInfo) return;
    
    const platformNames = ['네이버', '쿠팡'];
    const collectionTypeNames = ['리뷰 수집', 'Q&A 수집', '리뷰 + Q&A 수집'];
    const sortNames = state.platform === 1 ? ['베스트순', '최신순'] : ['랭킹순', '최신순', '평점낮은순'];
    const pageNames = ['5', '15', '50', 'max', '직접 입력'];

    expectedInfo.textContent = 
      `페이지 ${pageNames[state.pages]} · 정렬 ${sortNames[state.sort]} · 플랫폼 ${platformNames[state.platform]} · ${collectionTypeNames[state.collectionType]}`;
  }

  function addLog(message, className = '') {
    const logBox = document.getElementById('log-box');
    if (!logBox) return;
    
    const line = document.createElement('div');
    line.className = `log-line ${className}`;
    line.textContent = message;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // 상태 메시지 표시 함수
  function showStatusMessage(message, type = 'info') {
    const statusBox = document.getElementById('status-message-box');
    const statusContent = document.getElementById('status-message-content');
    
    if (!statusBox || !statusContent) return;
    
    // 기존 타입 클래스 제거
    statusBox.classList.remove('info', 'success', 'warning', 'error');
    // 새 타입 클래스 추가
    statusBox.classList.add(type);
    
    statusContent.textContent = message;
    statusBox.style.display = 'block';
    
    // 상태 메시지는 사라지지 않음
  }

  // 상태 메시지 숨기기 함수
  function hideStatusMessage() {
    const statusBox = document.getElementById('status-message-box');
    if (statusBox) {
      statusBox.style.display = 'none';
    }
  }

  // 커스텀 모달 함수
  function showModal(message) {
    const modal = document.getElementById('custom-modal');
    const modalMessage = document.getElementById('modal-message');
    const modalOk = document.getElementById('modal-ok');
    
    if (!modal || !modalMessage || !modalOk) return;
    
    modalMessage.textContent = message;
    modal.style.display = 'flex';
    
    modalOk.onclick = () => {
      modal.style.display = 'none';
    };
    
    // 배경 클릭 시 닫기
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
  }

  // IP 주소 가져오기
  async function fetchUserIP() {
    const userIpElement = document.getElementById('user-ip');
    const menuUserIp = document.getElementById('menu-user-ip');
    
    // user-ip 요소가 없어도 menu-user-ip는 업데이트해야 함
    if (!userIpElement && !menuUserIp) return;
    
    try {
      // 여러 API를 시도 (하나가 실패하면 다음으로)
      const apis = [
        { url: 'https://api.ipify.org?format=json', type: 'json' },
        { url: 'https://api.ip.sb/ip', type: 'text' },
        { url: 'https://ifconfig.me/ip', type: 'text' },
      ];
      
      let ip = null;
      
      for (const api of apis) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(api.url, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (api.type === 'json') {
            const data = await response.json();
            ip = data.ip;
          } else {
            ip = await response.text();
            ip = ip.trim();
          }
          
          if (ip) break;
        } catch (error) {
          console.log(`[Renderer] IP API 실패 (${api.url}):`, error.message);
          continue;
        }
      }
      
      const ipText = ip ? ip : '확인 불가';
      const ipTextWithLabel = ip ? `ip: ${ip}` : 'ip: 확인 불가';
      
      if (userIpElement) {
        userIpElement.textContent = ipTextWithLabel;
      }
      // 메뉴 패널의 ip도 업데이트
      if (menuUserIp) {
        menuUserIp.textContent = ipText;
      }
    } catch (error) {
      console.error('[Renderer] IP 가져오기 오류:', error);
      const errorText = '확인 불가';
      const errorTextWithLabel = 'ip: 확인 불가';
      
      if (userIpElement) {
        userIpElement.textContent = errorTextWithLabel;
      }
      if (menuUserIp) {
        menuUserIp.textContent = errorText;
      }
    }
  }

  // 초기화: sort 드롭다운의 현재 값을 state에 반영
  if (sortSelect) {
    state.sort = parseInt(sortSelect.value) || 0;
    const sortNames = state.platform === 1 ? ['베스트순', '최신순'] : ['랭킹순', '최신순', '평점낮은순'];
    console.log('[Renderer] 초기 sort 값:', state.sort, `(${sortNames[state.sort]})`);
  }
  
  // 초기화: Q&A 수집이 선택되어 있으면 정렬 드롭다운 숨기고 체크박스 표시
  if (state.collectionType === 1) {
    if (sortSelect) {
      sortSelect.style.display = 'none';
    }
    if (excludeSecretGroup) {
      excludeSecretGroup.style.display = 'flex';
    }
  }
  
  // 실시간 시간 및 날짜 업데이트
  function updateTime() {
    const timeElement = document.getElementById('app-time');
    const dateElement = document.getElementById('app-date');
    const menuTimeElement = document.getElementById('menu-app-time');
    const menuDateElement = document.getElementById('menu-app-date');
    const now = new Date();
    
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeText = `${hours}:${minutes}:${seconds}`;
    
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const weekday = weekdays[now.getDay()];
    const dateText = `${month}월 ${date}일 (${weekday})`;
    
    if (timeElement) {
      timeElement.textContent = timeText;
    }
    if (dateElement) {
      dateElement.textContent = dateText;
    }
    // 메뉴 패널의 시간과 날짜도 업데이트
    if (menuTimeElement) {
      menuTimeElement.textContent = timeText;
    }
    if (menuDateElement) {
      menuDateElement.textContent = dateText;
    }
  }
  
  // 버전 정보 업데이트
  const appVersionElement = document.getElementById('app-version');
  if (appVersionElement && window.electronAPI && window.electronAPI.getVersion) {
    try {
      const version = window.electronAPI.getVersion();
      appVersionElement.textContent = version;
    } catch (error) {
      console.error('[Renderer] 버전 정보 가져오기 실패:', error);
    }
  }
  
  // 크롤러 로그 수신
  let lastLogLine = null; // 마지막 로그 라인 추적
  if (window.electronAPI && window.electronAPI.onCrawlerLog) {
    window.electronAPI.onCrawlerLog(({ message, className = '', updateLast = false }) => {
      if (updateLast && lastLogLine) {
        // 마지막 로그 라인 업데이트
        lastLogLine.textContent = message;
        lastLogLine.className = `log-line ${className}`;
      } else {
        // 새 로그 추가
        addLog(message, className);
        const logBox = document.getElementById('log-box');
        if (logBox && logBox.lastElementChild) {
          lastLogLine = logBox.lastElementChild;
        }
      }
    });
  }
  
  // ── 라이선스 인증 ──────────────────────────────────────────────
  const licenseOverlay = document.getElementById('license-overlay');
  const licenseIdInput = document.getElementById('license-id-input');
  const licenseKeyInput = document.getElementById('license-key-input');
  const licenseSubmitBtn = document.getElementById('license-submit-btn');
  const licenseError = document.getElementById('license-error');
  const ipLimitModal = document.getElementById('ip-limit-modal');
  const ipLimitList = document.getElementById('ip-limit-list');

  let currentIp = null;
  let currentLicenseKey = null;

  // IP 가져온 후 라이선스 체크
  async function getIpAndCheckLicense() {
    // IP 가져오기
    const apis = [
      { url: 'https://api.ipify.org?format=json', type: 'json' },
      { url: 'https://api.ip.sb/ip', type: 'text' },
      { url: 'https://ifconfig.me/ip', type: 'text' },
    ];
    for (const api of apis) {
      try {
        const res = await fetch(api.url, { signal: AbortSignal.timeout(5000) });
        currentIp = api.type === 'json' ? (await res.json()).ip : (await res.text()).trim();
        if (currentIp) break;
      } catch (e) { continue; }
    }

    // 메뉴 IP 표시
    const menuUserIp = document.getElementById('menu-user-ip');
    if (menuUserIp) menuUserIp.textContent = currentIp || '확인 불가';

    if (!currentIp) {
      showLicenseOverlay();
      return;
    }

    // IP로 유저 조회
    const result = await window.electronAPI.licenseCheckIp(currentIp);
    if (result.found) {
      applyUser(result.user);
    } else {
      showLicenseOverlay();
    }
  }

  function showLicenseOverlay() {
    if (licenseOverlay) licenseOverlay.style.display = 'flex';
  }

  function hideLicenseOverlay() {
    if (licenseOverlay) licenseOverlay.style.display = 'none';
  }

  let currentAllowedIps = [];

  function applyUser(user) {
    currentLicenseKey = user.licenseKey;
    currentAllowedIps = user.allowedIps || [];
    const menuUserName = document.getElementById('menu-user-name');
    if (menuUserName) menuUserName.textContent = user.userId || user.userName || '-';
    // plan 적용 (기존 configPlan 대체)
    configPlan = user.plan;
    updateStartButtonState();
    hideLicenseOverlay();
    if (ipLimitModal) ipLimitModal.style.display = 'none';
    // root면 관리자 버튼 표시
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) adminBtn.style.display = (user.userId === 'root') ? 'inline-flex' : 'none';
    console.log(`[License] 인증 완료: ${user.userId} / plan:${user.plan}`);
  }

  // 기기 관리 모달
  const deviceModal = document.getElementById('device-modal');
  const deviceIpList = document.getElementById('device-ip-list');
  const deviceModalCount = document.getElementById('device-modal-count');

  function renderDeviceModal() {
    if (!deviceIpList) return;
    deviceIpList.innerHTML = '';
    if (deviceModalCount) deviceModalCount.textContent = `${currentAllowedIps.length} / 5`;

    currentAllowedIps.forEach(({ ip, alias, registeredAt }) => {
      const isCurrent = ip === currentIp;
      const date = registeredAt ? new Date(registeredAt).toLocaleDateString('ko-KR') : '';
      const item = document.createElement('div');
      item.className = 'ip-item' + (isCurrent ? ' ip-item-current' : '');
      item.innerHTML = `
        <div class="ip-item-info" style="flex:1;">
          <div style="display:flex;align-items:center;">
            <span class="ip-item-ip">${ip}</span>
            ${isCurrent ? '<span class="ip-item-current-badge">현재</span>' : ''}
          </div>
          <span class="ip-item-date">${date}</span>
          <div class="ip-alias-row">
            <input class="ip-alias-input" type="text" placeholder="별칭 없음" value="${alias || ''}" data-ip="${ip}" maxlength="20" />
            <button class="ip-alias-save" data-ip="${ip}">저장</button>
          </div>
        </div>
        <button class="ip-item-delete" data-ip="${ip}" style="margin-left:10px; align-self:flex-start;">삭제</button>
      `;
      deviceIpList.appendChild(item);
    });

    // 별칭 저장
    deviceIpList.querySelectorAll('.ip-alias-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ip = btn.dataset.ip;
        const input = deviceIpList.querySelector(`.ip-alias-input[data-ip="${ip}"]`);
        const alias = input?.value.trim() || '';
        await window.electronAPI.licenseUpdateAlias(currentLicenseKey, ip, alias);
        // 로컬 반영
        const entry = currentAllowedIps.find(e => e.ip === ip);
        if (entry) entry.alias = alias;
        btn.textContent = '저장됨';
        setTimeout(() => { btn.textContent = '저장'; }, 1200);
      });
    });

    // IP 삭제
    deviceIpList.querySelectorAll('.ip-item-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ip = btn.dataset.ip;
        if (ip === currentIp) {
          showModal('현재 기기는 삭제할 수 없습니다.');
          return;
        }
        await window.electronAPI.licenseRemoveIp(currentLicenseKey, ip);
        currentAllowedIps = currentAllowedIps.filter(e => e.ip !== ip);
        renderDeviceModal();
      });
    });
  }

  document.getElementById('device-manage-btn')?.addEventListener('click', () => {
    if (!currentLicenseKey) return;
    menuPanel.style.display = 'none';
    renderDeviceModal();
    if (deviceModal) deviceModal.style.display = 'flex';
  });

  document.getElementById('device-modal-close')?.addEventListener('click', () => {
    if (deviceModal) deviceModal.style.display = 'none';
  });

  // 관리자 모달 (root 전용)
  const adminModal = document.getElementById('admin-modal');
  const adminKeyList = document.getElementById('admin-key-list');
  const PLAN_LABELS = { 1: '네이버만', 2: '쿠팡만', 3: '네이버+쿠팡' };

  async function loadAdminKeyList() {
    if (!adminKeyList) return;
    adminKeyList.innerHTML = '<div class="admin-loading">로딩 중...</div>';
    const result = await window.electronAPI.licenseListKeys();
    if (!result.success) {
      adminKeyList.innerHTML = '<div class="admin-loading">불러오기 실패</div>';
      return;
    }
    adminKeyList.innerHTML = '';
    result.list.forEach(({ licenseKey, plan, active, memo, createdAt }) => {
      const date = createdAt ? new Date(createdAt).toLocaleDateString('ko-KR') : '';
      const item = document.createElement('div');
      item.className = 'admin-key-item' + (active ? '' : ' admin-key-item-inactive');
      item.innerHTML = `
        <span class="admin-key-item-key" title="클릭하여 복사">${licenseKey}</span>
        <span class="admin-key-item-memo">${memo || ''}</span>
        <div class="admin-key-item-meta">
          <span class="admin-key-item-plan admin-plan-${plan}">${PLAN_LABELS[plan] || plan}</span>
          <span class="admin-key-item-date">${date}</span>
        </div>
      `;
      // 클릭하여 복사
      item.querySelector('.admin-key-item-key').addEventListener('click', () => {
        navigator.clipboard.writeText(licenseKey);
        showModal(`복사됨: ${licenseKey}`);
      });
      adminKeyList.appendChild(item);
    });
    if (result.list.length === 0) {
      adminKeyList.innerHTML = '<div class="admin-loading">발급된 키 없음</div>';
    }
  }

  document.getElementById('admin-btn')?.addEventListener('click', () => {
    if (adminModal) {
      adminModal.style.display = 'flex';
      loadAdminKeyList();
    }
  });

  document.getElementById('admin-modal-close')?.addEventListener('click', () => {
    if (adminModal) adminModal.style.display = 'none';
  });

  document.getElementById('admin-refresh-btn')?.addEventListener('click', loadAdminKeyList);

  document.getElementById('admin-issue-btn')?.addEventListener('click', async () => {
    const planSelect = document.getElementById('admin-plan-select');
    const memoInput = document.getElementById('admin-memo-input');
    const issuedKeyEl = document.getElementById('admin-issued-key');
    const issueBtn = document.getElementById('admin-issue-btn');

    const plan = parseInt(planSelect?.value || '3');
    const memo = memoInput?.value.trim() || '';

    issueBtn.disabled = true;
    issueBtn.textContent = '발급 중...';

    const result = await window.electronAPI.licenseCreateKey(plan, memo);

    issueBtn.disabled = false;
    issueBtn.textContent = '발급';

    if (result.success) {
      if (issuedKeyEl) {
        issuedKeyEl.textContent = result.licenseKey;
        issuedKeyEl.style.display = 'block';
        issuedKeyEl.onclick = () => {
          navigator.clipboard.writeText(result.licenseKey);
          showModal(`복사됨: ${result.licenseKey}`);
        };
      }
      if (memoInput) memoInput.value = '';
      loadAdminKeyList();
    } else {
      showModal('키 발급 실패: ' + (result.reason || result.error));
    }
  });

  // 라이선스 키 제출
  if (licenseSubmitBtn) {
    licenseSubmitBtn.addEventListener('click', async () => {
      const userId = licenseIdInput?.value.trim();
      const key = licenseKeyInput?.value.trim().toUpperCase();

      if (!userId) { if (licenseError) licenseError.textContent = 'ID를 입력하세요.'; return; }
      if (!key) { if (licenseError) licenseError.textContent = '라이선스 키를 입력하세요.'; return; }

      licenseSubmitBtn.disabled = true;
      licenseSubmitBtn.textContent = '확인 중...';
      if (licenseError) licenseError.textContent = '';

      const result = await window.electronAPI.licenseRegister(key, currentIp, userId);

      licenseSubmitBtn.disabled = false;
      licenseSubmitBtn.textContent = '확인';

      if (result.success) {
        applyUser(result.user);
      } else if (result.reason === 'ip_limit') {
        showIpLimitModal({ ...result, licenseKey: key });
      } else {
        const messages = {
          invalid_key: '유효하지 않은 라이선스 키입니다.',
          inactive: '만료된 라이선스입니다.',
          userId_reserved: '사용할 수 없는 user_id입니다.',
          userId_taken: '이미 사용 중인 user_id입니다.',
          error: `오류: ${result.error}`,
        };
        if (licenseError) licenseError.textContent = messages[result.reason] || '인증 실패';
      }
    });

    licenseKeyInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') licenseSubmitBtn.click(); });
    licenseIdInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') licenseKeyInput?.focus(); });
  }

  // IP 한도 초과 모달
  function showIpLimitModal(result) {
    if (!ipLimitModal || !ipLimitList) return;
    ipLimitList.innerHTML = '';
    (result.allowedIps || []).forEach(({ ip, alias, registeredAt }) => {
      const date = registeredAt ? new Date(registeredAt).toLocaleDateString('ko-KR') : '';
      const item = document.createElement('div');
      item.className = 'ip-item';
      item.innerHTML = `
        <div class="ip-item-info">
          <span class="ip-item-alias">${alias || '별칭 없음'}</span>
          <span class="ip-item-ip">${ip}</span>
          <span class="ip-item-date">${date}</span>
        </div>
        <button class="ip-item-delete" data-ip="${ip}">삭제</button>
      `;
      ipLimitList.appendChild(item);
    });

    ipLimitList.querySelectorAll('.ip-item-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ipToDelete = btn.dataset.ip;
        const licenseKey = licenseKeyInput?.value.trim().toUpperCase();
        const userId = licenseIdInput?.value.trim();
        await window.electronAPI.licenseRemoveIp(licenseKey, ipToDelete);
        const reg = await window.electronAPI.licenseRegister(licenseKey, currentIp, userId);
        if (reg.success) applyUser(reg.user);
      });
    });

    document.getElementById('ip-limit-cancel')?.addEventListener('click', () => {
      ipLimitModal.style.display = 'none';
    });

    hideLicenseOverlay();
    ipLimitModal.style.display = 'flex';
  }

  // 초기화
  updateExpected();
  updateLog();
  updateStartButtonState();
  updateTime();
  setInterval(updateTime, 1000);
  getIpAndCheckLicense(); // IP 가져오기 + 라이선스 체크 (fetchUserIP 대체)
});
