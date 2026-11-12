// Invoked by note-formation-electron.test.cjs with a marked synthetic profile.
const { app, dialog, WebContentsView } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { startDesktop } = require('./desktop-app.cjs')
const { noteFormationFixture } = require('./note-formation-test-host.cjs')

const [phase, profile, resources] = process.argv.slice(2)
assert(['default', 'write', 'reopen', 'erase', 'dev', 'autonomous', 'semantic', 'associative'].includes(phase))
let fixtureClock = Date.now()
if (['semantic','associative'].includes(phase)) Date.now = () => fixtureClock
assert.equal(fs.readFileSync(path.join(profile, '.note-formation-test'), 'utf8'), 'aisling-note-formation-p1-fixture\n')
const dev = phase === 'dev'
const initialProfile = dev ? path.join(profile, 'unused-built-profile') : profile
if (dev) fs.mkdirSync(initialProfile)
app.setPath('userData', initialProfile)
app.setPath('sessionData', initialProfile)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')
const jobs = () => JSON.parse(fs.readFileSync(path.join(profile, 'note-formation-jobs.v1.json'), 'utf8')).batches
const timeout = setTimeout(() => app.exit(2), 75_000)

async function until(predicate, description) {
  for (let i = 0; i < 800; i++) {
    try { if (predicate()) return } catch (error) { if (error.code !== 'ENOENT') throw error }
    await delay(15)
  }
  throw new Error(description + ': ' + JSON.stringify(jobs().map(b => ({ status: b.status, units: b.units, error: b.error,
    items: b.items?.map(i => [i.status, i.reason]) }))))
}

