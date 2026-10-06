/**
 * @import {Plugin} from 'unified'
 * @import {Node} from 'unist'
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {unified} from 'unified'
import {VFile} from 'vfile'
import {simpleCompiler, simpleParser} from './util/simple.js'

test('`diagnose`', async function (t) {
  await t.test('should throw without `parser`', async function () {
    assert.throws(function () {
      unified().diagnose('')
    }, /Cannot `diagnose` without `parser`/)
  })

  await t.test('should throw without `compiler`', async function () {
    const processor = unified()
    processor.parser = simpleParser

    assert.throws(function () {
      processor.diagnose('')
    }, /Cannot `diagnose` without `compiler`/)
  })

  await t.test(
    'should attribute messages to phases and plugins (four phases, second transform fails)',
    async function () {
      let stringifyStarted = false
      let parseCalls = 0

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
            parseCalls++
            file.message('parse note')
            return {type: 'root'}
          }
      }

      // `this` in JS is buggy in TS.
      /**
       * @type {Plugin<[], Node, Node>}
       */
      function alpha() {
        return function (tree, file) {
          file.message('alpha note')
        }
      }

      // `this` in JS is buggy in TS.
      /**
       * @type {Plugin<[], Node, Node>}
       */
      function beta() {
        return function (tree, file) {
          file.message('beta note')
          throw new Error('beta failed')
        }
      }

      // `this` in JS is buggy in TS.
      /**
       * @type {Plugin<[], Node, string>}
       */
      function stringifyPhase() {
        this.compiler = function () {
          stringifyStarted = true
          return ''
        }
      }

      const processor = unified()
        .use(parsePhase)
        .use(alpha)
        .use(beta)
        .use(stringifyPhase)

      const file = new VFile('hello')
      file.message('preexisting note')

      const report = await processor.diagnose(file)

      // The pipeline ran exactly once: the report is not built by
      // re-executing.
      assert.equal(parseCalls, 1)

      // The failed phase returns completed diagnostics and an incomplete
      // state.
      assert.equal(report.complete, false)
      assert.equal(report.ok, false)
      assert.equal(report.failedPhase, 'transform')
      assert.equal(report.failedPlugin, 'beta')
      assert.equal(report.error && report.error.message, 'beta failed')
      assert.equal(report.file, file)

      // `stringify` never started.
      assert.equal(stringifyStarted, false)

      // Phase statuses and plugin identities are accurate.
      assert.deepEqual(
        report.phases.map(function (phase) {
          return [phase.phase, phase.plugin, phase.status]
        }),
        [
          ['parse', 'parsePhase', 'ok'],
          ['transform', 'alpha', 'ok'],
          ['transform', 'beta', 'failed'],
          ['stringify', 'stringifyPhase', 'skipped']
        ]
      )

      // Messages are attributed to the phase and plugin that created them,
      // not to the final plugin.
      assert.deepEqual(
        report.messages.map(function (entry) {
          return [entry.message.reason, entry.phase, entry.plugin]
        }),
        [
          ['preexisting note', undefined, undefined],
          ['parse note', 'parse', 'parsePhase'],
          ['alpha note', 'transform', 'alpha'],
          ['beta note', 'transform', 'beta']
        ]
      )

      // The preexisting message is preserved: still exactly one copy on the
      // file and in the report.
      assert.equal(file.messages.length, 4)
      assert.equal(
        file.messages.filter(function (message) {
          return message.reason === 'preexisting note'
        }).length,
        1
      )
      assert.equal(
        report.messages.filter(function (entry) {
          return entry.message.reason === 'preexisting note'
        }).length,
        1
      )
    }
  )

  await t.test(
    'should treat an empty success as success, not failure',
    async function () {
      const processor = unified()
      processor.parser = simpleParser
      processor.compiler = simpleCompiler

      const report = await processor.diagnose('hello')

      assert.equal(report.complete, true)
      assert.equal(report.ok, true)
      assert.equal(report.error, undefined)
      assert.equal(report.failedPhase, undefined)
      assert.equal(report.failedPlugin, undefined)
      assert.equal(report.messages.length, 0)
      assert.equal(report.file.value, 'hello')
      assert.deepEqual(
        report.phases.map(function (phase) {
          return phase.status
        }),
        ['ok', 'ok']
      )
      assert.ok(
        report.phases.every(function (phase) {
          return phase.messages.length === 0
        })
      )
    }
  )

  await t.test(
    'should attribute messages to `stringify` on success',
    async function () {
      // `this` in JS is buggy in TS.
      /**
       * @type {Plugin<[], string, Node>}
       */
      function parsePhase() {
        this.parser = function () {
          return {type: 'root'}
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
            file.message('stringify note')
            return 'output'
          }
      }

      const processor = unified().use(parsePhase).use(stringifyPhase)

      const report = await processor.diagnose('hello')

      assert.equal(report.ok, true)
      assert.equal(report.file.value, 'output')
      assert.deepEqual(
        report.messages.map(function (entry) {
          return [entry.message.reason, entry.phase, entry.plugin]
        }),
        [['stringify note', 'stringify', 'stringifyPhase']]
      )
    }
  )

  await t.test('should support a failing parse phase', async function () {
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
          file.message('before parse crash')
          throw new Error('parse failed')
        }
    }

    // `this` in JS is buggy in TS.
    /**
     * @type {Plugin<[], Node, Node>}
     */
    function alpha() {
      return function () {}
    }

    // `this` in JS is buggy in TS.
    /**
     * @type {Plugin<[], Node, string>}
     */
    function stringifyPhase() {
      this.compiler = function () {
        return ''
      }
    }

    const processor = unified().use(parsePhase).use(alpha).use(stringifyPhase)

    const report = await processor.diagnose('hello')

    assert.equal(report.complete, false)
    assert.equal(report.ok, false)
    assert.equal(report.failedPhase, 'parse')
    assert.equal(report.failedPlugin, 'parsePhase')
    assert.equal(report.error && report.error.message, 'parse failed')
    assert.deepEqual(
      report.phases.map(function (phase) {
        return phase.status
      }),
      ['failed', 'skipped', 'skipped']
    )
    assert.deepEqual(
      report.messages.map(function (entry) {
        return [entry.message.reason, entry.phase, entry.plugin]
      }),
      [['before parse crash', 'parse', 'parsePhase']]
    )
  })

  await t.test('should support a failing stringify phase', async function () {
    // `this` in JS is buggy in TS.
    /**
     * @type {Plugin<[], string, Node>}
     */
    function parsePhase() {
      this.parser = function () {
        return {type: 'root'}
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
          file.message('before stringify crash')
          throw new Error('stringify failed')
        }
    }

    const processor = unified().use(parsePhase).use(stringifyPhase)

    const report = await processor.diagnose('hello')

    assert.equal(report.complete, false)
    assert.equal(report.failedPhase, 'stringify')
    assert.equal(report.failedPlugin, 'stringifyPhase')
    assert.equal(report.error && report.error.message, 'stringify failed')
    assert.deepEqual(
      report.phases.map(function (phase) {
        return phase.status
      }),
      ['ok', 'failed']
    )
    assert.equal(report.messages.length, 1)
    assert.equal(report.messages[0].phase, 'stringify')
  })

  await t.test(
    'should not collect messages twice and not mix files across concurrent sessions',
    async function () {
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
            file.message('parsed ' + file.path)
            return {type: 'root'}
          }
      }

      // `this` in JS is buggy in TS.
      /**
       * @type {Plugin<[], Node, Node>}
       */
      function tagger() {
        return async function (tree, file) {
          // Interleave the two sessions.
          await new Promise(function (resolve) {
            setTimeout(resolve, file.path === 'a.md' ? 20 : 1)
          })
          file.message('tagged ' + file.path)
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
            file.message('compiled ' + file.path)
            return file.path
          }
      }

      const processor = unified()
        .use(parsePhase)
        .use(tagger)
        .use(stringifyPhase)

      const fileA = new VFile({path: 'a.md', value: 'a'})
      const fileB = new VFile({path: 'b.md', value: 'b'})
      fileA.message('preexisting a')

      const [reportA, reportB] = await Promise.all([
        processor.diagnose(fileA),
        processor.diagnose(fileB)
      ])

      // Both sessions succeeded on their own file.
      assert.equal(reportA.ok, true)
      assert.equal(reportB.ok, true)
      assert.equal(reportA.file, fileA)
      assert.equal(reportB.file, fileB)

      // No message is collected twice and no source is mixed.
      assert.deepEqual(
        reportA.messages.map(function (entry) {
          return entry.message.reason
        }),
        ['preexisting a', 'parsed a.md', 'tagged a.md', 'compiled a.md']
      )
      assert.deepEqual(
        reportB.messages.map(function (entry) {
          return entry.message.reason
        }),
        ['parsed b.md', 'tagged b.md', 'compiled b.md']
      )
      assert.equal(fileA.messages.length, 4)
      assert.equal(fileB.messages.length, 3)
      assert.equal(
        fileA.messages.filter(function (message) {
          return message.reason === 'preexisting a'
        }).length,
        1
      )
    }
  )

  await t.test(
    'should support callback-style async transforms',
    async function () {
      // `this` in JS is buggy in TS.
      /**
       * @type {Plugin<[], string, Node>}
       */
      function parsePhase() {
        this.parser = function () {
          return {type: 'root'}
        }
      }

      // `this` in JS is buggy in TS.
      /**
       * @type {Plugin<[], Node, Node>}
       */
      function callbackStyle() {
        return function (tree, file, next) {
          file.message('callback note')
          setTimeout(function () {
            next()
          }, 1)
        }
      }

      // `this` in JS is buggy in TS.
      /**
       * @type {Plugin<[], Node, string>}
       */
      function stringifyPhase() {
        this.compiler = function () {
          return 'done'
        }
      }

      const processor = unified()
        .use(parsePhase)
        .use(callbackStyle)
        .use(stringifyPhase)

      const report = await processor.diagnose('hello')

      assert.equal(report.ok, true)
      assert.equal(report.file.value, 'done')
      assert.deepEqual(
        report.messages.map(function (entry) {
          return [entry.message.reason, entry.phase, entry.plugin]
        }),
        [['callback note', 'transform', 'callbackStyle']]
      )
    }
  )

  await t.test(
    'should attribute messages to the function name when set directly',
    async function () {
      const processor = unified()

      processor.parser = simpleParser
      processor.compiler = simpleCompiler

      const report = await processor.diagnose('hello')

      assert.equal(report.ok, true)
      assert.equal(report.phases[0].plugin, 'simpleParser')
      assert.equal(report.phases[1].plugin, 'simpleCompiler')
    }
  )
})
