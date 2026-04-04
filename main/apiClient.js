const https = require('https')
const http = require('http')

const LANG_NAMES = {
  zh: 'Simplified Chinese', en: 'English', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian'
}

function _request(body, providerConfig, apiKey) {
  const url = new URL(providerConfig.baseUrl + providerConfig.chatPath)
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)))
          const content = json.choices?.[0]?.message?.content
          if (!content) return reject(new Error(`Unexpected response: ${data.slice(0, 200)}`))
          resolve(content.trim())
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`))
        }
      })
    })
    req.on('error', e => reject(new Error(`Network error: ${e.message}`)))
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
    req.write(body)
    req.end()
  })
}

async function translateText(text, config, effectiveTargetLang) {
  const { provider, apiKey, providers } = config.api
  const { sourceLang, targetLang } = config.translation
  const providerConfig = providers[provider]
  if (!providerConfig) throw new Error(`Unknown provider: ${provider}`)

  const model = config.api.model || providerConfig.model
  const target = LANG_NAMES[effectiveTargetLang || targetLang] || (effectiveTargetLang || targetLang)
  const source = sourceLang === 'auto' ? '' : ` from ${LANG_NAMES[sourceLang] || sourceLang}`

  const body = JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content: `You are a professional translator. Translate the user's text${source} into ${target}. Output ONLY the translated text, no explanations.`
      },
      { role: 'user', content: text }
    ],
    max_tokens: 2048,
    temperature: 0.3
  })

  return _request(body, providerConfig, apiKey)
}

async function chatFollowup(messages, config) {
  const { provider, apiKey, providers } = config.api
  const providerConfig = providers[provider]
  if (!providerConfig) throw new Error(`Unknown provider: ${provider}`)

  const model = config.api.model || providerConfig.model
  const body = JSON.stringify({ model, messages, max_tokens: 2048, temperature: 0.7 })
  return _request(body, providerConfig, apiKey)
}

module.exports = { translateText, chatFollowup }