;(async () => {
  let service
  const embeddingCalls = []
  const fixture = dev ? {} : phase === 'default' ? undefined : noteFormationFixture(app, resources)
  let confirmation = 1, dialogs = 0
  if (fixture) dialog.showMessageBox = async () => { dialogs++; return { response: confirmation } }
  if (dev) {
    await assert.rejects(startDesktop({ stageUrl: 'http://localhost:5175', noteOnlyForNewProfiles: true }), /untrusted-stage-origin/)
    await assert.rejects(startDesktop({ stageUrl: 'https://example.invalid', noteOnlyForNewProfiles: true }), /untrusted-stage-origin/)
  }
  // Client-route transitions need animation frames, which hidden windows may suspend.
  const win = await startDesktop({ show: phase === 'write' || phase === 'associative', diagnostics: false, stageUrl: dev ? undefined : 'aisling://stage/',
    noteOnlyForNewProfiles: phase !== 'default', noteV2: fixture && { ...fixture, onService: value => { service = value },
      ...(phase === 'associative' && { embeddingConfig: () => ({modelId:'mock/embedding',model:'mock',apiKey:'synthetic',endpoint:'https://mock.invalid'}),
        embeddingRequest: async (_config,texts,type) => { embeddingCalls.push(type); return texts.map(()=>[1,...Array(1023).fill(0)]) } }) } })
  const web = win.contentView.children[0].webContents
  if (dev) web.on('console-message', details => {
    if (details.level === 'error') console.error(details.message)
  })
  if (phase === 'default') {
    assert.equal(await web.executeJavaScript('Boolean(window.aislingDesktop?.noteFormation)'), false)
    assert(!fs.existsSync(path.join(profile, 'memory-authority')))
    assert(!fs.existsSync(path.join(profile, 'memory-note-v2')))
    console.log(JSON.stringify({ phase, result: 'note-formation-passed', pid: process.pid }))
    clearTimeout(timeout)
    app.quit()
    return
  }
  if (['autonomous','semantic','associative'].includes(phase)) {
    await web.executeJavaScript('window.semanticMemoryFixture = ' + JSON.stringify(phase !== 'autonomous') + '; window.associativeMemoryFixture = ' + JSON.stringify(phase === 'associative'))
    dialog.showMessageBox = async () => { assert.fail('Normal autonomous memory must not require approval') }
    await web.executeJavaScript('(' + (async function () {
      let stage, settings
      for (let i = 0; i < 600; i++) {
        const pinia = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia
        stage = pinia?._s.get('stage'); settings = pinia?._s.get('settings')
        if (stage && settings?.loaded) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      await settings.setMemoryEnabled(true)
      await settings.setMemoryFormationEnabled(true)
      await settings.setNoteRecallEnabled(true)
      let calls = 0, semanticCalls = 0, lastChat
      const semantic = window.semanticMemoryFixture === true
      const associative = window.associativeMemoryFixture === true
      settings.activeChatProvider = { id: 'offline-autonomous', complete: async request => {
        if (request.messages[0]?.content?.startsWith('Note-only Organization.')) {
          semanticCalls++
          const input = JSON.parse(request.messages[1].content)
          const stageOf = text => associative ? text.includes('Live2D') ? 2 : text.includes('Agent') ? 1 : 0
            : text.includes('恢复') || text.includes('重新') ? 2 : text.includes('暂停') ? 1 : 0
          const sorted = [...input.notes].sort((a, b) => stageOf(a.content) - stageOf(b.content))
          const relations = sorted.slice(0, -1).map((from, i) => ({ from: from.label, to: sorted[i + 1].label,
            type: associative ? 'ASSOCIATED_WITH' : 'STATE_CHANGE', scope: associative ? '自主性设计' : '钢琴练习',
            reason: associative ? 'Memory Organization 的认识决策、Agent 行动选择与 Live2D 意图表达在研究自主性时互相提供设计线索，不是事实证明' : '两个独立原始报告描述练习状态的变化',
            sources: [...from.sources, ...sorted[i + 1].sources].map(label => ({ label,
              quote: input.evidence.find(entry => entry.label === label).content })) }))
          return { text: JSON.stringify({ relations: relations.slice(0, 2) }) }
        }
        if (!request.messages[0]?.content?.startsWith('Note-only Formation.')) { lastChat = request.messages; return { text: '收到。' } }
        calls++
        const input = JSON.parse(request.messages[1].content)
        const evidence = input.evidence.find(e => e.role === 'user' && e.scope === 'current')
        const content = evidence.content
        const value = content.includes('重新') ? '重新开始' : content.includes('暂停') ? '暂停' : '开始'
        const summary = content.includes('重新') ? '用户恢复钢琴练习。' : content.includes('暂停') ? '用户暂停钢琴练习。' : '用户开始钢琴练习。'
        return { text: JSON.stringify({ items: [{ action: 'ADD', target: null, reason: '原文状态报告',
          draft: { content: associative ? content : semantic ? summary : content, kind: 'event', basis: 'direct', subject: 'S1', eventTime: null,
            tags: associative ? [content.includes('Memory') ? 'Memory' : content.includes('Agent') ? 'Agent' : 'Live2D'] : ['钢琴'],
            ...(!semantic && { state: { scope: '练习钢琴', value } }), sources: [{ label: evidence.label, quote: content }] },
          ...(semantic && { semantic: { relation: 'independent', target: null, scope: associative ? '自主性设计' : '钢琴练习',
            sources: [{ label: evidence.label, quote: content }], targetSources: [] } }) }] }) }
      } }
      window.autonomousMemoryFixture = {
        async send(content) {
          for (let i = 0; i < 3; i++) {
            stage.send(content)
            for (let attempt = 0; stage.sending && attempt < 600; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
            if (stage.sending) throw new Error('Chat did not finish')
          }
        }, calls: () => calls, semanticCalls: () => semanticCalls,
        wake() { stage.newConversation() },
        async query() {
          stage.send(associative ? 'Memory Organization 和以前的自主性研究有什么联系？' : '我现在还在练钢琴吗？')
          for (let i = 0; stage.sending && i < 600; i++) await new Promise(resolve => setTimeout(resolve, 10))
          return lastChat
        },
      }
    }).toString() + ')()')
    const experiences = phase === 'associative' ? ['我研究 Memory Organization 的认识决策。','我研究 Agent 的自主行动选择。','我用 Live2D 表达角色自主意图。']
      : ['我现在开始练习钢琴。', '我现在暂停练习钢琴。', '我现在重新开始练习钢琴。']
    for (const [i, content] of experiences.entries()) {
      await web.executeJavaScript('window.autonomousMemoryFixture.send(' + JSON.stringify(content) + ')')
      await until(() => jobs().filter(batch => batch.items?.some(item => item.status === 'applied')).length >= i + 1, 'No autonomous commit')
    }
    for (let i = 0; i < 6; i++) await service.organize()
    if (phase === 'associative') await service.syncEmbeddings()
    if (['semantic','associative'].includes(phase)) {
      fixtureClock += 60_001
      await web.executeJavaScript('window.autonomousMemoryFixture.wake()')
      await until(() => {
        const organization = JSON.parse(fs.readFileSync(path.join(profile, 'note-formation-jobs.v1.json'), 'utf8')).organization
        return organization.semanticCalls.length >= 2 && !organization.tasks.some(task => ['running', 'settling'].includes(task.semantic?.status))
      }, 'Background semantic organization did not finish')
    }
    assert.equal((await service.reviews()).pending, 0)
    const snapshot = await service.recallSnapshot()
    assert.equal(snapshot.reason, 'ready')
    assert.equal(snapshot.notes.length, 3)
    const graph = await web.executeJavaScript('window.aislingDesktop.noteRecall.neighbors(' + JSON.stringify(snapshot.notes.map(head => head.note.id)) + ',' + JSON.stringify(snapshot.version) + ')')
    assert(graph.relations.length >= 2)
    if (['semantic','associative'].includes(phase)) {
      assert(graph.relations.every(relation => relation.method === 'semantic'))
      const request = await web.executeJavaScript('window.autonomousMemoryFixture.query()')
      assert(request.some(message => message.content?.includes(phase === 'associative' ? 'ASSOCIATED_WITH' : 'latest-known-report')), JSON.stringify(request))
      if (phase === 'associative') { assert(embeddingCalls.includes('document')); assert(embeddingCalls.includes('query')) }
      assert.equal(await web.executeJavaScript('window.autonomousMemoryFixture.semanticCalls()'), 2)
    }
    assert.equal(await web.executeJavaScript('window.autonomousMemoryFixture.calls()'), 3)
    assert.equal(dialogs, 0)
    if (phase === 'associative') await web.executeJavaScript('(' + (async function () {
      const vm=document.querySelector('#app').__vue_app__.config.globalProperties
      await vm.$router.push({name:'settings-memory'})
      for(let i=0;i<400&&!document.querySelector('#embedding-title');i++) await new Promise(r=>setTimeout(r,10))
      const form=document.querySelector('#embedding-title')?.parentElement.querySelector('form')
      if(!form)throw new Error('Embedding form absent')
      const model=form.querySelector('input');model.value='qwen3.7-text-embedding';model.dispatchEvent(new Event('input',{bubbles:true}))
      const endpoint=form.querySelector('input[type="url"]');endpoint.value='https://dashscope.aliyuncs.com';endpoint.dispatchEvent(new Event('input',{bubbles:true}))
      await Promise.resolve();form.querySelector('button[type="submit"]').click()
      for(let i=0;i<400;i++){const config=JSON.parse(window.aislingDesktop.storage.getItem('aisling.config.v1'))
        if(config.memory.embedding?.credentialSource==='reuse'&&config.memory.embedding.model==='qwen3.7-text-embedding')return
        await new Promise(r=>setTimeout(r,10))}
      throw new Error('Embedding UI save did not persist')
    }).toString() + ')()')
    console.log(JSON.stringify({ phase, result: 'note-formation-passed', pid: process.pid, notes: 3, relations: graph.relations.length }))
    clearTimeout(timeout)
    app.quit()
    return
  }
  const invoke = (name, ...args) => web.executeJavaScript('window.noteFormationFixture.' + name + '(...' + JSON.stringify(args) + ')')
  await web.executeJavaScript('(' + (async function () {
    const wait = async (condition, reason) => {
      for (let i = 0; i < 600; i++) {
        if (condition()) return
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error(reason)
    }
    let stage, settings
    await wait(() => {
      const pinia = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia
      stage = pinia?._s.get('stage')
      settings = pinia?._s.get('settings')
      return stage && settings?.loaded
    }, 'Stage was not ready')
    await settings.setMemoryEnabled(true)
    await settings.setMemoryFormationEnabled(true)
    await settings.setNoteRecallEnabled(true)
    let mode = 'old', calls = 0, release, lastChat
    const draft = (e, content, kind = 'fact', subject = 'S1') => ({
      content, kind, basis: 'direct', subject, eventTime: null, tags: ['手碟'], sources: [{ label: e.label, quote: e.content }],
    })
    const item = (draft, action = 'ADD', target = null) => ({ draft, action, target, reason: '合成验收' })
    const before = '用户报告去年未买手碟，现在已买，尚未开始练习。'
    const corrected = '用户报告手碟已购买并开始练习。'
    settings.activeChatProvider = { id: 'offline-formation', complete: async request => {
      const system = request.messages[0]?.content ?? ''
      if (system.startsWith('You form append-only') || system.startsWith('Form atomic candidates')) throw new Error('legacy formation called')
      if (!system.startsWith('Note-only Formation.')) {
        lastChat = request.messages
        return { text: '收到。' }
      }
      calls++
      const input = JSON.parse(request.messages[1].content)
      const users = input.evidence.filter(e => e.role === 'user' && e.scope === 'current')
      const head = text => {
        const found = input.candidates.find(n => n.content === text)
        if (!found) throw new Error('missing verified candidate')
        return found.label
      }
      let items = []
      if (mode === 'bad') return { text: 'invalid JSON' }
      if (mode === 'dev') items = [item(draft(users[0], '用户报告已经开始练手碟。'))]
      if (mode === 'drafts') {
        const historical = input.evidence.find(e => e.role === 'user' && e.scope === 'history' && e.content.includes('原本'))
        if (!historical) throw new Error('missing historical original')
        const pattern = { ...draft(users[0], '用户在两次手碟练习计划中均提到尚未开始。', 'pattern'),
          basis: 'inferred', uncertainty: '仅覆盖两次报告。' }
        pattern.sources.push({ label: historical.label, quote: historical.content })
        const unknown = input.subjects.find(s => !s.confirmed && s.mentionIn === users[2].label)
        items = [item(pattern), item(draft(users[1], before)), item(draft(users[2], '用户报告偏好蓝色。', 'preference', unknown.label))]
      }
      if (mode === 'update') items = [
        item(draft(users[0], corrected), 'UPDATE', head(before)),
        item(draft(users[0], before), 'NOOP', head(before)),
      ]
      if (mode === 'noop') items = [item(draft(users[0], corrected), 'NOOP', head(corrected))]
      if (mode === 'super') items = [item(draft(users[0], '用户报告现在改为每周练习手碟一次。', 'project-state'), 'SUPERSEDE', head(corrected))]
      if (mode === 'stale' || mode === 'cancel') {
        const reply = item(draft(users[0], '用户报告了待失效的手碟经历。'))
        await new Promise(resolve => { release = resolve })
        items = [reply]
      }
      return { text: JSON.stringify({ items }) }
    } }
    window.noteFormationFixture = {
      mode(value) { mode = value },
      calls() { return calls },
      async send(texts, onlyLastMayStart = false) {
        const baseline = calls
        for (const [i, text] of texts.entries()) {
          stage.send(text)
          await wait(() => !stage.sending, 'reply not delivered')
          if (onlyLastMayStart && i < texts.length - 1 && calls !== baseline) throw new Error('early Formation')
        }
      },
      fresh() { stage.newConversation() },
      deleteSession(id) { stage.deleteSession(id) },
      async removeSource() {
        await wait(() => release, 'no deferred Formation')
        stage.deleteSession(stage.activeSessionId)
      },
      finish() { release(); release = undefined },
      submit(id, attempt, quote) {
        const draft = { content: '用户报告了待失效的手碟经历。', kind: 'fact', basis: 'direct', subject: 'S1',
          eventTime: null, tags: ['手碟'], sources: [{ label: 'E1', quote }] }
        return window.aislingDesktop.noteFormation.submit(id, attempt, JSON.stringify({ items: [item(draft)] }))
      },
      async enable() {
        await settings.setMemoryEnabled(true)
        await settings.setMemoryFormationEnabled(true)
        await settings.setNoteRecallEnabled(true)
      },
      review() { return window.aislingDesktop.noteReview.list() },
      decide(key, approve) { return window.aislingDesktop.noteReview.decide(key, approve) },
      snapshot() { return window.aislingDesktop.noteRecall.snapshot() },
      toggleRecall(enabled) { return settings.setNoteRecallEnabled(enabled) },
      async recallTurn() {
        await settings.setMemoryFormationEnabled(false)
        stage.newConversation()
        await this.send(['手碟练习的共同模式是什么？'])
        return lastChat
      },
      derived() {
        const saved = JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1'))
        return saved.sessions.find(session => session.id === stage.activeSessionId).messages.at(-1)?.noteDerived === true
      },
      async openMemory() {
        const vm = document.querySelector('#app').__vue_app__.config.globalProperties
        await vm.$router.push({ name: 'settings-memory' })
        await wait(() => document.querySelector('#review-title'), 'Memory page did not mount')
      },
      current(version) { return window.aislingDesktop.noteRecall.current(version) },
      async cancel() {
        await wait(() => release, 'no deferred Formation')
        await settings.setMemoryEnabled(false)
        release()
        release = undefined
      },
    }
  }).toString() + ')()')

  if (dev) {
    assert.equal(app.getPath('userData'), profile)
    assert.equal(app.getPath('sessionData'), profile)
    assert(!fs.existsSync(path.join(initialProfile, 'memory-authority')))
    assert.equal(await web.executeJavaScript('!!window.aislingDesktop.noteFormation && !window.aislingDesktop.reflectionStorage && typeof require === "undefined"'), true)
    await invoke('mode', 'dev')
    await invoke('send', ['手碟练习已开始。', '我已经练了一次手碟。', '已安排练习。'], true)
    await until(() => jobs()[0]?.items?.[0]?.status === 'review', 'Vite proposal')
    const [{ key, approvable }] = (await invoke('review')).items
    assert(approvable)
    assert.deepEqual((await invoke('snapshot')).notes, [])
    assert.equal(await invoke('decide', key, true), 'applied')
    assert.equal(dialogs, 1)
    assert.equal(await web.executeJavaScript("Boolean(document.querySelector('#review-title'))"), true)
    await web.executeJavaScript(`(async () => {
      const { createHotContext } = await import('/@vite/client')
      const hot = createHotContext('/__aisling_test_hmr')
      const updated = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Vite update did not arrive')), 6000)
        hot.on('vite:afterUpdate', () => { clearTimeout(timeout); resolve() })
      })
      if (!(await fetch('/__aisling_test_hmr', { method: 'POST' })).ok) throw new Error('Could not trigger Vite update')
      await updated
    })()`)
    assert.equal(await invoke('decide', key, true), 'applied')
    assert.equal(dialogs, 1)
    assert.equal(await invoke('calls'), 1)
    assert.equal(jobs().length, 1)
    assert.equal((await invoke('snapshot')).notes.length, 1)
    const recalled = await invoke('recallTurn')
    assert(recalled.some(message => message.content?.startsWith('[Note recall evidence]') && message.content.includes('已经开始练手碟')))
    const original = jobs()[0]
    await invoke('deleteSession', original.sessionId)
    await service.recover()
    assert.deepEqual((await invoke('snapshot')).notes, [])
    await invoke('enable')
    await invoke('fresh')
    await invoke('mode', 'cancel')
    await invoke('send', ['重载期间暂停手碟练习。', '手碟第二条。', '手碟第三条。'])
    await until(() => jobs().some(batch => batch.status === 'running' && batch.prepared), 'formation before reload')
    const interrupted = jobs().find(batch => batch.status === 'running')
    const loaded = once(web, 'did-finish-load')
    web.reload()
    await loaded
    await until(() => jobs().some(batch => batch.id === interrupted.id && batch.status === 'failed' && batch.error === 'cancelled'),
      'reload did not cancel the old document attempt')
    const staleCall = 'window.aislingDesktop.noteFormation.submit(' + JSON.stringify(interrupted.id) + ', ' + interrupted.attempts + ', "{}")'
    await assert.rejects(web.executeJavaScript(staleCall), /stale-formation-attempt/)
    const other = new WebContentsView({ webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
      additionalArguments: ['--aisling-note-v2'],
    } })
    const verifyDenied = async contents => {
      assert.equal(await contents.executeJavaScript("window.aislingDesktop.storage.setItem('aisling.config.v1', '{}')"), false)
      assert.equal(await contents.executeJavaScript("window.aislingDesktop.storage.getItem('aisling.config.v1')"), null)
      await assert.rejects(contents.executeJavaScript('window.aislingDesktop.noteReview.list()'), /Untrusted Note review/)
    }
    try {
      await other.webContents.loadURL('http://localhost:5174/')
      await verifyDenied(other.webContents)
    } finally { other.webContents.close() }
    await web.loadURL('data:text/html,untrusted-origin')
    await verifyDenied(web)
  } else if (phase === 'write') {
    const run = async (mode, messages, index, done = b => b.status === 'completed') => {
      await invoke('mode', mode)
      await invoke('send', messages, true)
      await until(() => ['completed', 'failed'].includes(jobs()[index]?.status), mode)
      if (jobs()[index].items?.some(item => item.status === 'review')) {
        const { items } = await invoke('review')
        for (const item of items.filter(row => row.approvable)) {
          if (mode === 'drafts' && dialogs === 0) {
            const savedBefore = (await invoke('snapshot')).notes.length
            confirmation = 0
            assert.equal(await invoke('decide', item.key, true), 'cancelled')
            assert.equal((await invoke('snapshot')).notes.length, savedBefore)
            confirmation = 1
          }
          await invoke('decide', item.key, true)
        }
      }
      await until(() => done(jobs()[index]), mode)
      return jobs()[index]
    }
    const old = await run('old', ['原本计划手碟练习但没开始。', '先整理手碟教材。', '暂时搁置这个计划。'], 0)
    assert.equal(old.units, 3)
    assert.equal(old.attempts, 1)
    assert.deepEqual(old.items, [])
    await invoke('fresh')
    const created = await run('drafts', ['另一次原本计划手碟练习但仍没开始。', '去年考虑购买手碟但没有买，现在已买，尚未开始练习。', '我最喜欢的颜色是蓝色。'], 1)
    assert.deepEqual(created.items.map(item => item.status), ['applied', 'applied', 'review'])
    assert(created.items[2].wire.draft.sources[0].quote)
    assert.equal(created.items[0].wire, undefined)
    const priorDialogs = dialogs
    assert.equal(await invoke('decide', created.items[0].operationId, true), 'applied')
    assert.equal(dialogs, priorDialogs)
    assert.equal((await invoke('snapshot')).notes.length, 2)
    web.setZoomFactor(1.2)
    await invoke('openMemory')
    await web.executeJavaScript(`new Promise((resolve, reject) => {
      let tries = 0
      const timer = setInterval(() => {
        if (document.querySelector('#review-title')?.textContent.includes('(1)')
          && document.body.innerText.includes('Original evidence')
          && !document.body.innerText.includes('Reflection Formation')) { clearInterval(timer); resolve(true) }
        else if (++tries > 150) { clearInterval(timer); reject(new Error('review UI did not reflect Main state')) }
      }, 25)
    })`)
    web.setZoomFactor(1)
    await web.executeJavaScript("document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/')")
    const unconfirmed = (await invoke('review')).items.find(item => !item.approvable)
    assert(unconfirmed?.quotes.length)
    assert.equal(await invoke('decide', unconfirmed.key, true), 'stale')
    assert.equal(await invoke('decide', unconfirmed.key, false), 'rejected')
    assert.equal(await invoke('decide', unconfirmed.key, false), 'rejected')
    const updated = await run('update', ['更正手碟采购：已购买，并且已经开始练习。', '保留以前的手碟经历。', '这是状态更正。'], 2)
    assert.deepEqual(updated.items.map(item => item.status), ['applied', 'rejected'])
    assert.equal(updated.items[1].reason, 'stale-version')
    const noop = await run('noop', ['补充确认手碟已经购买并开始练习。', '手碟已经到家。', '再次确认原报告。'], 3)
    assert.equal(noop.items[0].status, 'applied')
    await invoke('fresh')
    await invoke('mode', 'stale')
    await invoke('send', ['手碟待删除经历一。', '待删除经历二。', '待删除经历三。'])
    await until(() => jobs()[4]?.prepared, 'deferred source snapshot')
    const stale = jobs()[4]
    await assert.rejects(invoke('submit', stale.id, stale.attempts, '不存在的引文'), /draft-quote/)
    await invoke('removeSource')
    await assert.rejects(invoke('submit', stale.id, stale.attempts, '手碟待删除经历一。'), /source-changed|erasure-pending|stale-formation-attempt/)
    await invoke('finish')
    await until(() => jobs().every(batch => batch.id !== stale.id), 'deleted job retained')
    await run('bad', ['无效输出一。', '无效输出二。', '无效输出三。'], 4, b => b.status === 'failed')
    assert.equal(jobs()[4].error, 'invalid-json')
    await invoke('mode', 'cancel')
    await invoke('send', ['手碟取消测试一。', '取消测试二。', '取消测试三。'])
    await invoke('cancel')
    await until(() => jobs()[5]?.status === 'failed', 'cancelled output was accepted')
    assert.equal(jobs()[5].error, 'cancelled')
    await invoke('enable')
    const unknown = await run('super', ['手碟练习决定改为每周一次，旧计划作废。', '手碟训练安排已改变。', '这是已作出的决定。'], 6,
      b => b.items?.[0]?.status === 'outcome-unknown')
    assert.equal(unknown.status, 'settling')
    assert.equal(await invoke('calls'), 8)
  } else if (phase === 'reopen') {
    await until(() => jobs()[6]?.status === 'completed', 'Receipt recovery')
    assert.equal(jobs()[6].items[0].status, 'applied')
    assert.equal(jobs()[6].items[0].reason, 'receipt-confirmed')
    assert.equal(await invoke('calls'), 0)
  } else {
    assert.equal((await service.listRecallHeads()).notes.length, 2)
    const snapshot = await invoke('snapshot')
    assert.equal(await invoke('current', snapshot.version), true)
    const request = await invoke('recallTurn')
    const evidence = request.find(message => message.content?.startsWith('[Note recall evidence]'))
    assert.equal(evidence?.role, 'user')
    assert.match(evidence.content, /仅覆盖两次报告/)
    assert(!request.some(message => message.content?.startsWith('[Historical Aisling reflections]')))
    assert.equal(await invoke('derived'), true)
    await invoke('toggleRecall', false)
    assert.equal((await invoke('snapshot')).reason, 'disabled')
    assert.equal((await service.listRecallHeads()).notes.length, 2)
    await invoke('toggleRecall', true)
    const beforeErase = await invoke('snapshot')
    assert.equal(await invoke('current', beforeErase.version), true)
    const old = jobs()[0]
    await invoke('deleteSession', old.sessionId)
    assert.equal(await invoke('current', beforeErase.version), false)
    await service.recover()
    assert.equal(service.privacy.pending(), false)
    assert.deepEqual((await service.listRecallHeads()).notes, [])
    assert(jobs().every(batch => batch.id !== old.id))
    assert.equal(await invoke('calls'), 0)
  }
  assert(!fs.existsSync(path.join(profile, 'aisling-reflections.v1.json')))
  assert(!fs.existsSync(path.join(profile, 'memory-organization', 'note-v1.lbdb')))
  assert(fs.existsSync(path.join(profile, 'memory-note-v2', 'note-v2.lbdb')))
  console.log(JSON.stringify({ phase, result: 'note-formation-passed', pid: process.pid }))
  clearTimeout(timeout)
  app.quit()
})().catch(error => {
  console.error(error)
  clearTimeout(timeout)
  app.exit(1)
})
