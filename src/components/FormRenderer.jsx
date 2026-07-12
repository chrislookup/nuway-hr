// Renders either a "guided" schema (pages of clauses + fields + acknowledgements)
// or the legacy simple { fields:[...] } schema. Editable — writes into `values`.
export default function FormRenderer({ schema, values, onChange, assessorMode = false }) {
  function set(name, v) { onChange({ ...values, [name]: v }) }

  // ---- guided schema (pages/blocks) ----
  if (schema?.pages) {
    return (
      <div className="guided">
        {schema.pages.map((pg, pi) => {
          const locked = pg.assessor && !assessorMode
          return (
          <section key={pi} className="card" style={{ marginTop: pi ? 14 : 0, borderLeft: pg.assessor ? '4px solid var(--green)' : undefined }}>
            {pg.title && <h2>{pg.title}</h2>}
            {pg.assessor && (
              <div className={locked ? 'note-assessor' : 'success'} style={{ marginBottom: 8 }}>
                {locked ? 'A competent person / supervisor will complete and sign this section with you.' : 'Competent-person section — complete and sign to confirm.'}
                {pg.assessorNote ? ` (${pg.assessorNote})` : ''}
              </div>
            )}
            {(pg.blocks || []).map((b, bi) => {
              if (locked && (b.type === 'field' || b.type === 'ack')) {
                return <p key={bi} className="muted" style={{ fontSize: 13 }}>• {b.label || b.text} — to be completed by a competent person</p>
              }
              if (b.type === 'heading') return <h3 key={bi} style={{ marginTop: 14 }}>{b.text}</h3>
              if (b.type === 'clause') return <p key={bi} className="clause">{b.text}</p>
              if (b.type === 'note') return <p key={bi} className="muted" style={{ fontSize: 13 }}>{b.text}</p>
              if (b.type === 'field') {
                const v = values[b.name] ?? b.default ?? ''
                if (b.input === 'checkbox') {
                  return (
                    <label key={bi} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400, marginTop: 10 }}>
                      <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={!!values[b.name]} onChange={e => set(b.name, e.target.checked)} />
                      <span>{b.label}{b.required && ' *'}</span>
                    </label>
                  )
                }
                return (
                  <div key={bi} style={{ marginTop: 8 }}>
                    <label>{b.label}{b.required && ' *'}</label>
                    {b.input === 'textarea'
                      ? <textarea rows={3} value={v} onChange={e => set(b.name, e.target.value)} />
                      : b.input === 'select'
                        ? <select value={v} onChange={e => set(b.name, e.target.value)}>
                            <option value="">— select —</option>
                            {(b.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        : <input type={b.input === 'date' ? 'date' : b.input === 'number' ? 'number' : 'text'}
                            value={v} onChange={e => set(b.name, e.target.value)} placeholder={b.placeholder || ''} />}
                    {b.hint && <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{b.hint}</p>}
                  </div>
                )
              }
              if (b.type === 'ack') {
                return (
                  <div key={bi} className="ackbox">
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}>
                      <input type="checkbox" style={{ width: 'auto', marginTop: 3 }}
                        checked={!!values[b.name]} onChange={e => set(b.name, e.target.checked)} />
                      <span>{b.text}</span>
                    </label>
                    {b.initials && (
                      <div className="row" style={{ marginTop: 6, alignItems: 'center' }}>
                        <label style={{ margin: 0 }}>Initials</label>
                        <input style={{ width: 90 }} maxLength={5} value={values[b.name + '_initials'] || ''}
                          onChange={e => set(b.name + '_initials', e.target.value.toUpperCase())} placeholder="e.g. CH" />
                      </div>
                    )}
                  </div>
                )
              }
              return null
            })}
          </section>
          )
        })}
      </div>
    )
  }

  // ---- legacy simple schema ----
  const fields = schema?.fields || []
  if (!fields.length) return null
  return (
    <div>
      {fields.map(f => (
        <div key={f.name}>
          <label>{f.label || f.name}{f.required && ' *'}</label>
          {f.type === 'textarea' ? (
            <textarea rows={3} value={values[f.name] || ''} onChange={e => set(f.name, e.target.value)} />
          ) : f.type === 'select' ? (
            <select value={values[f.name] || ''} onChange={e => set(f.name, e.target.value)}>
              <option value="">— select —</option>
              {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'checkbox' ? (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={!!values[f.name]}
                onChange={e => set(f.name, e.target.checked)} /> {f.text || 'Yes'}
            </label>
          ) : (
            <input type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
              value={values[f.name] || ''} onChange={e => set(f.name, e.target.value)} />
          )}
        </div>
      ))}
    </div>
  )
}

// Validation helper shared with CompleteDoc
export function validateGuided(schema, values, assessorMode = false) {
  if (!schema?.pages) return null
  for (const pg of schema.pages) {
    if (pg.assessor && !assessorMode) continue
    for (const b of (pg.blocks || [])) {
      if (b.type === 'field' && b.required && b.input === 'checkbox' && !values[b.name])
        return `Please tick: ${b.label}`
      if (b.type === 'field' && b.required && b.input !== 'checkbox' && !String(values[b.name] ?? b.default ?? '').trim())
        return `Please complete: ${b.label}`
      if (b.type === 'ack') {
        if (!values[b.name]) return `Please tick: “${b.text.slice(0, 60)}${b.text.length > 60 ? '…' : ''}”`
        if (b.initials && !String(values[b.name + '_initials'] || '').trim()) return 'Please add your initials to each acknowledgement.'
      }
    }
  }
  return null
}
