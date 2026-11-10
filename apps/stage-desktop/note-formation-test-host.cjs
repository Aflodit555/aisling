const fs = require('node:fs')
const path = require('node:path')

function noteFormationFixture(app, resources) {
  const profile = app.getPath('userData')
  const root = path.resolve(__dirname, '../../artifacts/memory-note-only-p1')
  if (app.isPackaged || fs.realpathSync(profile) !== profile || path.dirname(profile) !== fs.realpathSync(root)
    || fs.readFileSync(path.join(profile, '.note-formation-test'), 'utf8') !== 'aisling-note-formation-p1-fixture\n')
    throw new Error('isolated-formation-profile-required')
  return { resources }
}

module.exports = { noteFormationFixture }
