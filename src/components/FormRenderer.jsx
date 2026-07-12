export default function FormRenderer({ schema, values, onChange }) {
  const fields = schema?.fields || []
  if (!fields.length) return null
  function set(name, v) { onChange({ ...values, [name]: v }) }
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
