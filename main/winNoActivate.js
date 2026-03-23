/**
 * On Windows, set WS_EX_NOACTIVATE on a BrowserWindow so that
 * showInactive() truly does not steal focus/activation.
 *
 * Without this, Electron's showInactive() still activates the window
 * in some Windows configurations.
 *
 * Uses PowerShell + P/Invoke to call SetWindowLong.
 */

const { exec } = require('child_process')

function setNoActivate(win) {
  if (process.platform !== 'win32') return
  try {
    const hwnd = win.getNativeWindowHandle().readBigInt64LE()
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinHelper {
  const int GWL_EXSTYLE = -20;
  const long WS_EX_NOACTIVATE = 0x08000000L;
  [DllImport("user32.dll")] static extern long GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] static extern long SetWindowLong(IntPtr hWnd, int nIndex, long dwNewLong);
  public static void Apply(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    long style = GetWindowLong(h, GWL_EXSTYLE);
    SetWindowLong(h, GWL_EXSTYLE, style | WS_EX_NOACTIVATE);
  }
}
"@
[WinHelper]::Apply(${hwnd})
`
    const enc = Buffer.from(ps, 'utf16le').toString('base64')
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`,
      (err) => {
        if (err) console.warn('[winNoActivate] failed:', err.message)
        else console.log('[winNoActivate] WS_EX_NOACTIVATE set on popup')
      }
    )
  } catch (e) {
    console.warn('[winNoActivate] error:', e.message)
  }
}

module.exports = { setNoActivate }
