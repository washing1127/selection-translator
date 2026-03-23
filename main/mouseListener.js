/**
 * Global mouse listener via uiohook-napi.
 *
 * IMPORTANT: uiohook callbacks fire on a native C++ thread.
 * All Electron/Node.js API calls MUST be deferred via setImmediate()
 * to avoid FATAL napi_call_function crashes.
 *
 * Coordinates reported here are PHYSICAL pixels.
 * Caller must divide by config.ui.dpiScale to get Electron logical pixels.
 */

let uiohook = null
let callbacks = {}
let mouseIsDown = false
let mouseDownPos = { x: 0, y: 0 }
let mouseDownTime = 0

function startListening(cbs) {
  callbacks = cbs
  try {
    const { uIOhook } = require('uiohook-napi')
    uiohook = uIOhook

    uiohook.on('mousedown', (e) => {
      if (e.button !== 1) return
      // Snapshot values immediately (e may be reused)
      const x = e.x, y = e.y
      mouseIsDown = true
      mouseDownPos = { x, y }
      mouseDownTime = Date.now()
      // Defer to Node.js main thread
      setImmediate(() => {
        if (callbacks.onMouseDown) callbacks.onMouseDown({ physX: x, physY: y })
      })
    })

    uiohook.on('mouseup', (e) => {
      if (e.button !== 1) return
      if (!mouseIsDown) return
      mouseIsDown = false
      const x = e.x, y = e.y
      const dx = Math.abs(x - mouseDownPos.x)
      const dy = Math.abs(y - mouseDownPos.y)
      const holdMs = Date.now() - mouseDownTime
      const didDrag = dx > 4 || dy > 4
      setImmediate(() => {
        if (callbacks.onMouseUp) callbacks.onMouseUp({ physX: x, physY: y, didDrag, holdMs })
      })
    })

    uiohook.start()
    console.log('[MouseListener] started')
    return true
  } catch (err) {
    console.error('[MouseListener] failed to load uiohook-napi:', err.message)
    return false
  }
}

function stopListening() {
  if (uiohook) {
    try { uiohook.stop() } catch {}
    uiohook = null
  }
}

module.exports = { startListening, stopListening }
