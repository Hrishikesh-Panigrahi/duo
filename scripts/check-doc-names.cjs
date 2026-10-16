// Checks that names in the docs' inline code spans still exist. A span is checked when it is:
// - a path (contains "/" or ends in a file extension, optionally followed by ":<line>"): it must exist with exactly
//   that case. A bare file name (no "/") may live in any SEARCH_DIRS folder. MIME types, URLs, /url-paths, globs,
//   "…" and <placeholders> are skipped;
// - `npm run <script>` anywhere in the span: the script must exist in package.json;
// - an identifier or call chain (`a.b`, `fn()`, `fn(x)`, `a().b.c()`): every name in it must appear as a word in the
//   code's text files (src/, supabase/, scripts/ and the root config files, comments included).
// It can't tell whether `a.b` is really a member of `a`, or whether the sentence is true: that's the fact-check.
// Usage: node scripts/check-doc-names.cjs [doc.md ...]   (default: CLAUDE.md, README.md, docs/, .claude/rules/, .claude/skills/)
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SELF = path.basename(__filename)
const CODE_DIRS = ['src', 'supabase', 'scripts']
const CODE_FILES = ['vite.config.ts', 'package.json', 'index.html', 'tsconfig.json', 'pwa-assets.config.ts', '.gitignore', '.npmrc', '.env.example']
const TEXT = /\.(tsx?|[cm]?js|py|sql|json|toml|css|html)$/
const DOC_DIRS = ['docs', '.claude/rules', '.claude/skills']
const SEARCH_DIRS = ['src', 'src/lib', 'src/lib/space', 'src/features', 'src/components', 'supabase/migrations', 'scripts', 'docs']
// Named to say the code doesn't or mustn't contain them, or not in a clean checkout (gitignored or outside the repo).
const ABSENT_ON_PURPOSE = new Set([
  'dangerouslySetInnerHTML', 'innerHTML', 'runtimeCaching', 'public.rls_auto_enable()', './seed.sql', 'supabase/seed.sql',
  'dist/', 'dist/_headers', '.git/', 'node_modules/', 'CLAUDE.local.md', '.claude/settings.local.json', '.playwright-mcp/', '.env.local',
])
const NOT_A_PATH = /^(@|\/|https?:|[a-z]+:\/\/|(application|image|video|text|audio)\/)|[<>*\s{}"'|…]/
const CHAIN = /^[A-Za-z_$][\w$]*(\([^()]*\))?(\.[A-Za-z_$][\w$]*(\([^()]*\))?)*$/

function walk(dir, keep, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, keep, out)
    else if (keep(name)) out.push(p)
  }
  return out
}

function codeWords() {
  const files = [...CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d), (n) => TEXT.test(n))), ...CODE_FILES.map((f) => path.join(ROOT, f))]
  const words = new Set()
  for (const f of files.filter((f) => fs.existsSync(f))) {
    const text = fs.readFileSync(f, 'utf8')
    // This file's comments describe made-up names, so they mustn't count as code.
    const code = path.basename(f) === SELF ? text.replace(/^\s*\/\/.*$/gm, '') : text
    for (const w of code.match(/[A-Za-z_$][\w$]*/g) ?? []) words.add(w)
    // Migrations are named by file: 20261018000000_direct_media.sql is `direct_media`.
    words.add(path.basename(f).replace(/\.\w+$/, '').replace(/^\d+_/, ''))
  }
  return words
}

/** True if `rel` exists under ROOT with exactly this case (existsSync ignores case on Windows and macOS). */
function existsExactly(rel) {
  let dir = ROOT
  for (const part of path.posix.normalize(rel).split('/').filter(Boolean)) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory() || !fs.readdirSync(dir).includes(part)) return false
    dir = path.join(dir, part)
  }
  return true
}

function pathProblem(span) {
  const rel = span.replace(/:\d+(-\d+)?$/, '')
  const found = rel.includes('/') ? existsExactly(rel) : existsExactly(rel) || SEARCH_DIRS.some((d) => existsExactly(`${d}/${rel}`))
  return found ? null : `no ${rel.endsWith('/') ? 'folder' : 'file'} ${rel} (case matters)`
}

/** Why a code span names something that doesn't exist, or null if it's fine or not a checkable shape. */
function problem(span, words, scripts) {
  if (ABSENT_ON_PURPOSE.has(span)) return null
  const npm = [...span.matchAll(/\bnpm run ([\w:-]+)/g)].map((m) => m[1]).find((s) => !Object.hasOwn(scripts, s))
  if (npm) return `no npm script "${npm}"`
  const files = span.split(' ').filter((t) => /\.(tsx?|[cm]?js|py|sql|md|json|toml|css|html|svg|png|ico|sh|txt)(:\d+)?$/.test(t) || t.includes('/'))
  for (const t of files.filter((t) => !NOT_A_PATH.test(t) && !ABSENT_ON_PURPOSE.has(t))) {
    const why = pathProblem(t)
    if (why) return why
  }
  if (!CHAIN.test(span)) return null
  const missing = span.replace(/\([^()]*\)/g, '').split('.').filter((name) => !words.has(name))
  return missing.length ? `"${missing.join('", "')}" doesn't appear in the code` : null
}

/** Inline code spans outside ``` fences, including ones that wrap onto the next line. */
function spansIn(text) {
  let fenced = false
  const unfenced = text.split('\n').map((line) => {
    if (line.trimStart().startsWith('```')) fenced = !fenced
    return fenced || line.trimStart().startsWith('```') ? '' : line
  }).join('\n')
  return [...unfenced.matchAll(/`((?:[^`\n]|\n(?![ \t]*\n))+)`/g)].map((m) => ({
    line: unfenced.slice(0, m.index).split('\n').length,
    span: m[1].replace(/\s+/g, ' ').trim(),
  }))
}

function main() {
  const args = process.argv.slice(2)
  const docs = args.length ? args.map((a) => path.resolve(a)) : [path.join(ROOT, 'CLAUDE.md'), path.join(ROOT, 'README.md'), ...DOC_DIRS.flatMap((d) => walk(path.join(ROOT, d), (n) => n.endsWith('.md')))]
  const words = codeWords()
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts
  let count = 0
  for (const doc of docs) {
    for (const { line, span } of spansIn(fs.readFileSync(doc, 'utf8'))) {
      const why = problem(span, words, scripts)
      if (why) console.log(`${path.relative(ROOT, doc)}:${line}  \`${span}\`  ${why}`) || count++
    }
  }
  console.log(count ? `\n${count} name(s) to fix.` : `All names in ${docs.length} file(s) exist.`)
  process.exit(count ? 1 : 0)
}

main()
