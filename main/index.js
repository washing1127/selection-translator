const { app, ipcMain, screen, Menu, Tray, nativeImage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit(); process.exit(0) }

// Hide dock on macOS
if (process.platform === 'darwin') app.dock.hide()

let config, cache, windowManager, mouseListener, accessibility, apiClient
let tray = null
let buttonVisible = false
let lastSelectedText = ''
let hideButtonTimer = null
let skipNextMouseUp = false  // set when mousedown closes popup, to suppress the paired mouseup

// Convert uiohook physical px → Electron logical px
function toLogical(physX, physY) {
  const scale = config?.ui?.dpiScale ?? 1.0
  return { x: Math.round(physX / scale), y: Math.round(physY / scale) }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const { readConfig } = require('./config')
  const { LRUCache } = require('./cache')
  const WindowManager = require('./windowManager')
  mouseListener  = require('./mouseListener')
  accessibility  = require('./accessibility')
  apiClient      = require('./apiClient')

  try {
    config = readConfig()
  } catch (err) {
    dialog.showErrorBox('Configuration Error', err.message)
    app.quit()
    return
  }

  cache = new LRUCache(config.cache.maxSize)
  windowManager = new WindowManager(config)

  await windowManager.init()
  setupIPC()
  setupMouseListener()
  setupTray()

  console.log('[Main] started, dpiScale:', config?.ui?.dpiScale ?? 1.0)
})

app.on('window-all-closed', e => e.preventDefault())
app.on('before-quit', () => {
  if (mouseListener) mouseListener.stopListening()
  if (process.platform === 'win32') {
    try { require('./sendKey').cleanup() } catch {}
  }
})

// ── Mouse listener ────────────────────────────────────────────────────────────

function setupMouseListener() {
  mouseListener.startListening({

    onMouseDown: ({ physX, physY }) => {
      const { x, y } = toLogical(physX, physY)
      // If popup is visible and click is outside, this mousedown will close it.
      // Mark skipNextMouseUp so the paired mouseup doesn't trigger text-read + Ctrl+C.
      if (windowManager && windowManager.isPopupVisible()) {
        const inside = windowManager.isPopupAt(x, y)
        if (!inside) skipNextMouseUp = true
      }
      // Click-outside: hide popup if click is outside popup bounds
      if (windowManager) windowManager.handleGlobalMouseDown(x, y)
      // Hide translate button if click is not on it
      if (windowManager && !windowManager.isButtonAt(x, y) && buttonVisible) {
        windowManager.hideButton()
        buttonVisible = false
        clearTimeout(hideButtonTimer)
      }
    },

    onMouseUp: async ({ physX, physY, didDrag, holdMs }) => {
      const { x, y } = toLogical(physX, physY)

      // Ignore plain short clicks (not a text selection)
      if (!didDrag && holdMs < 100) return

      // Don't retrigger when releasing mouse on our button
      if (windowManager && windowManager.isButtonAt(x, y)) return

      // If mousedown just closed the popup, skip this mouseup entirely.
      // Prevents Ctrl+C being sent to the newly focused window (e.g. terminal → SIGINT).
      if (skipNextMouseUp) { skipNextMouseUp = false; return }

      setTimeout(async () => {
        const text = await accessibility.getSelectedText()
        if (text && text.trim().length > 1) {
          lastSelectedText = text.trim()
          windowManager.showButton(x, y, lastSelectedText)
          buttonVisible = true
          clearTimeout(hideButtonTimer)
          hideButtonTimer = setTimeout(() => {
            if (buttonVisible) { windowManager.hideButton(); buttonVisible = false }
          }, 4000)
        } else {
          if (buttonVisible) { windowManager.hideButton(); buttonVisible = false }
        }
      }, 80)  // 80ms: enough for OS to finalize selection
    }
  })
}

// ── IPC ───────────────────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('get-selected-text', () => lastSelectedText)

  // Fresh read at button-click time — bypasses stale lastSelectedText cache
  ipcMain.handle('read-selected-text-now', async () => {
    const text = await accessibility.getSelectedText()
    if (text && text.trim().length > 1) {
      lastSelectedText = text.trim()  // update cache while we're at it
      return lastSelectedText
    }
    return lastSelectedText  // fallback to cached
  })

  ipcMain.handle('translate', async (event, { text }) => {
    const key = `${config.api.provider}:::${config.translation.targetLang}:::${text}`
    const cached = cache.get(key)
    if (cached) return { success: true, result: cached, fromCache: true }
    try {
      const result = await apiClient.translateText(text, config)
      cache.set(key, result)
      return { success: true, result, fromCache: false }
    } catch (err) {
      console.error('[translate]', err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.on('show-popup', (event, { x, y, text, translation, fromCache }) => {
    buttonVisible = false
    clearTimeout(hideButtonTimer)
    windowManager.hideButton()  // belt-and-suspenders: also called inside showPopup
    windowManager.showPopup(x, y, text, translation, fromCache)
  })

  ipcMain.on('hide-button', () => { windowManager.hideButton(); buttonVisible = false })
  ipcMain.on('hide-popup',  () => windowManager.hidePopup())
  ipcMain.on('set-popup-locked', (event, locked) => windowManager.setPopupLocked(locked))
  ipcMain.handle('get-config',     () => config)
  ipcMain.handle('get-cursor-pos', () => screen.getCursorScreenPoint())
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function setupTray() {
  const iconPath = path.join(__dirname, '../assets/tray.png')
  let icon
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVQ4y2NgYGD4z0A6YBx1gKGBgYGBiVQHjDogNIwGwmggDEYdAABHEAAZyYWmFQAAAABJRU5ErkJggg=='
    icon = nativeImage.createFromDataURL(`data:image/png;base64,${b64}`)
  }
  if (process.platform === 'darwin') icon.setTemplateImage(true)

  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Selection Translator')
  tray.setContextMenu(buildContextMenu())
  if (process.platform === 'win32') tray.on('click', () => tray.popUpContextMenu())
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Selection Translator', enabled: false },
    { type: 'separator' },
    { label: `Provider: ${config?.api?.provider ?? '—'}`, enabled: false },
    { label: `DPI Scale: ${config?.ui?.dpiScale ?? 1.0}`, enabled: false },
    { label: `Cache: ${cache?.size ?? 0} / ${config?.cache?.maxSize ?? 500}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Reload Config', click: () => {
        try {
          config = require('./config').readConfig()
          cache.clear()
          windowManager.config = config
          tray.setContextMenu(buildContextMenu())
          console.log('[Main] config reloaded')
        } catch (err) { dialog.showErrorBox('Config Error', err.message) }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
}
