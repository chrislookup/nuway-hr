import { useState } from 'react'

const FIELD_INPUTS = [
  ['text', 'Short text'], ['textarea', 'Long text'], ['date', 'Date'],
  ['number', 'Number'], ['select', 'Dropdown'], ['checkbox', 'Tick box'],
]
const rid = () => Math.random().toString(36).slice(2, 7)

function defaultBlock(type) {
  if (type === 'heading') return { type: 'heading', text: 'Heading' }
  if (type === 'clause') return { type: 'clause', text: '' }
  if (type === 'note') return { type: 'note', text: '' }
  if (type === 'field') return { type: 'field', name: 'f_' + rid(), label: 'New field', input: 'text', required: false }
  if (type === 'ack') return { type: 'ack', name: 'ack_' + rid(), text: 'I have read and understood this section.', initials: true }
  return null
}

// Keeps the raw text while typing (so spaces aren't stripped mid-word) and
// parses into an options array for storage.
function OptionsInput({ options, onChange }) {
  const [text, setText] = useState((options || []).join(', '))
  return (
    <input value={text} placeholder="Option 1, Option 2, Option 3"
      onChange={e => { setText(e.target.value); onChange(e.target.value.split(',').map(x => x.trim()).filter(Boolean)) }} />
  )
}

export default function FormBuilder({ pages, onChange }) {
  const [openS, setOpenS] = useState(0)

  const set = np => onChange(np)
  const patchSection = (si, patch) => set(pages.map((s, i) => i === si ? { ...s, ...patch } : s))
  const move = (arr, i, dir) => { const j = i + dir; if (j < 0 || j >= arr.length) return arr; const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c }

  function addSection() { set([...pages, { title: 'New section', blocks: [] }]); setOpenS(pages.length) }
  function removeSection(si) { if (!confirm('Remove this whole section?')) return; set(pages.filter((_, i) => i !== si)) }
  function moveSection(si, dir) { set(move(pages, si, dir)) }

  function addBlock(si, type) { const b = defaultBlock(type); patchSection(si, { blocks: [...pages[si].blocks, b] }) }
  function updateBlock(si, bi, patch) { patchSection(si, { blocks: pages[si].blocks.map((b, i) => i === bi ? { ...b, ...patch } : b) }) }
  function removeBlock(si, bi) { patchSection(si, { blocks: pages[si].blocks.filter((_, i) => i !== bi) }) }
  function moveBlock(si, bi, dir) { patchSection(si, { blocks: move(pages[si].blocks, bi, dir) }) }

  return (
    <div className="formbuilder">
      <div className="row between" style={{ marginBottom: 8 }}>
        <label style={{ margin: 0 }}>Form sections</label>
        <button type="button" className="small secondary" onClick={addSection}>+ Add section</button>
      </div>
      {pages.length === 0 && <p className="muted">No sections yet. Add a section, then add blocks (text, fields, acknowledgements) inside it.</p>}

      {pages.map((sec, si) => (
        <div key={si} className="fb-section">
          <div className="row between" style={{ alignItems: 'center' }}>
            <input value={sec.title || ''} onChange={e => patchSection(si, { title: e.target.value })} placeholder="Section title" style={{ fontWeight: 700, flex: 1 }} />
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="secondary small" onClick={() => moveSection(si, -1)} disabled={si === 0}>↑</button>
              <button type="button" className="secondary small" onClick={() => moveSection(si, 1)} disabled={si === pages.length - 1}>↓</button>
              <button type="button" className="secondary small" onClick={() => setOpenS(openS === si ? -1 : si)}>{openS === si ? 'Collapse' : 'Edit'}</button>
              <button type="button" className="danger small" onClick={() => removeSection(si)}>✕</button>
            </div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, marginTop: 6, fontSize: 13 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={!!sec.assessor} onChange={e => patchSection(si, { assessor: e.target.checked })} />
            Completed by a competent person / supervisor (locked to the employee, verified & signed by an assessor)
          </label>
          {sec.assessor && (
            <input value={sec.assessorNote || ''} onChange={e => patchSection(si, { assessorNote: e.target.value })}
              placeholder="What the competent person confirms (e.g. 'Observed safe forklift operation')" style={{ marginTop: 4 }} />
          )}

          {openS === si && (
            <div style={{ marginTop: 8 }}>
              {sec.blocks.map((b, bi) => (
                <div key={bi} className="fb-block">
                  <div className="row between">
                    <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: .3 }}>
                      {b.type === 'field' ? 'Field' : b.type === 'ack' ? 'Acknowledgement' : b.type === 'heading' ? 'Heading' : b.type === 'note' ? 'Note' : 'Text'}
                    </span>
                    <div className="row" style={{ gap: 4 }}>
                      <button type="button" className="secondary small" onClick={() => moveBlock(si, bi, -1)} disabled={bi === 0}>↑</button>
                      <button type="button" className="secondary small" onClick={() => moveBlock(si, bi, 1)} disabled={bi === sec.blocks.length - 1}>↓</button>
                      <button type="button" className="danger small" onClick={() => removeBlock(si, bi)}>✕</button>
                    </div>
                  </div>

                  {(b.type === 'heading') && (
                    <input value={b.text} onChange={e => updateBlock(si, bi, { text: e.target.value })} placeholder="Heading text" />
                  )}
                  {(b.type === 'clause' || b.type === 'note') && (
                    <textarea rows={b.type === 'clause' ? 3 : 2} value={b.text} onChange={e => updateBlock(si, bi, { text: e.target.value })} placeholder={b.type === 'clause' ? 'Paragraph of policy / contract text…' : 'Small helper note…'} />
                  )}
                  {b.type === 'field' && (
                    <div>
                      <div className="row">
                        <div style={{ flex: 2 }}><label>Question / label</label><input value={b.label} onChange={e => updateBlock(si, bi, { label: e.target.value })} /></div>
                        <div style={{ flex: 1 }}><label>Answer type</label>
                          <select value={b.input} onChange={e => updateBlock(si, bi, { input: e.target.value })}>
                            {FIELD_INPUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select></div>
                      </div>
                      {b.input === 'select' && (
                        <div><label>Dropdown options (comma-separated)</label>
                          <OptionsInput key={b.name} options={b.options} onChange={opts => updateBlock(si, bi, { options: opts })} /></div>
                      )}
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, marginTop: 6 }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={!!b.required} onChange={e => updateBlock(si, bi, { required: e.target.checked })} /> Required
                      </label>
                    </div>
                  )}
                  {b.type === 'ack' && (
                    <div>
                      <label>Acknowledgement wording</label>
                      <textarea rows={2} value={b.text} onChange={e => updateBlock(si, bi, { text: e.target.value })} />
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, marginTop: 6 }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={!!b.initials} onChange={e => updateBlock(si, bi, { initials: e.target.checked })} /> Ask for initials
                      </label>
                    </div>
                  )}
                </div>
              ))}
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <span className="muted" style={{ alignSelf: 'center' }}>Add:</span>
                <button type="button" className="small secondary" onClick={() => addBlock(si, 'heading')}>Heading</button>
                <button type="button" className="small secondary" onClick={() => addBlock(si, 'clause')}>Text</button>
                <button type="button" className="small secondary" onClick={() => addBlock(si, 'field')}>Field</button>
                <button type="button" className="small secondary" onClick={() => addBlock(si, 'ack')}>Acknowledgement</button>
                <button type="button" className="small secondary" onClick={() => addBlock(si, 'note')}>Note</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
