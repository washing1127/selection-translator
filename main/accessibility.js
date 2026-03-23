const { clipboard } = require('electron')
const { exec } = require('child_process')

async function getSelectedText() {
  if (process.platform === 'win32')  return getWindows()
  if (process.platform === 'darwin') return getMac()
  return ''
}

// ── Windows ───────────────────────────────────────────────────────────────────

async function getWindows() {
  // 1. UI Automation — fast, no side effects, works for browsers/native apps
  try {
    const text = await windowsUIA()
    if (text) return text
  } catch {}

  // 2. Clipboard method — for Electron apps (Trae/VSCode), WeChat, etc.
  return clipboardMethod('win32')
}

function windowsUIA() {
  const ps = `
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
      { timeout: 2000 },
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
  try {
    const text = await macAX()
    if (text) return text
  } catch {}
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

// ── Clipboard method ──────────────────────────────────────────────────────────

async function clipboardMethod(platform) {
  const savedText = clipboard.readText()
  const savedHTML = clipboard.readHTML()
  const savedRTF  = clipboard.readRTF()

  const SENTINEL = '\u0000__seltrans__\u0000'
  clipboard.writeText(SENTINEL)

  await sendCopyKey(platform)
  await sleep(80)  // wait for clipboard to update

  const newText = clipboard.readText()

  // Restore clipboard asynchronously
  setTimeout(() => {
    try {
      if (savedHTML) clipboard.write({ text: savedText, html: savedHTML, rtf: savedRTF })
      else clipboard.writeText(savedText)
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
    // Windows: use persistent PS process for low latency
    const { sendCtrlC } = require('./sendKey')
    return sendCtrlC()
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = { getSelectedText }
