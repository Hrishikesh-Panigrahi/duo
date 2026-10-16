// Measures the code against the style rules in CLAUDE.md.
// Usage: node scripts/audit-style.cjs [projectDir] [--all]
const fs = require('fs')
const path = require('path')
const root = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.')
// Comes with the build tooling, so it's already in node_modules.
const { parse } = require(path.join(root, 'node_modules/@babel/parser'))
const MAX = 29

const files = []
;(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts')) files.push(p)
  }
})(path.join(root, 'src'))
files.push(path.join(root, 'vite.config.ts'))

const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'])
const long = []
const tiny = []
const comments = []

function nameOf(node, parent, grand) {
  if (node.id?.name) return node.id.name
  if (node.key) return node.key.name ?? node.key.value
  if (parent?.type === 'VariableDeclarator') return parent.id.name
  if (parent?.type === 'ObjectProperty') return parent.key.name ?? parent.key.value
  if (parent?.type === 'ClassProperty') return parent.key.name
  if (parent?.type === 'CallExpression') {
    const callee = parent.callee.name ?? parent.callee.property?.name
    if (['describe', 'it', 'test', 'beforeAll', 'beforeEach', 'afterEach', 'afterAll'].includes(callee)) return `${callee}(${parent.arguments[0]?.value ?? ''})`.slice(0, 60)
    return `<callback to ${callee ?? '?'}>`
  }
  if (parent?.type === 'JSXExpressionContainer') return '<inline JSX handler>'
  return null
}

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const test = /\.test\.ts$/.test(file)
  let ast
  try {
    ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  } catch (e) {
    console.log('PARSE ERROR', rel, e.message)
    continue
  }
  const lines = src.split('\n')
  comments.push({ rel, count: (ast.comments ?? []).reduce((n, c) => n + (c.loc.end.line - c.loc.start.line + 1), 0), total: lines.length })
  ;(function visit(node, parent, grand) {
    if (!node || typeof node.type !== 'string') return
    if (FN.has(node.type)) {
      const span = node.loc.end.line - node.loc.start.line + 1
      const name = nameOf(node, parent, grand)
      const isDescribe = name?.startsWith('describe(')
      if (span > MAX && !isDescribe) long.push({ rel, line: node.loc.start.line, span, name: name ?? '<anonymous>' })
      // Named helpers whose whole body is one or two lines.
      const named = name && !name.startsWith('<') && !test
      const bodyLines = node.body.type === 'BlockStatement' ? node.body.loc.end.line - node.body.loc.start.line - 1 : 1
      if (named && bodyLines <= 2 && parent?.type !== 'JSXExpressionContainer') tiny.push({ rel, line: node.loc.start.line, name, bodyLines })
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue
      const v = node[k]
      if (Array.isArray(v)) v.forEach((c) => visit(c, node, parent))
      else if (v && typeof v.type === 'string') visit(v, node, parent)
    }
  })(ast.program, null, null)
}

// Repeated blocks: 4+ consecutive non-trivial lines appearing more than three times.
const seen = new Map()
for (const file of files.filter((f) => !/\.test\.ts$/.test(f))) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim())
  for (let i = 0; i + 4 <= lines.length; i++) {
    const block = lines.slice(i, i + 4)
    if (block.some((l) => l.length < 4 || /^(\}|\)|\]|\/\/|\*|import |export \{)/.test(l))) continue
    const key = block.join('\n')
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key).push(`${rel}:${i + 1}`)
  }
}
const repeats = [...seen.entries()].filter(([, at]) => at.length > 3)

console.log(`FUNCTIONS OVER ${MAX} LINES: ${long.length}`)
long.sort((a, b) => b.span - a.span).forEach((f) => console.log(`  ${String(f.span).padStart(4)}  ${f.rel}:${f.line}  ${f.name}`))
console.log(`\nNAMED 1–2 LINE HELPERS: ${tiny.length}`)
tiny.forEach((f) => console.log(`  ${f.rel}:${f.line}  ${f.name}`))
console.log(`\nREPEATED 4-LINE BLOCKS (>3 times): ${repeats.length}`)
repeats.forEach(([k, at]) => console.log(`  x${at.length} ${at.join(', ')}\n    ${k.split('\n')[0].slice(0, 90)}`))
const totalComments = comments.reduce((n, c) => n + c.count, 0)
const totalLines = comments.reduce((n, c) => n + c.total, 0)
console.log(`\nCOMMENT LINES: ${totalComments} of ${totalLines} (${Math.round((100 * totalComments) / totalLines)}%)`)
if (process.argv.includes('--all')) comments.sort((a, b) => b.count - a.count).slice(0, 12).forEach((c) => console.log(`  ${String(c.count).padStart(4)}  ${c.rel}`))
