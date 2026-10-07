/**
 * @import {MessageSeverityMap} from 'unified'
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {unified} from 'unified'
import {VFile} from 'vfile'
import {simpleCompiler, simpleParser} from './util/simple.js'

const cause = new Error('boom')

/**
 * Create a short pipeline (parse, transform, compile) whose transform emits
 * two messages, each with a reason, a place, and (for the second) a cause.
 *
 * @param {MessageSeverityMap | undefined} [map]
 *   Optional severity mapping strategy (optional).
 * @returns {import('unified').Processor}
 *   Configured processor.
 */
function createPipeline(map) {
  const processor = unified()

  processor.parser = simpleParser
  processor.compiler = simpleCompiler
  processor.messageSeverityMap = map

  processor.use(function () {
    return function (tree, file) {
      file.message('alpha', {
        place: {line: 1, column: 2},
        ruleId: 'one',
        source: 'test'
      })
      file.message('bravo', {
        cause,
        place: {line: 3, column: 4},
        ruleId: 'two',
        source: 'test'
      })
    }
  })

  return processor
}

test('`messageSeverityMap`', async function (t) {
  await t.test(
    'should not change messages w/o a strategy (regression)',
    async function () {
      const file = await createPipeline().process(
        new VFile({path: 'alpha.txt', value: ''})
      )

      assert.equal(String(file.value), '')
      assert.deepEqual(
        file.messages.map(function (message) {
          return [message.reason, message.fatal]
        }),
        [
          ['alpha', false],
          ['bravo', false]
        ]
      )
    }
  )

  await t.test(
    'should map severities when processing completes',
    async function () {
      const file = await createPipeline(function (message, mappedFile) {
        assert.ok(mappedFile instanceof VFile)
        return message.ruleId === 'one'
      }).process(new VFile({path: 'alpha.txt', value: ''}))

      // Two messages, in order, still on the same file.
      assert.equal(file.messages.length, 2)
      assert.deepEqual(
        file.messages.map(function (message) {
          return message.reason
        }),
        ['alpha', 'bravo']
      )
      assert.ok(
        file.messages.every(function (message) {
          return message.file === 'alpha.txt'
        })
      )

      // Severities are mapped.
      assert.equal(file.messages[0].fatal, true)
      assert.equal(file.messages[1].fatal, false)

      // Reasons, places, and causes are kept.
      assert.equal(file.messages[0].reason, 'alpha')
      assert.equal(file.messages[0].line, 1)
      assert.equal(file.messages[0].column, 2)
      assert.equal(file.messages[1].reason, 'bravo')
      assert.equal(file.messages[1].line, 3)
      assert.equal(file.messages[1].column, 4)
      assert.equal(file.messages[1].cause, cause)
    }
  )

  await t.test(
    'should keep the severity when `undefined` is returned',
    async function () {
      const file = await createPipeline(function () {
        return undefined
      }).process('')

      assert.deepEqual(
        file.messages.map(function (message) {
          return message.fatal
        }),
        [false, false]
      )
    }
  )

  await t.test('should support `processSync`', async function () {
    const file = createPipeline(function () {
      return null
    }).processSync('')

    assert.deepEqual(
      file.messages.map(function (message) {
        return message.fatal
      }),
      [null, null]
    )
  })

  await t.test(
    'should be independent on clones and never lose messages',
    async function () {
      const processor = createPipeline(function () {
        return true
      })
      const clone = processor()

      // `parser` and `compiler` are own properties: set them on the clone.
      clone.parser = simpleParser
      clone.compiler = simpleCompiler
      // Change the strategy on the clone only, to one that always fails.
      clone.messageSeverityMap = function () {
        throw new Error('cannot map')
      }

      // Mapping failures do not lose messages: both are kept, with their
      // original severities, order, and places.
      const file = await clone.process('')
      assert.deepEqual(
        file.messages.map(function (message) {
          return [message.reason, message.fatal, message.line]
        }),
        [
          ['alpha', false, 1],
          ['bravo', false, 3]
        ]
      )

      // The original processor keeps its own strategy.
      const other = await processor.process('')
      assert.deepEqual(
        other.messages.map(function (message) {
          return message.fatal
        }),
        [true, true]
      )
    }
  )
})
