/**
 * electron-builder afterPack 훅
 * .app 생성 직후, .dmg/.zip 만들기 전에 sharp rpath 수정
 */

const { execSync } = require('child_process');
const { join, existsSync } = require('path');
const { existsSync: exists } = require('fs');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;

  if (electronPlatformName !== 'darwin') return;

  const appPath = join(appOutDir, 'review-crawler.app');

  if (!require('fs').existsSync(appPath)) {
    console.log(`⚠️  afterPack: app not found at ${appPath}, skipping rpath fix`);
    return;
  }

  const sharpNodeArm64 = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node');
  const sharpNodeX64   = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64.node');
  const libvipsArm64   = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib');
  const libvipsX64     = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-x64/lib/libvips-cpp.8.17.3.dylib');

  function fixRpath(nodeFile, arch) {
    const libvipsPath = arch === 'arm64' ? libvipsArm64 : libvipsX64;
    if (!require('fs').existsSync(nodeFile)) { console.log(`⚠️  ${nodeFile} not found, skipping`); return; }
    if (!require('fs').existsSync(libvipsPath)) { console.log(`⚠️  ${libvipsPath} not found, skipping`); return; }
    const relativePath = `@loader_path/../../sharp-libvips-darwin-${arch}/lib/libvips-cpp.8.17.3.dylib`;
    try {
      execSync(`install_name_tool -change "@rpath/libvips-cpp.8.17.3.dylib" "${relativePath}" "${nodeFile}"`);
      console.log(`✅ afterPack: fixed rpath for sharp-darwin-${arch}`);
    } catch (e) {
      console.error(`❌ afterPack: rpath fix failed for ${arch}:`, e.message);
    }
  }

  console.log('🔧 afterPack: fixing sharp rpath...');
  fixRpath(sharpNodeArm64, 'arm64');
  fixRpath(sharpNodeX64, 'x64');
  console.log('✅ afterPack: done');
};
