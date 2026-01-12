#!/usr/bin/env node
/**
 * sharp 네이티브 바이너리의 rpath를 수정하는 스크립트
 * 빌드 후 자동으로 실행됨
 */

import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

const appPath = process.argv[2];

if (!appPath) {
  console.error('Usage: node fix-sharp-rpath.js <app-path>');
  process.exit(1);
}

if (!existsSync(appPath)) {
  console.error(`⚠️  App path not found: ${appPath}, skipping...`);
  process.exit(0);
}

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
