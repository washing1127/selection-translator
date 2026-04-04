const { app, ipcMain, screen, Menu, Tray, nativeImage, dialog, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit(); process.exit(0) }

if (process.platform === 'darwin') app.dock.hide()

let config, cache, windowManager, mouseListener, accessibility, apiClient
let tray = null
let buttonVisible = false
let lastSelectedText = ''
let hideButtonTimer = null
let skipNextMouseUp = false
let lastMouseUpTime = 0
let lastMouseUpPos = { x: 0, y: 0 }

function toLogical(physX, physY) {
  try {
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    let chosen = primary
    for (const d of displays) {
      const scale = d.scaleFactor || 1.0
      const bx = d.bounds.x * scale
      const by = d.bounds.y * scale
      const bw = d.bounds.width * scale
      const bh = d.bounds.height * scale
      if (physX >= bx && physX <= bx + bw && physY >= by && physY <= by + bh) {
        chosen = d
        break
      }
    }
    const scale = chosen.scaleFactor || 1.0
    return { x: Math.round(physX / scale), y: Math.round(physY / scale) }
  } catch {
    const scale = config?.ui?.dpiScale ?? 1.0
    return { x: Math.round(physX / scale), y: Math.round(physY / scale) }
  }
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

  if (process.platform === 'win32') {
    setupMouseListener()
  } else if (process.platform === 'darwin') {
    setupMacShortcut()
  }

  setupTray()
  console.log('[Main] started, dpiScale:', config?.ui?.dpiScale ?? 1.0)
})

app.on('window-all-closed', e => e.preventDefault())
app.on('before-quit', () => {
  if (process.platform === 'darwin') globalShortcut.unregisterAll()
  if (mouseListener) mouseListener.stopListening()
  if (process.platform === 'win32') {
    try { require('./sendKey').cleanup() } catch {}
  }
})

// ── macOS shortcut (Option+F) ─────────────────────────────────────────────────

function setupMacShortcut() {
  globalShortcut.register('Alt+F', async () => {
    // Toggle: if popup already visible, close it
    if (windowManager && windowManager.isPopupVisible()) {
      windowManager.hidePopup()
      return
    }

    const text = await accessibility.getSelectedText()
    if (!text || text.trim().length < 1) return

    lastSelectedText = text.trim()
    const pos = screen.getCursorScreenPoint()
    const key = `${config.api.provider}:::${config.translation.targetLang}:::${lastSelectedText}`
    const cached = cache.get(key)
    if (cached) {
      windowManager.showPopup(pos.x, pos.y, lastSelectedText, cached, true)
      return
    }

    try {
      const result = await apiClient.translateText(lastSelectedText, config)
      cache.set(key, result)
      windowManager.showPopup(pos.x, pos.y, lastSelectedText, result, false)
    } catch (err) {
      console.error('[translate]', err.message)
    }
  })
  console.log('[Main] macOS shortcut registered: Option+F')
}

// ── Windows mouse listener ────────────────────────────────────────────────────

function setupMouseListener() {
  mouseListener.startListening({

    onMouseDown: ({ physX, physY }) => {
      const { x, y } = toLogical(physX, physY)
      if (windowManager && windowManager.isPopupVisible()) {
        const inside = windowManager.isPopupAt(x, y)
        if (!inside) skipNextMouseUp = true
      }
      if (windowManager) windowManager.handleGlobalMouseDown(x, y)
      if (windowManager && !windowManager.isButtonAt(x, y) && buttonVisible) {
        windowManager.hideButton()
        buttonVisible = false
        clearTimeout(hideButtonTimer)
      }
    },

    onMouseUp: async ({ physX, physY, didDrag, holdMs }) => {
      const { x, y } = toLogical(physX, physY)
      if (windowManager && windowManager.isButtonAt(x, y)) return
      if (skipNextMouseUp) { skipNextMouseUp = false; return }

      const now = Date.now()
      const dx = Math.abs(x - lastMouseUpPos.x)
      const dy = Math.abs(y - lastMouseUpPos.y)
      const isDoubleClick = (now - lastMouseUpTime < 400) && dx < 8 && dy < 8
      lastMouseUpTime = now
      lastMouseUpPos = { x, y }

      if (!didDrag && holdMs < 100 && !isDoubleClick) return

      try {
        const text = await accessibility.getSelectedText()
        if (text && text.trim().length > 1) {
          lastSelectedText = text.trim()
          windowManager.showButton(x, y)
          buttonVisible = true
          clearTimeout(hideButtonTimer)
          hideButtonTimer = setTimeout(() => {
            if (buttonVisible) { windowManager.hideButton(); buttonVisible = false }
          }, 4000)
        } else {
          if (buttonVisible) { windowManager.hideButton(); buttonVisible = false }
        }
      } catch {
        if (buttonVisible) { windowManager.hideButton(); buttonVisible = false }
      }
    }
  })
}

// ── IPC ───────────────────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('get-selected-text', () => lastSelectedText)

  ipcMain.handle('read-selected-text-now', async () => {
    const text = await accessibility.getSelectedText()
    if (text && text.trim().length > 1) {
      lastSelectedText = text.trim()
      return lastSelectedText
    }
    return lastSelectedText
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
    windowManager.hideButton()
    windowManager.showPopup(x, y, text, translation, fromCache)
  })

  ipcMain.on('show-popup-loading', (event, { x, y }) => {
    buttonVisible = false
    clearTimeout(hideButtonTimer)
    windowManager.hideButton()
    windowManager.showPopupLoading(x, y)
  })

  ipcMain.on('show-popup-content', (event, { text, translation, fromCache }) => {
    windowManager.updatePopupContent(text, translation, fromCache)
  })

  ipcMain.on('show-popup-error', (event, { msg }) => {
    windowManager.updatePopupError(msg)
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
