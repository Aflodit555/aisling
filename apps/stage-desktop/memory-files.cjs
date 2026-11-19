const fs = require('node:fs')
const { exists } = require('./memory-authority.cjs')

function durable(file, text) {
  const temp = file + '.tmp'
  if (exists(temp)) fs.unlinkSync(temp)
  fs.writeFileSync(temp, text, { flag: 'wx', flush: true })
  fs.renameSync(temp, file)
}

module.exports = { durable }
