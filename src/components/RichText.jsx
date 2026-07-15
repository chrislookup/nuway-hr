import { useEffect, useRef } from 'react'

// Lightweight rich-text editor: bold / italic / underline / lists / hyperlink.
// Dependency-free (contentEditable + execCommand). Emits HTML via onChange.
export default function RichText({ value, onChange, placeholder }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || ''
  }, []) // set once; keep uncontrolled after mount to avoid caret jumps

  function emit() {
    const el = ref.current
    if (!el) return
    el.querySelectorAll('a').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer') })
    onChange(el.innerHTML)
  }
  function cmd(command, arg) { document.execCommand(command, false, arg); ref.current?.focus(); emit() }
  function addLink() {
    const url = window.prompt('Link URL (include https://)')
    if (!url) return
    const href = /^https?:\/\//i.test(url) ? url : 'https://' + url
    cmd('createLink', href)
  }

  const Btn = ({ onClick, title, children }) => (
    <button type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick}
      style={{ padding: '2px 8px', minWidth: 30, border: '1px solid #cdd3cd', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>{children}</button>
  )

  return (
    <div style={{ border: '1px solid #cdd3cd', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 4, padding: 6, background: '#f4f6f4', borderBottom: '1px solid #e0e6e0', flexWrap: 'wrap' }}>
        <Btn title="Bold" onClick={() => cmd('bold')}><b>B</b></Btn>
        <Btn title="Italic" onClick={() => cmd('italic')}><i>I</i></Btn>
        <Btn title="Underline" onClick={() => cmd('underline')}><u>U</u></Btn>
        <Btn title="Heading" onClick={() => cmd('formatBlock', 'H4')}>H</Btn>
        <Btn title="Bulleted list" onClick={() => cmd('insertUnorderedList')}>• List</Btn>
        <Btn title="Numbered list" onClick={() => cmd('insertOrderedList')}>1. List</Btn>
        <Btn title="Add link" onClick={addLink}>🔗 Link</Btn>
        <Btn title="Remove formatting" onClick={() => cmd('removeFormat')}>✕</Btn>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning onInput={emit} data-ph={placeholder || ''}
        style={{ minHeight: 90, padding: '8px 10px', fontSize: 14, outline: 'none', lineHeight: 1.5 }} />
    </div>
  )
}
