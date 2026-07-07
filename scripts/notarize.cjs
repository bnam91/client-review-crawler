// afterSign hook — notarizes the .app via xcrun notarytool keychain profile.
// One-time setup: xcrun notarytool store-credentials "goditor-notary" --apple-id ... --team-id ... --password ...
// SKIP_NOTARIZE=1 to skip (local --dir builds).
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;
  if (process.env.SKIP_NOTARIZE === '1') { console.log('[notarize] SKIP'); return; }
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const keychainProfile = process.env.NOTARYTOOL_PROFILE || 'goditor-notary';
  console.log(`[notarize] ${appPath} (profile: ${keychainProfile})`);
  const { notarize } = require('@electron/notarize');
  await notarize({ tool: 'notarytool', appPath, keychainProfile });
  console.log('[notarize] done');
};
