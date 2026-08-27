import { writeFile } from 'node:fs/promises'
import { renderRehearsalMarkdown, runRehearsal } from './rehearsal.js'

const report = await runRehearsal()
const markdown = renderRehearsalMarkdown(report)
console.log(markdown)
const output = process.env.REHEARSAL_OUTPUT ?? 'judge-rehearsal.md'
await writeFile(output, markdown, 'utf8')
console.log(`\nSaved rehearsal artifact to ${output}`)
if (report.verified.run.status !== 'verified' || report.blocked.run.status !== 'failed') process.exitCode = 1