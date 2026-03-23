/**
 * sendCtrlC() for Windows — low latency key sender.
 *
 * Keeps a PowerShell process alive and sends commands via stdin pipe.
 * First call: ~300ms (PowerShell startup). Subsequent calls: ~20ms.
 *
 * Falls back to spawning a new process if the persistent one dies.
 */

const { spawn } = require('child_process')

let psProcess = null
let psReady = false
let initPromise = null

function initPS() {
  if (initPromise) return initPromise
  initPromise = new Promise((resolve) => {
    try {
      psProcess = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-NoExit',
        '-Command', '-'   // read commands from stdin
      ], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      })

      psProcess.stdout.once('data', () => {
        psReady = true
        resolve(true)
      })

      // Send a no-op command to trigger the first stdout response
      // so we know PS is ready
      psProcess.stdin.write('Write-Output "ready"\n')

      psProcess.on('exit', () => {
        psProcess = null
        psReady = false
        initPromise = null
      })

      psProcess.on('error', () => {
        psProcess = null
        psReady = false
        initPromise = null
        resolve(false)
      })

      // Timeout: if PS doesn't respond in 2s, consider it failed
      setTimeout(() => resolve(false), 2000)
    } catch (e) {
      initPromise = null
      resolve(false)
    }
  })
  return initPromise
}

// Pre-compile the SendKeys Add-Type block once, so subsequent calls are instant
const ADD_TYPE_CMD = `
Add-Type -AssemblyName System.Windows.Forms
function Send-CtrlC { [System.Windows.Forms.SendKeys]::SendWait("^c") }
Write-Output "ctrlc_ready"
`

let ctrlCReady = false

async function ensureCtrlCReady() {
  if (ctrlCReady) return true
  const ok = await initPS()
  if (!ok || !psProcess) return false
  return new Promise((resolve) => {
    const onData = (data) => {
      if (data.toString().includes('ctrlc_ready')) {
        psProcess.stdout.removeListener('data', onData)
        ctrlCReady = true
        resolve(true)
      }
    }
    psProcess.stdout.on('data', onData)
    psProcess.stdin.write(ADD_TYPE_CMD + '\n')
    setTimeout(() => resolve(false), 2000)
  })
}

/**
 * Send Ctrl+C to the currently focused window.
 * Returns a promise that resolves when the key has been sent.
 */
async function sendCtrlC() {
  const ready = await ensureCtrlCReady()
  if (!ready || !psProcess) {
    // Fallback: spawn a new process (slow but reliable)
    return sendCtrlCFallback()
  }

  return new Promise((resolve) => {
    const onData = (data) => {
      if (data.toString().includes('ctrlc_sent')) {
        psProcess.stdout.removeListener('data', onData)
        resolve()
      }
    }
    psProcess.stdout.on('data', onData)
    psProcess.stdin.write('Send-CtrlC; Write-Output "ctrlc_sent"\n')
    setTimeout(resolve, 500)  // safety timeout
  })
}

function sendCtrlCFallback() {
  return new Promise((resolve) => {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^c")`
    const enc = Buffer.from(ps, 'utf16le').toString('base64')
    const { exec } = require('child_process')
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`,
      { timeout: 2000 }, () => resolve())
  })
}

function cleanup() {
  if (psProcess) {
    try { psProcess.stdin.write('exit\n') } catch {}
    psProcess = null
  }
}

// Pre-warm the PS process on module load
// This runs in background — first actual sendCtrlC() call will be fast
setTimeout(() => ensureCtrlCReady(), 1000)

module.exports = { sendCtrlC, cleanup }
