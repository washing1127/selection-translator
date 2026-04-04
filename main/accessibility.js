const { clipboard } = require('electron')
const { exec } = require('child_process')

async function getSelectedText() {
  if (process.platform === 'win32')  return getWindows()
  if (process.platform === 'darwin') return getMac()
  return ''
}

// ── Windows ───────────────────────────────────────────────────────────────────

async function getWindows() {
  try {
    const text = await windowsUIA()
    if (text) return text
  } catch {}
  try {
    const inTerm = await isTerminalForeground()
    if (inTerm) return ''
  } catch {}
  return clipboardMethod('win32')
}

function windowsUIA() {
  const ps = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$el = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($el -eq $null) { exit }
try {
  $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
  $sel = $tp.GetSelection()
  if ($sel.Length -gt 0) {
    $t = $sel[0].GetText(-1)
    if ($t.Length -gt 0) { Write-Output $t }
  }
} catch {}
`
  return new Promise((resolve, reject) => {
    const enc = Buffer.from(ps, 'utf16le').toString('base64')
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`,
      { timeout: 2000, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return reject(err)
        const t = stdout.trim()
        resolve(t.length > 0 ? t : null)
      }
    )
  })
}

// ── macOS ─────────────────────────────────────────────────────────────────────

async function getMac() {
  // Try AXSelectedText first (no side effects)
  try {
    const text = await macAX()
    if (text) return text
  } catch {}
  // Fallback: clipboard method
  return clipboardMethod('darwin')
}

function macAX() {
  const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  tell frontApp
    try
      set el to (first UI element of (first window) whose focused is true)
      return value of attribute "AXSelectedText" of el
    end try
  end tell
end tell
return ""`
  return new Promise((resolve, reject) => {
    exec(`osascript << 'EOF'\n${script}\nEOF`, { timeout: 3000 },
      (err, stdout) => {
        if (err) return reject(err)
        const t = stdout.trim()
        resolve(t.length > 0 ? t : null)
      }
    )
  })
}

// ── Clipboard method (both platforms) ────────────────────────────────────────

async function clipboardMethod(platform) {
  const savedText  = clipboard.readText()
  const savedHTML  = clipboard.readHTML()
  const savedRTF   = clipboard.readRTF()
  const savedImage = clipboard.readImage()
  const hasImage   = !savedImage.isEmpty()

  const SENTINEL = '\u0000__seltrans__\u0000'
  clipboard.writeText(SENTINEL)

  await sendCopyKey(platform)
  let newText = ''
  for (const wait of [60, 120, 200]) {
    await sleep(wait)
    const t = clipboard.readText()
    if (t && !t.includes('__seltrans__')) { newText = t; break }
  }

  setTimeout(() => {
    try {
      if (hasImage) {
        clipboard.write({ text: savedText, html: savedHTML, rtf: savedRTF, image: savedImage })
      } else if (savedHTML) {
        clipboard.write({ text: savedText, html: savedHTML, rtf: savedRTF })
      } else {
        clipboard.writeText(savedText)
      }
    } catch { try { clipboard.writeText(savedText) } catch {} }
  }, 50)

  if (newText && !newText.includes('__seltrans__')) return newText.trim()
  return ''
}

function sendCopyKey(platform) {
  if (platform === 'darwin') {
    return new Promise((resolve) => {
      exec(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`,
        { timeout: 1000 }, () => resolve())
    })
  } else {
    const { sendCtrlC } = require('./sendKey')
    return sendCtrlC()
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function isTerminalForeground() {
  const ps = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$h = [FG]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { return }
$pid = 0
[void][FG]::GetWindowThreadProcessId($h, [ref]$pid)
try {
  $p = Get-Process -Id $pid -ErrorAction Stop
  ($p.ProcessName).ToLowerInvariant()
} catch {}
`
  return new Promise((resolve, reject) => {
    const enc = Buffer.from(ps, 'utf16le').toString('base64')
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`, { timeout: 2000, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return reject(err)
        const name = (stdout || '').trim().toLowerCase()
        if (!name) return resolve(false)
        const list = [
          'conhost','cmd','powershell','pwsh','windowsterminal','wt',
          'alacritty','wezterm','mintty','hyper','cmder','git-bash','bash'
        ]
        resolve(list.some(n => name.includes(n)))
      })
  })
}

module.exports = { getSelectedText }
