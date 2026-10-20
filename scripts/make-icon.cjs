// Rasterize build/icon.svg to build/icon.png with Electron:  npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const svg = readFileSync(join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  let frames = 0;
  win.webContents.on('paint', (_e, _dirty, image) => {
    // Skip the first frames, which can be blank while the SVG loads.
    if (++frames < 3) return;
    writeFileSync(join(__dirname, '..', 'build', 'icon.png'), image.resize({ width: 512, height: 512 }).toPNG());
    app.quit();
  });
  win.webContents.setFrameRate(30);
  win.loadURL(`data:text/html,<body style="margin:0;background:transparent;overflow:hidden">${encodeURIComponent(svg)}</body>`);
  setTimeout(() => win.webContents.invalidate(), 300);
  setTimeout(() => win.webContents.invalidate(), 600);
  setTimeout(() => app.exit(1), 10000);
});
