const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let serverInstance = null;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      // Yazılabilir kullanıcı veri klasörünü ayarla (.exe paketinde app.asar salt okunurdur)
      process.env.OP_USER_DATA_DIR = app.getPath('userData');

      const { startServer } = require('./server');
      const { server, port } = await startServer(0, '127.0.0.1');
      serverInstance = server;

      const iconPath = path.join(__dirname, 'public', 'app-icon.png');

      mainWindow = new BrowserWindow({
        width: 1460,
        height: 900,
        minWidth: 1024,
        minHeight: 680,
        title: 'Dijipin Operasyon Takip',
        backgroundColor: '#0b0d13',
        icon: iconPath,
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      mainWindow.setMenuBarVisibility(false);

      // Dış bağlantıları varsayılan tarayıcıda, yerel "Çıktı Al" pencerelerini ise masaüstü penceresinde aç
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || (url.startsWith('http://') && !url.includes('127.0.0.1'))) {
          shell.openExternal(url);
          return { action: 'deny' };
        }
        const child = new BrowserWindow({
          width: 1380,
          height: 840,
          title: 'Haftalık Vardiya & İzin Çizelgesi',
          backgroundColor: '#0b0d13',
          icon: iconPath,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        });
        child.setMenuBarVisibility(false);
        child.loadURL(url);
        return { action: 'deny' };
      });

      await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
    } catch (err) {
      dialog.showErrorBox('Başlatma Hatası', `Uygulama başlatılamadı:\n${err.message}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (serverInstance) {
      try {
        serverInstance.close();
      } catch (_) {}
    }
    app.quit();
  });
}
