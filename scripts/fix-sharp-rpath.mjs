/**
 * sharp 네이티브 바이너리의 rpath를 수정하는 함수
 * electron-builder의 afterPack 훅에서 사용됨
 */

import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

export default async function fixSharpRpath(context) {
  const { appOutDir, platformName } = context;
  
  if (platformName !== 'darwin') {
    console.log('⚠️  Skipping sharp rpath fix (not macOS)');
    return;
  }
  
  const appPath = appOutDir;
  
  const sharpNodeArm64 = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node');
  const sharpNodeX64 = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64.node');
  const libvipsArm64 = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib');
  const libvipsX64 = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-x64/lib/libvips-cpp.8.17.3.dylib');
  
  function fixRpath(nodeFile, arch) {
    if (!existsSync(nodeFile)) {
      console.log(`⚠️  ${nodeFile} not found, skipping...`);
      return;
    }
    
    const libvipsPath = arch === 'arm64' ? libvipsArm64 : libvipsX64;
    if (!existsSync(libvipsPath)) {
      console.log(`⚠️  ${libvipsPath} not found, skipping...`);
      return;
    }
    
    const relativePath = `@loader_path/../../sharp-libvips-darwin-${arch}/lib/libvips-cpp.8.17.3.dylib`;
    
    try {
      execSync(`install_name_tool -change "@rpath/libvips-cpp.8.17.3.dylib" "${relativePath}" "${nodeFile}"`, { stdio: 'inherit' });
      console.log(`✅ Fixed rpath for ${nodeFile}`);
    } catch (error) {
      console.error(`❌ Failed to fix rpath for ${nodeFile}:`, error.message);
    }
  }
  
  console.log('🔧 Fixing sharp rpath...');
  fixRpath(sharpNodeArm64, 'arm64');
  fixRpath(sharpNodeX64, 'x64');
  console.log('✅ Done!');
}

