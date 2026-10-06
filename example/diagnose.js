/**
 * Four-phase diagnostic session example.
 *
 * One processor runs four phases: parse, two transforms, and stringify.
 * Each phase emits one message, and `processor.diagnose` attributes every
 * message to the phase and plugin that emitted it, instead of leaving them
 * all on the file unattributed or blaming the final plugin.
 *
 * Run it locally with:
 *
 * ```sh
 * node example/diagnose.js
 * # or:
 * npm run example:diagnose
 * ```
 *
 * @import {Plugin} from 'unified'
 * @import {Literal} from 'mdast'
 * @import {Node} from 'unist'
 */

import process from 'node:process'
import {unified} from 'unified'
import {VFile} from 'vfile'

/**
 * @type {Plugin<[], string, Node>}
 */
function parsePhase() {
  this.parser = parser

  /**
   * @param {string} document
   * @param {VFile} file
   * @returns {Node}
   */
  function parser(document, file) {
    file.message('parsed ' + document.length + ' characters')
    return /** @type {Literal} */ ({type: 'text', value: document})
  }
}

/**
 * @type {Plugin<[], Node, Node>}
 */
function transformWordCount() {
  return transformer

  /**
   * @param {Node} tree
   * @param {VFile} file
   */
  function transformer(tree, file) {
    file.message('seen ' + String(tree).length + ' characters of tree')
  }
}

/**
 * @type {Plugin<[], Node, Node>}
 */
function transformFileName() {
  return transformer

  /**
   * @param {Node} tree
   * @param {VFile} file
   */
  function transformer(tree, file) {
    file.message('transformed ' + file.basename)
  }
}

/**
 * @type {Plugin<[], Node, string>}
 */
function stringifyPhase() {
  this.compiler = compiler

  /**
   * @param {Node} tree
   * @param {VFile} file
   * @returns {string}
   */
  function compiler(tree, file) {
    file.message('serialized document')
    return 'value' in tree ? String(tree.value) : ''
  }
}

const processor = unified()
  .use(parsePhase)
  .use(transformWordCount)
  .use(transformFileName)
  .use(stringifyPhase)

const file = new VFile({path: 'example.txt', value: 'alpha bravo charlie'})

// One explicit diagnostic session: the pipeline runs exactly once,
// and the report describes that single run.
const report = await processor.diagnose(file)

console.log('ok:', report.ok)

console.log('phases:')
for (const phase of report.phases) {
  console.log(
    '  ' +
      phase.phase +
      ' (' +
      (phase.plugin || 'unknown') +
      '): ' +
      (phase.ok ? 'ok' : 'failed: ' + String(phase.error))
  )
}

console.log('messages:')
for (const diagnostic of report.messages) {
  console.log(
    '  [' +
      diagnostic.phase +
      ' / ' +
      (diagnostic.plugin || 'unknown') +
      '] ' +
      diagnostic.message.reason
  )
}

console.log('output:', String(report.file))

if (!report.ok) {
  process.exitCode = 1
}
