export default function QuestionBuilder({ test, onChange }) {
  const t = test || { pass_mark: 80, questions: [] }
  const set = patch => onChange({ ...t, ...patch })
  const qs = t.questions || []
  const setQ = (qi, patch) => set({ questions: qs.map((q, i) => i === qi ? { ...q, ...patch } : q) })

  function addQuestion() { set({ questions: [...qs, { q: '', options: ['', ''], answer: '', points: 1 }] }) }
  function removeQuestion(qi) { set({ questions: qs.filter((_, i) => i !== qi) }) }
  function addOption(qi) { const q = qs[qi]; setQ(qi, { options: [...(q.options || []), ''] }) }
  function updateOption(qi, oi, val) {
    const q = qs[qi]; const opts = (q.options || []).map((o, i) => i === oi ? val : o)
    const patch = { options: opts }
    if (q.answer === q.options[oi]) patch.answer = val // keep correct answer in sync if it was this option
    setQ(qi, patch)
  }
  function removeOption(qi, oi) { const q = qs[qi]; setQ(qi, { options: (q.options || []).filter((_, i) => i !== oi) }) }
  function setCorrect(qi, val) { setQ(qi, { answer: val }) }

  return (
    <div className="qbuilder">
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <label style={{ margin: 0 }}>Pass mark (%)</label>
        <input type="number" min="0" max="100" style={{ width: 90 }} value={t.pass_mark ?? 80} onChange={e => set({ pass_mark: e.target.value })} />
        <button type="button" className="small secondary" onClick={addQuestion}>+ Add question</button>
      </div>
      {qs.length === 0 && <p className="muted" style={{ marginTop: 6 }}>No questions. Add a few multiple-choice questions to check understanding — the employee must pass before the document counts as complete.</p>}

      {qs.map((q, qi) => (
        <div key={qi} className="fb-block" style={{ marginTop: 8 }}>
          <div className="row between">
            <b>Question {qi + 1}</b>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <label style={{ margin: 0, fontSize: 12 }} className="muted">Points</label>
              <input type="number" min="1" style={{ width: 60 }} value={q.points ?? 1} onChange={e => setQ(qi, { points: Number(e.target.value) || 1 })} />
              <button type="button" className="danger small" onClick={() => removeQuestion(qi)}>✕</button>
            </div>
          </div>
          <input value={q.q} onChange={e => setQ(qi, { q: e.target.value })} placeholder="Question text" />
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>Options (select the ● correct answer):</p>
          {(q.options || []).map((o, oi) => (
            <div key={oi} className="row" style={{ alignItems: 'center', gap: 8 }}>
              <input type="radio" name={`correct-${qi}`} style={{ width: 'auto' }} checked={q.answer === o && o !== ''} onChange={() => setCorrect(qi, o)} title="Mark as correct answer" />
              <input style={{ flex: 1 }} value={o} onChange={e => updateOption(qi, oi, e.target.value)} placeholder={`Option ${oi + 1}`} />
              <button type="button" className="secondary small" onClick={() => removeOption(qi, oi)} disabled={(q.options || []).length <= 2}>✕</button>
            </div>
          ))}
          <button type="button" className="small secondary" style={{ marginTop: 6 }} onClick={() => addOption(qi)}>+ Add option</button>
        </div>
      ))}
    </div>
  )
}
