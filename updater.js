const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

let updateProgress = {
  state: 'idle', // 'idle' | 'downloading' | 'restarting' | 'error'
  percent: 0,
  downloadedMB: 0,
  totalMB: 0,
  error: null
};

function compareVersions(vA, vB) {
  const partsA = String(vA || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const partsB = String(vB || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const a = partsA[i] || 0;
    const b = partsB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function getTargetExePath() {
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return process.env.PORTABLE_EXECUTABLE_FILE;
  }
  if (process.versions && process.versions.electron && !process.execPath.toLowerCase().endsWith('electron.exe')) {
    return process.execPath;
  }
  return null;
}

function downloadFileWithProgress(urlStr, destFile, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 8) {
      return reject(new Error('Çok fazla yönlendirme (redirect).'));
    }

    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (_) {
      return reject(new Error('Geçersiz indirme URL adresi.'));
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(
      urlStr,
      {
        headers: {
          'User-Agent': 'DijipinOperasyonUpdater/1.0'
        }
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          downloadFileWithProgress(nextUrl, destFile, redirectDepth + 1).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`İndirme başarısız (HTTP ${res.statusCode}).`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        updateProgress.totalMB = totalBytes > 0 ? Number((totalBytes / 1048576).toFixed(1)) : 0;

        const fileStream = fs.createWriteStream(destFile);
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          updateProgress.downloadedMB = Number((downloadedBytes / 1048576).toFixed(1));
          if (totalBytes > 0) {
            updateProgress.percent = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(downloadedBytes));
        });

        fileStream.on('error', (err) => {
          fs.unlink(destFile, () => {});
          reject(err);
        });
      }
    );

    req.on('error', (err) => {
      fs.unlink(destFile, () => {});
      reject(err);
    });
  });
}

function verifyWindowsExeFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 2 * 1024 * 1024) {
    throw new Error(
      'İndirilen dosya çok küçük (<2 MB). Lütfen paylaşım sayfası yerine doğrudan .exe indirme bağlantısı girin.'
    );
  }
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(2);
  fs.readSync(fd, header, 0, 2, 0);
  fs.closeSync(fd);
  if (header[0] !== 0x4d || header[1] !== 0x5a) {
    throw new Error(
      'İndirilen dosya geçerli bir Windows .exe dosyası değil (HTML sayfası dönmüş olabilir). Doğrudan indirme linki kullanın.'
    );
  }
}

async function downloadAndApplyExeUpdate(downloadUrl) {
  const targetExe = getTargetExePath();
  if (!targetExe) {
    throw new Error(
      'Otomatik güncelleme yalnızca masaüstü .exe uygulaması içinden çalıştırılabilir (şu an tarayıcı/geliştirici modundasınız).'
    );
  }

  if (updateProgress.state === 'downloading' || updateProgress.state === 'restarting') {
    return updateProgress;
  }

  updateProgress = {
    state: 'downloading',
    percent: 1,
    downloadedMB: 0,
    totalMB: 0,
    error: null
  };

  const tempDir = os.tmpdir();
  const stagedExe = path.join(tempDir, `Dijipin-Operasyon-Update-${Date.now()}.exe`);

  try {
    await downloadFileWithProgress(downloadUrl, stagedExe);
    verifyWindowsExeFile(stagedExe);

    updateProgress.state = 'restarting';
    updateProgress.percent = 100;

    // Arka planda eski .exe kapanana kadar bekleyip yenisini yerine koyan ve tekrar başlatan betik
    const updaterBat = path.join(tempDir, `dijipin_apply_update_${Date.now()}.cmd`);
    const batContent = [
      '@echo off',
      'chcp 65001 >nul',
      'set /a tries=0',
      ':retry',
      'timeout /t 2 /nobreak >nul',
      `move /Y "${stagedExe}" "${targetExe}" >nul 2>&1`,
      'if errorlevel 1 (',
      '  set /a tries+=1',
      '  if %tries% lss 15 goto retry',
      ')',
      `start "" "${targetExe}"`,
      'del "%~f0"'
    ].join('\r\n');

    fs.writeFileSync(updaterBat, batContent, 'utf8');

    const child = spawn('cmd.exe', ['/c', updaterBat], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    // Yanıt istemciye ulaştıktan hemen sonra mevcut uygulamayı kapat
    setTimeout(() => {
      process.exit(0);
    }, 900);

    return updateProgress;
  } catch (err) {
    try {
      if (fs.existsSync(stagedExe)) fs.unlinkSync(stagedExe);
    } catch (_) {}
    updateProgress = {
      state: 'error',
      percent: 0,
      downloadedMB: 0,
      totalMB: 0,
      error: err.message
    };
    throw err;
  }
}

function getUpdateProgress() {
  return {
    ...updateProgress,
    isDesktopExe: Boolean(getTargetExePath())
  };
}

module.exports = {
  compareVersions,
  downloadAndApplyExeUpdate,
  getUpdateProgress,
  getTargetExePath
};
