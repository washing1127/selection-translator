class LRUCache {
  constructor(maxSize = 500) {
    this.maxSize = maxSize
    this.map = new Map()
  }
  get(key) {
    if (!this.map.has(key)) return null
    const value = this.map.get(key)
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= this.maxSize) this.map.delete(this.map.keys().next().value)
    this.map.set(key, value)
  }
  get size() { return this.map.size }
  clear() { this.map.clear() }
}

module.exports = { LRUCache }
