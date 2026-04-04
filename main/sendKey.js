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

// Pre-compile the SendKeys and SendInput helpers once
const ADD_TYPE_CMD = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KB {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const ushort VK_CONTROL = 0x11;
  public static void ReleaseCtrl() {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.U.ki.wVk = VK_CONTROL;
    i.U.ki.wScan = 0;
    i.U.ki.dwFlags = KEYEVENTF_KEYUP;
    i.U.ki.time = 0;
    i.U.ki.dwExtraInfo = IntPtr.Zero;
    SendInput(1, new INPUT[]{ i }, System.Runtime.InteropServices.Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
function Send-CtrlC { [System.Windows.Forms.SendKeys]::SendWait("^c") }
function Release-Ctrl { [KB]::ReleaseCtrl() }
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
    psProcess.stdin.write('Send-CtrlC; Release-Ctrl; Write-Output "ctrlc_sent"\n')
    setTimeout(resolve, 500)  // safety timeout
  })
}

function sendCtrlCFallback() {
  return new Promise((resolve) => {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KB {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const ushort VK_CONTROL = 0x11;
  public static void ReleaseCtrl() {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.U.ki.wVk = VK_CONTROL;
    i.U.ki.wScan = 0;
    i.U.ki.dwFlags = KEYEVENTF_KEYUP;
    i.U.ki.time = 0;
    i.U.ki.dwExtraInfo = IntPtr.Zero;
    SendInput(1, new INPUT[]{ i }, System.Runtime.InteropServices.Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
[System.Windows.Forms.SendKeys]::SendWait("^c"); [KB]::ReleaseCtrl()
`
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
