const { BrowserWindow, screen } = require('electron')
const path = require('path')
const { setNoActivate, clearNoActivate } = require('./winNoActivate')

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
      focusable: false,
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
      width: 360, height: 300,
      minWidth: 260, minHeight: 200,
      show: false, frame: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true,
      resizable: true, movable: true,
      focusable: true,
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
      this.popupWin.once('ready-to-show', () => setNoActivate(this.popupWin))
    }
    this.popupWin.loadFile(path.join(__dirname, '../renderer/popup/index.html'))

    if (process.platform === 'darwin') {
      this.popupWin.on('blur', () => {
        if (!this.popupLocked) this.hidePopup()
      })
    }
  }

  _positionPopup(anchorX, anchorY) {
    const { bounds } = screen.getDisplayNearestPoint({ x: anchorX, y: anchorY })
    const [pw, ph] = this.popupWin.getSize()
    const margin = 14
    let px = anchorX + margin
    let py = anchorY + margin
    if (px + pw > bounds.x + bounds.width)  px = anchorX - pw - margin
    if (py + ph > bounds.y + bounds.height) py = anchorY - ph - margin
    px = Math.max(bounds.x + 4, Math.min(px, bounds.x + bounds.width  - pw - 4))
    py = Math.max(bounds.y + 4, Math.min(py, bounds.y + bounds.height - ph - 4))
    this.popupWin.setPosition(Math.round(px), Math.round(py), false)
  }

  showPopup(anchorX, anchorY, text, translation, fromCache = false) {
    if (!this.popupWin) return
    this.hideButton()

    this._positionPopup(anchorX, anchorY)
    this.popupWin.webContents.send('show-content', {
      text, translation,
      provider: this.config.api.provider,
      fromCache: !!fromCache
    })

    if (process.platform === 'darwin') {
      this.popupWin.show()
      this.popupWin.focus()
    } else {
      this.popupWin.showInactive()
    }
  }

  showPopupLoading(anchorX, anchorY) {
    if (!this.popupWin) return
    this.hideButton()
    this._positionPopup(anchorX, anchorY)
    this.popupWin.webContents.send('show-loading')
    if (process.platform === 'darwin') {
      this.popupWin.show()
      this.popupWin.focus()
    } else {
      this.popupWin.showInactive()
    }
  }

  updatePopupContent(text, translation, fromCache = false) {
    if (!this.popupWin) return
    this.popupWin.webContents.send('show-content', {
      text, translation,
      provider: this.config.api.provider,
      fromCache: !!fromCache
    })
  }

  updatePopupError(msg) {
    if (!this.popupWin) return
    this.popupWin.webContents.send('show-error', { msg })
  }

  focusPopup() {
    if (!this.popupWin?.isVisible()) return
    if (process.platform === 'win32') {
      clearNoActivate(this.popupWin, () => { this.popupWin?.focus() })
    } else {
      this.popupWin.focus()
    }
  }

  hidePopup() {
    if (!this.popupWin?.isVisible()) return
    this.popupLocked = false
    this.popupWin.webContents.send('reset-state')
    this.popupWin.hide()
    // Re-apply WS_EX_NOACTIVATE so next showInactive() won't steal focus
    if (process.platform === 'win32') setNoActivate(this.popupWin)
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
