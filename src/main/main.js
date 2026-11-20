const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { YouTubeLiveChat } = require('./youtube-chat');
const { TikTokLiveChat } = require('./tiktok-chat');

// Prevent Chromium GPU/Disk cache permission & lock errors on Windows
const customUserData = path.join(app.getPath('appData'), 'ChatPanel');
try {
  fs.mkdirSync(customUserData, { recursive: true });
  app.setPath('userData', customUserData);
} catch (e) {
  // Fallback to default
}
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

// Ensure single instance: if already open, focus the existing window
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
let ytChat = null;
let ttChat = null;
let isAlwaysOnTop = true;
let isClickThrough = false;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const winWidth = 400;
  const winHeight = 640;

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: Math.max(20, screenWidth - winWidth - 30),
    y: Math.max(20, Math.floor((screenHeight - winHeight) / 2)),
    minWidth: 290,
    minHeight: 340,
    frame: false,
    transparent: true,
    alwaysOnTop: isAlwaysOnTop,
    hasShadow: false,
    resizable: true,
    skipTaskbar: false,
    icon: path.join(__dirname, '../../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Set highest always-on-top level so it stays above borderless games/apps
  mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    if (ytChat) ytChat.disconnect();
    if (ttChat) ttChat.disconnect();
    mainWindow = null;
  });
}

function setupChatManager() {
  if (!ytChat) {
    ytChat = new YouTubeLiveChat();
    ytChat.on('status', (statusPayload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:status', { platform: 'youtube', ...statusPayload });
      }
    });
    ytChat.on('chat', (chatMessage) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:message', chatMessage);
      }
    });
  }

  if (!ttChat) {
    ttChat = new TikTokLiveChat();
    ttChat.on('status', (statusPayload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:status', { platform: 'tiktok', ...statusPayload });
      }
    });
    ttChat.on('chat', (chatMessage) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:message', chatMessage);
      }
    });
  }
}

function registerShortcuts() {
  // Global shortcut: Ctrl+Shift+L to toggle Lock / Click-Through mode anytime
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    setClickThroughState(!isClickThrough);
  });

  // Global shortcut: Ctrl+Shift+T to toggle Pin on Top (Always on Top)
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    setAlwaysOnTopState(!isAlwaysOnTop);
  });
}

function setAlwaysOnTopState(value) {
  isAlwaysOnTop = Boolean(value);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');
    mainWindow.webContents.send('window:always-on-top-changed', isAlwaysOnTop);
  }
}

function setClickThroughState(value) {
  isClickThrough = Boolean(value);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (isClickThrough) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
    mainWindow.webContents.send('window:click-through-changed', isClickThrough);
  }
}

app.whenReady().then(() => {
  setupChatManager();
  createWindow();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==================== IPC HANDLERS ====================

ipcMain.handle('chat:connect', async (_event, payload) => {
  setupChatManager();
  const platform = typeof payload === 'object' ? payload.platform || 'youtube' : 'youtube';
  const targetInput = typeof payload === 'object' ? payload.target : payload;

  if (platform === 'tiktok') {
    await ttChat.connect(targetInput);
  } else {
    await ytChat.connect(targetInput);
  }
  return { ok: true };
});

ipcMain.handle('chat:disconnect', (_event, platform = 'youtube') => {
  if (platform === 'tiktok') {
    if (ttChat) ttChat.disconnect();
  } else {
    if (ytChat) ytChat.disconnect();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('chat:status', {
      platform,
      state: 'disconnected',
      message: 'Terputus'
    });
  }
  return { ok: true };
});

ipcMain.handle('window:toggle-always-on-top', (_event, forceValue) => {
  const nextState = typeof forceValue === 'boolean' ? forceValue : !isAlwaysOnTop;
  setAlwaysOnTopState(nextState);
  return isAlwaysOnTop;
});

ipcMain.handle('window:toggle-click-through', (_event, forceValue) => {
  const nextState = typeof forceValue === 'boolean' ? forceValue : !isClickThrough;
  setClickThroughState(nextState);
  return isClickThrough;
});

// Used when click-through is enabled but the user hovers over the small unlock button
ipcMain.on('window:set-ignore-mouse-events', (_event, ignore) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!isClickThrough) {
    mainWindow.setIgnoreMouseEvents(false);
    return;
  }
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});
