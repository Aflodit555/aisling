export function safeText(text) {
  return !!text.trim() && text.length <= 3000 && !/^\s*\[image\]\s*$/i.test(text)
    && !/password|api.?key|access.?token|secret|验证码|密码|口令|密钥|令牌|身份证|银行卡|\bsk-[\w-]{8,}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\d{7,}|[A-Za-z0-9_+/=-]{32,}/i.test(text)
}

export function terms(text) {
  const result = []
  for (const run of text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? []) {
    if (/^[a-z0-9]/.test(run)) { result.push(run); continue }
    const chars = [...run]
    for (let i = 0; i < chars.length; i++) {
      result.push(chars[i])
      if (i + 1 < chars.length) result.push(chars[i] + chars[i + 1])
    }
  }
  return result
}

/** Bounded BM25 over authoritative heads; a missed term is never proof of novelty. */
export function rankNoteHeads(query, heads) {
  const words = [...new Set(terms(query))]
  const docs = heads.map(head => { const tokens = terms([head.note.content, head.note.subject, ...(head.note.tags ?? [])].join(' '))
    const tf = new Map(); for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    return { head, tf, length: tokens.length } })
  const average = docs.reduce((n,d) => n+d.length,0)/(docs.length || 1)
  const df = new Map(words.map(t => [t, docs.filter(d => d.tf.has(t)).length]))
  return docs.map(d => ({ ...d, score: words.reduce((n,t) => {
    const tf = d.tf.get(t) ?? 0
    return n + (tf ? Math.log(1+(docs.length-df.get(t)+.5)/(df.get(t)+.5))*tf*2.2/(tf+1.2*(.25+.75*d.length/(average || 1))) : 0)
  },0) })).filter(d=>d.score>0).sort((a,b)=>b.score-a.score || a.head.note.id.localeCompare(b.head.note.id)).slice(0,5).map(d=>d.head)
}
