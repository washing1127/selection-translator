const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, '../config.json')

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const config = JSON.parse(raw)
    if (!config.api) throw new Error('config.json: missing "api" section')
    if (!config.api.apiKey || config.api.apiKey === 'YOUR_API_KEY_HERE') {
      throw new Error('config.json: please set your API key in "api.apiKey"')
    }
    return config
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`Config file not found: ${CONFIG_PATH}`)
    throw err
  }
}

module.exports = { readConfig }
