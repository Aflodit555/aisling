const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const defaultVault = 'D:\\Archive\\Aisling Archive'
const currentMarker = 'aisling_mirror: "v2"'
const hash = id => createHash('sha256').update(id).digest('hex')
const json = value => JSON.stringify(value)
const block = value => {
  const fence = '`'.repeat(Math.max(3, ...((value.match(/`+/g) || []).map(s => s.length + 1))))
  return `${fence}\n${value}\n${fence}`
}

async function ordinary(file, directory = false) {
  const stat = await fs.lstat(file)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1))
    throw new Error('Mirror refuses links or unexpected file types')
}

async function validateVault(vault) {
  if (typeof vault !== 'string' || !vault.trim() || !path.isAbsolute(vault) || /[\x00-\x1f]/.test(vault)) throw new Error('Invalid Obsidian vault.')
  await ordinary(vault, true)
  if ((await fs.realpath(vault)).toLowerCase() !== path.resolve(vault).toLowerCase()) throw new Error('Invalid Obsidian vault.')
  return path.resolve(vault)
}

function noteTitle(content) {
  return Array.from(content.trim().replace(/^(?:用户|使用者|User)\s*(?:报告|问询|询问|陈述|表示|reports?|asks?)\s*[:：]?\s*/i, '')
    .replace(/[<>:"/\\|?*\[\]#^\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 16).join('').replace(/[ .。；;，,！!？?]+$/, '') || 'Note'
}

function createObsidianMirror(vault = defaultVault) {
  const root = path.join(vault, 'Aisling Memory')
  async function sync({ notes, relations }) {
    await validateVault(vault)
    await fs.mkdir(root, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error })
    await ordinary(root, true)
    const managed = new Map()
    const occupied = new Set((await fs.readdir(root)).map(name => name.toLowerCase()))
    for (const name of await fs.readdir(root)) {
      if (!/(?:--[a-f0-9]{64}|-[a-f0-9]{10,12})\.md$/.test(name)) continue
      const file = path.join(root, name)
      await ordinary(file)
      const text = await fs.readFile(file, 'utf8')
      const match = text.match(/^---\naisling_mirror: "(v1|v2)"\nnote_id: ("[^\n]*")\n/)
      if (!match) continue
      const id = JSON.parse(match[2])
      if (typeof id !== 'string' || (match[1] === 'v1' && !name.endsWith(`--${hash(id)}.md`))) throw new Error('Invalid managed mirror identity')
      const entry = { name, text, current: match[1] === 'v2' }
      if (!managed.has(id)) managed.set(id, [])
      managed.get(id).push(entry)
    }
    const paths = new Map()
    const identifiers = new Set([...managed.values()].flat().filter(entry => entry.current).map(entry => entry.name.match(/-([a-f0-9]{10,12})\.md$/)[1]))
    for (const note of [...notes].sort((a, b) => a.id.localeCompare(b.id))) {
      const prior = managed.get(note.id)?.filter(entry => entry.current).sort((a, b) => a.name.localeCompare(b.name))[0]
      let name = prior?.name
      for (let attempt = 0; !name; attempt++) {
        const suffix = attempt === 0 ? hash(note.id).slice(0, 10) : hash(`${note.id}:${attempt}`).slice(0, 12)
        const candidate = `${noteTitle(note.content)}-${suffix}.md`
        if (!occupied.has(candidate.toLowerCase()) && !identifiers.has(suffix)) { name = candidate; identifiers.add(suffix) }
      }
      occupied.add(name.toLowerCase())
      paths.set(note.id, name)
    }
    let written = 0
    let removed = 0
    const outgoing = new Map()
    for (const relation of relations) {
      if (!outgoing.has(relation.source)) outgoing.set(relation.source, [])
      outgoing.get(relation.source).push(relation)
    }
    for (const note of notes) {
      const { id, content, ...metadata } = note
      const properties = [currentMarker, `note_id: ${json(id)}`, ...['createdAt', 'updatedAt', 'version', 'status', 'kind', 'basis']
        .filter(key => metadata[key] !== undefined).map(key => `${key}: ${json(metadata[key])}`)]
      const links = new Map()
      for (const relation of outgoing.get(id) || []) {
        if (!paths.has(relation.target)) continue
        const target = relation.status === 'active'
          ? `[[Aisling Memory/${paths.get(relation.target).slice(0, -3)}]]` : relation.target
        links.set(relation.key, `- ${relation.type} → ${target} (${relation.status})\n\n${block(json(relation))}`)
      }
      // Keep stored text literal so embedded WikiLinks cannot invent database edges.
      const text = `---\n${properties.join('\n')}\n---\n\n## 记忆内容\n\n${block(content)}\n\n## 元数据与来源\n\n${block(json(metadata))}\n\n## 关联记忆（出向）\n\n${[...links].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value).join('\n\n')}\n`
      const name = paths.get(id)
      const file = path.join(root, name)
      const prior = managed.get(id)?.find(entry => entry.name === name)
      if (!prior) {
        try { await fs.lstat(file); throw new Error('Mirror filename occupied by an unmanaged file') }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      } else await ordinary(file)
      if (prior?.text === text) continue
      const temporary = path.join(root, `.aisling-${randomUUID()}.tmp`)
      try {
        await fs.writeFile(temporary, text, { flag: 'wx' })
        await fs.rename(temporary, file)
        written++
      } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    }
    // Remove legacy copies only after every new file and link has been written; retries recover partial migrations.
    for (const [id, entries] of managed) for (const { name } of entries) if (paths.get(id) !== name) {
      await ordinary(path.join(root, name))
      await fs.unlink(path.join(root, name))
      removed++
    }
    return { notes: notes.length, written, removed }
  }
  return { sync }
}

// The queue is shared with database requests: polling must never enter a write transaction.
function startObsidianMirror(read, enqueue, vault, report = error => { if (error) console.error('[obsidian-mirror]', error.message) }, interval = 5000) {
  const mirror = createObsidianMirror(vault)
  let stopped = false
  let timer
  let active
  const tick = async () => {
    try {
      const snapshot = await enqueue(() => stopped ? null : read())
      if (!stopped && snapshot) { await mirror.sync(snapshot); report(null) }
    } catch (error) { report(error) }
    finally { if (!stopped) timer = setTimeout(() => { active = tick() }, interval) }
  }
  active = tick()
  return async () => { stopped = true; clearTimeout(timer); await active }
}

module.exports = { createObsidianMirror, startObsidianMirror, validateVault, defaultVault, noteTitle }
