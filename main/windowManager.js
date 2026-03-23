/**
 * WindowManager
 *
 * Popup close behavior:
 *   showInactive() — popup never steals focus, so scroll/keyboard stay in background app.
 *   Click-outside detection via handleGlobalMouseDown() called from mouseListener.
 *
 * No scroll tracking.
 * All coords are Electron logical pixels (already DPI-converted by caller).
 */

const { BrowserWindow, screen } = require('electron')
const path = require('path')
const { setNoActivate } = require('./winNoActivate')

class WindowManager {
  constructor(config) {
    this.config = config
    this.buttonWin = null
    this.popupWin = null
    this.popupLocked = false
  }

  async init() {
    await this._createButtonWindow()
    await this._createPopupWindow()
  }

  // ── Click-outside detection ───────────────────────────────────────────────
  // Called from main process on every global mousedown (via uiohook setImmediate).

  handleGlobalMouseDown(x, y) {
    if (!this.popupWin?.isVisible()) return
    if (this.popupLocked) return
    const [px, py] = this.popupWin.getPosition()
    const [pw, ph] = this.popupWin.getSize()
    const inside = x >= px && x <= px + pw && y >= py && y <= py + ph
    if (!inside) this.hidePopup()
  }

  // ── Button window ─────────────────────────────────────────────────────────

  async _createButtonWindow() {
    this.buttonWin = new BrowserWindow({
      width: 30, height: 30,
      show: false, frame: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false,
      focusable: false,  // never steal focus
      hasShadow: false,
      type: process.platform === 'darwin' ? 'panel' : 'toolbar',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    if (process.platform === 'darwin') {
      this.buttonWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    if (process.platform === 'win32') {
      this.buttonWin.setAlwaysOnTop(true, 'screen-saver')
    }
    this.buttonWin.loadFile(path.join(__dirname, '../renderer/button/index.html'))
  }

  showButton(x, y) {
    if (!this.buttonWin) return
    const cfg = this.config.ui || {}
    let bx = Math.round(x + (cfg.buttonOffsetX ?? 12))
    let by = Math.round(y + (cfg.buttonOffsetY ?? -8))
    const { bounds } = screen.getDisplayNearestPoint({ x, y })
    bx = Math.max(bounds.x, Math.min(bx, bounds.x + bounds.width  - 32))
    by = Math.max(bounds.y, Math.min(by, bounds.y + bounds.height - 32))
    this.buttonWin.setPosition(bx, by, false)
    this.buttonWin.showInactive()
    this.buttonWin.webContents.send('update-opacity', cfg.buttonOpacity ?? 0.75)
  }

  hideButton() {
    if (this.buttonWin?.isVisible()) this.buttonWin.hide()
  }

  isButtonAt(x, y) {
    if (!this.buttonWin?.isVisible()) return false
    const [bx, by] = this.buttonWin.getPosition()
    const [bw, bh] = this.buttonWin.getSize()
    return x >= bx && x <= bx + bw && y >= by && y <= by + bh
  }

  // ── Popup window ──────────────────────────────────────────────────────────

  async _createPopupWindow() {
    this.popupWin = new BrowserWindow({
      width: 360, height: 190,
      minWidth: 260, minHeight: 130,
      show: false, frame: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true,
      resizable: true, movable: true,
      focusable: true,   // must be true so user can click inside (copy button, etc.)
      hasShadow: false,
      type: process.platform === 'darwin' ? 'panel' : 'toolbar',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        zoomFactor: 1.0
      }
    })
    if (process.platform === 'darwin') {
      this.popupWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    if (process.platform === 'win32') {
      this.popupWin.setAlwaysOnTop(true, 'screen-saver')
    }
    this.popupWin.loadFile(path.join(__dirname, '../renderer/popup/index.html'))

    // Set WS_EX_NOACTIVATE so the popup truly never steals focus on Windows
    this.popupWin.once('ready-to-show', () => {
      setNoActivate(this.popupWin)
    })
    // No blur handler — close is handled via handleGlobalMouseDown()
  }

  showPopup(anchorX, anchorY, text, translation, fromCache = false) {
    if (!this.popupWin) return
    // Hide button immediately and synchronously before anything else
    this.hideButton()

    const { bounds } = screen.getDisplayNearestPoint({ x: anchorX, y: anchorY })
    const pw = 360, ph = 190, margin = 14

    let px = anchorX + margin
    let py = anchorY + margin
    if (px + pw > bounds.x + bounds.width)  px = anchorX - pw - margin
    if (py + ph > bounds.y + bounds.height) py = anchorY - ph - margin
    px = Math.max(bounds.x + 4, Math.min(px, bounds.x + bounds.width  - pw - 4))
    py = Math.max(bounds.y + 4, Math.min(py, bounds.y + bounds.height - ph - 4))

    this.popupWin.setPosition(Math.round(px), Math.round(py), false)
    this.popupWin.webContents.send('show-content', {
      text, translation,
      provider: this.config.api.provider,
      fromCache: !!fromCache
    })
    // showInactive: popup appears without stealing focus
    // → background app keeps focus, scroll/keyboard work normally
    this.popupWin.showInactive()
  }

  hidePopup() {
    if (!this.popupWin?.isVisible()) return
    this.popupLocked = false
    this.popupWin.webContents.send('reset-state')
    this.popupWin.hide()  // hide immediately — no delay to avoid focus race conditions
  }

  setPopupLocked(locked) {
    this.popupLocked = locked
  }

  isPopupVisible() {
    return this.popupWin?.isVisible() ?? false
  }

  isPopupAt(x, y) {
    if (!this.popupWin?.isVisible()) return false
    const [px, py] = this.popupWin.getPosition()
    const [pw, ph] = this.popupWin.getSize()
    return x >= px && x <= px + pw && y >= py && y <= py + ph
  }
}

module.exports = WindowManager
