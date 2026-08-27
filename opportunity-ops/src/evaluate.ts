import { renderEvaluationMarkdown, runEvaluation } from './evaluation.js'
import { writeFile } from 'node:fs/promises'

const report = await runEvaluation()
const markdown = renderEvaluationMarkdown(report)
console.log(JSON.stringify(report, null, 2))
console.log('\n' + markdown)
const output = process.env.EVALUATION_OUTPUT
if (output) await writeFile(output, markdown, 'utf8')
if (report.passed !== report.total) process.exitCode = 1