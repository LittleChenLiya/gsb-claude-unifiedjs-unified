/**
 * @import {MessageSeverityMapper, Plugin} from 'unified'
 * @import {Node} from 'unist'
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {unified} from 'unified'
import {VFile} from 'vfile'
import {simpleCompiler, simpleParser} from './util/simple.js'

// A shared short pipeline: parse, add two messages, stringify.
// The first message is a warning (`fatal: false`) with a cause, the second
// is info (`fatal: undefined`); both carry a position.
// The parser and compiler are configured through a plugin so that they are
// carried over to cloned processors.
function base() {
  const processor = unified()

  processor.use(setup)

  processor.use(function () {
    return function (tree, file) {
      file.message('alpha warning', {
        cause: new Error('alpha cause'),
        place: {line: 1, column: 2}
      })
      file.info('bravo info', {line: 3, column: 4})
    }
  })

  return processor
}

// `this` in JS is buggy in TS.
/**
 * Configure the parser and compiler.
 *
 * @type {Plugin<[], string, Node>}
 */
function setup() {
  this.parser = simpleParser
  this.compiler = simpleCompiler
}

/**
 * Summarize messages as `[reason, fatal, line, column]` tuples.
 *
 * @param {import('vfile').VFile} file
 *   File to summarize.
 * @returns {Array<[string, boolean | null | undefined, number | undefined, number | undefined]>}
 *   Tuples of reason, severity, and position.
 */
function summarize(file) {
  return file.messages.map(function (message) {
    return [message.reason, message.fatal, message.line, message.column]
  })
}

test('`severityMapper`', async function (t) {
  await t.test(
    'should keep messages as-is without a strategy (regression: original interface)',
    async function () {
      const file = await base().process('alpha')

      assert.deepEqual(summarize(file), [
        ['alpha warning', false, 1, 2],
        ['bravo info', undefined, 3, 4]
      ])
      assert.equal(String(file), 'alpha')
    }
  )

  await t.test(
    'should map severity at completion, keeping reason, position, cause, and order',
    async function () {
      const processor = base()

      /** @type {MessageSeverityMapper} */
      processor.severityMapper = function (message) {
        // Escalate warnings to fatal, downgrade the rest to info.
        return message.fatal === false ? true : null
      }

      const file = await processor.process('alpha')

      // Mapping applied, order and positions kept.
      assert.deepEqual(summarize(file), [
        ['alpha warning', true, 1, 2],
        ['bravo info', null, 3, 4]
      ])
      // Reason and cause untouched.
      const cause = file.messages[0].cause
      assert.equal(file.messages[0].reason, 'alpha warning')
      assert.ok(cause instanceof Error)
      assert.equal(cause.message, 'alpha cause')
      assert.deepEqual(file.messages[0].place, {line: 1, column: 2})
      // File association and result untouched.
      assert.equal(file.messages[0].file, '')
      assert.equal(String(file), 'alpha')
    }
  )

  await t.test(
    'should not map severity during the run phase (completion only)',
    async function () {
      const processor = base()

      processor.severityMapper = function () {
        return true
      }

      const tree = processor.parse('alpha')
      const file = new VFile('alpha')

      await processor.run(tree, file)

      assert.deepEqual(summarize(file), [
        ['alpha warning', false, 1, 2],
        ['bravo info', undefined, 3, 4]
      ])
    }
  )

  await t.test(
    'should keep messages when the strategy throws',
    async function () {
      const processor = base()

      processor.severityMapper = function (message) {
        if (message.reason === 'alpha warning') {
          throw new Error('cannot map')
        }

        return true
      }

      const file = await processor.process('alpha')

      // The failed message is kept as-is, the other is still mapped, and
      // no message is lost or reordered.
      assert.deepEqual(summarize(file), [
        ['alpha warning', false, 1, 2],
        ['bravo info', true, 3, 4]
      ])
    }
  )

  await t.test('should be independent on cloned processors', async function () {
    const ancestor = base()

    ancestor.severityMapper = function () {
      return true
    }

    const descendant = ancestor()

    descendant.severityMapper = function () {
      return null
    }

    const ancestorFile = await ancestor.process('alpha')
    const descendantFile = await descendant.process('alpha')

    assert.deepEqual(summarize(ancestorFile), [
      ['alpha warning', true, 1, 2],
      ['bravo info', true, 3, 4]
    ])
    assert.deepEqual(summarize(descendantFile), [
      ['alpha warning', null, 1, 2],
      ['bravo info', null, 3, 4]
    ])
  })

  await t.test('should also apply in `processSync`', async function () {
    const processor = base()

    processor.severityMapper = function () {
      return false
    }

    const file = processor.processSync('alpha')

    assert.deepEqual(summarize(file), [
      ['alpha warning', false, 1, 2],
      ['bravo info', false, 3, 4]
    ])
  })
})
