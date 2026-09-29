'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const { resolveStartUrl, createUrlPolicy } = require('./url-policy.cjs');

const startUrl = resolveStartUrl({
  isPackaged: app.isPackaged,
  override: process.env.VANTAGE_DESKTOP_URL
});
const urls = createUrlPolicy(startUrl);
const partition = 'persist:vantage';
let mainWindow = null;

async function openExternal(value) {
  if (!urls.isExternalUrl(value)) return;
  try {
    await shell.openExternal(value);
  } catch (error) {
    console.error('无法打开外部链接:', error.message);
  }
}

function createMenu() {
  const menu = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '在浏览器中打开 Vantage', click: () => openExternal(startUrl) },
        { type: 'separator' },
        ...(process.platform === 'darwin' ? [{ role: 'close' }] : [{ role: 'quit' }])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: '显示',
      submenu: [
        { label: '刷新工作台', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.loadURL(startUrl) },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])
      ]
    },
    { role: 'windowMenu' },
    {
      label: '帮助',
      submenu: [
        { label: 'Vantage 网站', click: () => openExternal('https://vantage.limnov.com/') },
        { label: '项目源码', click: () => openExternal('https://github.com/Limnov/Vantage') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f5f6f7',
    title: 'Vantage',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false
    }
  });

  const contents = mainWindow.webContents;
  const show = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  };
  mainWindow.once('ready-to-show', show);
  const showTimeout = setTimeout(show, 12000);
  mainWindow.on('closed', () => {
    clearTimeout(showTimeout);
    mainWindow = null;
  });

  const restrictNavigation = (event, target) => {
    if (urls.isAppUrl(target)) return;
    event.preventDefault();
    openExternal(target);
  };
  contents.on('will-navigate', restrictNavigation);
  contents.on('will-redirect', restrictNavigation);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-fail-load', (_event, code, _description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 || !urls.isAppUrl(failedUrl)) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadFile(path.join(__dirname, 'offline.html'), {
      query: { target: startUrl }
    }).catch((error) => console.error('无法显示离线页面:', error.message));
  });

  mainWindow.loadURL(startUrl).catch(() => {});
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.limnov.vantage');
  const appSession = session.fromPartition(partition);
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  appSession.setPermissionCheckHandler(() => false);
  createMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
