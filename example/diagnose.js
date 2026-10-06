/**
 * Four-phase diagnostic session example.
 *
 * Phases: `parse` -> `transform` (`alpha`) -> `transform` (`beta`) ->
 * `stringify`.
 *
 * Run it locally with Node:
 *
 * ```sh
 * node example/diagnose.js
 * ```
 *
 * Or through npm:
 *
 * ```sh
 * npm run example-diagnose
 * ```
 *
 * @import {Plugin} from 'unified'
 * @import {Node} from 'unist'
 * @import {VFile} from 'vfile'
 */

import {unified} from '../index.js'

// `this` in JS is buggy in TS.
/**
 * @type {Plugin<[], string, Node>}
 */
function parsePhase() {
  this.parser =
    /**
     * @param {string} document
     *   Document to parse.
     * @param {VFile} file
     *   File to parse.
     * @returns {Node}
     *   Tree.
     */
    function (document, file) {
      file.message('parsed ' + JSON.stringify(document))
      return {type: 'root'}
    }
}

// `this` in JS is buggy in TS.
/**
 * @type {Plugin<[], Node, Node>}
 */
function alpha() {
  return function (tree, file) {
    file.message('alpha checked the tree')
  }
}

// `this` in JS is buggy in TS.
/**
 * @type {Plugin<[], Node, Node>}
 */
function beta() {
  return function (tree, file) {
    file.message('beta checked the tree')
  }
}

// `this` in JS is buggy in TS.
/**
 * @type {Plugin<[], Node, string>}
 */
function stringifyPhase() {
  this.compiler =
    /**
     * @param {Node} tree
     *   Tree to compile.
     * @param {VFile} file
     *   File to compile.
     * @returns {string}
     *   Text.
     */
    function (tree, file) {
      file.message('stringified the tree')
      return JSON.stringify(tree)
    }
}

const processor = unified()
  .use(parsePhase)
  .use(alpha)
  .use(beta)
  .use(stringifyPhase)

const report = await processor.diagnose('hello')

console.log('ok:', report.ok, '| complete:', report.complete)
console.log('\nphases:')
for (const phase of report.phases) {
  console.log(
    '  ' + phase.phase,
    '(' + (phase.plugin || 'anonymous') + '):',
    phase.status + ',',
    phase.messages.length,
    'message(s)'
  )
}

console.log('\nmessages:')
for (const entry of report.messages) {
  console.log(
    '  [' + (entry.phase || 'preexisting') + '/' + (entry.plugin || '-') + ']',
    entry.message.reason
  )
}
