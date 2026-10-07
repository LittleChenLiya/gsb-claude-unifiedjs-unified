/**
 * @import {Plugin} from 'unified'
 * @import {Node} from 'unist'
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {unified} from 'unified'
import {simpleCompiler, simpleParser} from './util/simple.js'

// `this` in JS is buggy in TS.
/**
 * @type {Plugin<[], string, Node>}
 */
function parse() {
  this.parser = simpleParser
}

// `this` in JS is buggy in TS.
/**
 * @type {Plugin<[], Node, string>}
 */
function compile() {
  this.compiler = simpleCompiler
}

test('`pluginIdentityCheck`', async function (t) {
  await t.test('should be off by default', function () {
    assert.equal(unified().pluginIdentityCheck(), false)
  })

  await t.test('should get and set the flag', function () {
    const processor = unified()

    assert.equal(processor.pluginIdentityCheck(true), processor)
    assert.equal(processor.pluginIdentityCheck(), true)
    assert.equal(processor.pluginIdentityCheck(false), processor)
    assert.equal(processor.pluginIdentityCheck(), false)
  })

  await t.test(
    'should throw when setting the flag on a frozen processor',
    function () {
      const processor = unified().freeze()

      assert.throws(function () {
        processor.pluginIdentityCheck(true)
      }, /Cannot call `pluginIdentityCheck` on a frozen processor/)
    }
  )

  await t.test('should copy the flag to descendant processors', function () {
    const processor = unified().pluginIdentityCheck(true)
    const descendant = processor()

    assert.equal(descendant.pluginIdentityCheck(), true)
  })

  await t.test(
    'should keep the original merge behavior when not enabled',
    function () {
      let calls = 0
      const processor = unified()
        .use(spy, {alpha: 1})
        .use(spy, {bravo: 2})
        .freeze()

      assert.equal(processor.attachers.length, 1)
      assert.equal(calls, 1)

      /**
       * @param {unknown} options
       */
      function spy(options) {
        assert.deepEqual(options, {alpha: 1, bravo: 2})
        calls++
      }
    }
  )

  await t.test(
    'should allow duplicate registration with identical options when enabled',
    function () {
      let calls = 0
      const processor = unified()
        .pluginIdentityCheck(true)
        .use(spy, {alpha: 1, bravo: [1, 2]})
        // Note: different key order, same canonical value.
        .use(spy, {bravo: [1, 2], alpha: 1})
        .freeze()

      assert.equal(processor.attachers.length, 1)
      assert.equal(calls, 1)

      /**
       * @param {unknown} options
       */
      function spy(options) {
        assert.deepEqual(options, {alpha: 1, bravo: [1, 2]})
        calls++
      }
    }
  )

  await t.test(
    'should throw on duplicate registration with different options when enabled, before `freeze`, without calling the plugin',
    function () {
      let calls = 0
      const processor = unified().pluginIdentityCheck(true)

      processor.use(spy, {alpha: 1})

      assert.throws(function () {
        processor.use(spy, {alpha: 2})
      }, /Cannot register plugin `spy` with different options/)

      // The failure happens at registration, before `freeze`:
      // the plugin is never called.
      assert.equal(calls, 0)
      assert.equal(processor.attachers.length, 1)

      /**
       * @param {unknown} [_]
       */
      function spy(_) {
        calls++
      }
    }
  )

  await t.test(
    'should throw on duplicate registration with `false` after options when enabled',
    function () {
      let calls = 0
      const processor = unified().pluginIdentityCheck(true)

      processor.use(spy, {alpha: 1})

      assert.throws(function () {
        processor.use(spy, false)
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_]
       */
      function spy(_) {
        calls++
      }
    }
  )

  await t.test('should compare `undefined` and `null` options', function () {
    let calls = 0

    unified()
      .pluginIdentityCheck(true)
      .use(spy, undefined)
      .use(spy, undefined)
      .freeze()

    unified().pluginIdentityCheck(true).use(spy, null).use(spy, null).freeze()

    assert.equal(calls, 2)

    const processor = unified().pluginIdentityCheck(true)

    processor.use(spy, null)

    assert.throws(function () {
      processor.use(spy, undefined)
    }, /Cannot register plugin `spy` with different options/)

    assert.equal(calls, 2)

    /**
     * @param {unknown} [_]
     */
    function spy(_) {
      calls++
    }
  })

  await t.test(
    'should compare all parameters, not just the first one',
    function () {
      let calls = 0
      const processor = unified().pluginIdentityCheck(true)

      processor.use(spy, {alpha: 1}, 'bravo')

      assert.throws(function () {
        processor.use(spy, {alpha: 1}, 'charlie')
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_a]
       * @param {unknown} [_b]
       */
      function spy(_a, _b) {
        calls++
      }
    }
  )

  await t.test(
    'should throw an explicit error for non-comparable options (function)',
    function () {
      let calls = 0
      const processor = unified().pluginIdentityCheck(true)

      processor.use(spy, {alpha: handler})

      assert.throws(function () {
        processor.use(spy, {alpha: handler})
      }, /Cannot compare options of plugin `spy`: expected plain serializable options, not function `handler`/)

      assert.equal(calls, 0)

      function handler() {}

      /**
       * @param {unknown} [_]
       */
      function spy(_) {
        calls++
      }
    }
  )

  await t.test(
    'should throw an explicit error for circular options',
    function () {
      let calls = 0
      const processor = unified().pluginIdentityCheck(true)
      const options = {alpha: 1}
      // @ts-expect-error: check how circular structures are handled.
      options.self = options

      processor.use(spy, options)

      assert.throws(function () {
        processor.use(spy, options)
      }, /Cannot compare options of plugin `spy`: circular structures are not serializable/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_]
       */
      function spy(_) {
        calls++
      }
    }
  )

  await t.test(
    'should throw explicit errors for other non-comparable values',
    function () {
      const anonymous = Object.defineProperty(
        /**
         * @param {unknown} [_]
         */
        function (_) {},
        'name',
        {value: ''}
      )

      assertNonComparable({alpha: anonymous}, /not function `anonymous`$/)
      assertNonComparable({alpha: Symbol('x')}, /not symbol$/)
      assertNonComparable({alpha: BigInt(1)}, /not bigint$/)
      assertNonComparable(
        {alpha: /** @type {Map<unknown, unknown>} */ (new Map())},
        /not object `\[object Map]`$/
      )

      /**
       * @param {unknown} options
       * @param {RegExp} message
       */
      function assertNonComparable(options, message) {
        const processor = unified().pluginIdentityCheck(true)

        processor.use(spy, options)

        assert.throws(function () {
          processor.use(spy, options)
        }, message)
      }

      /**
       * @param {unknown} [_]
       */
      function spy(_) {}
    }
  )

  await t.test('should support anonymous plugins in errors', function () {
    const processor = unified().pluginIdentityCheck(true)
    const spy = Object.defineProperty(
      /**
       * @param {unknown} [_]
       */
      function (_) {},
      'name',
      {value: ''}
    )

    processor.use(spy, {alpha: 1})

    assert.throws(function () {
      processor.use(spy, {alpha: 2})
    }, /Cannot register plugin `anonymous` with different options/)
  })

  await t.test(
    'should not execute plugins when registration fails (in-memory process fixture)',
    function () {
      let calls = 0
      const processor = unified()
        .pluginIdentityCheck(true)
        .use(parse)
        .use(compile)
        .use(spy, {alpha: 1})

      assert.throws(function () {
        processor.use(spy, {alpha: 2})
      }, /Cannot register plugin `spy` with different options/)

      // Zero executions: the failing registration prevents `freeze`,
      // so nothing ran.
      assert.equal(calls, 0)

      // A correctly configured processor still processes fine.
      const file = unified()
        .pluginIdentityCheck(true)
        .use(parse)
        .use(compile)
        .use(spy, {alpha: 1})
        .use(spy, {alpha: 1})
        .processSync('hello')

      assert.equal(calls, 1)
      assert.equal(String(file), 'hello')

      /**
       * @param {unknown} [_]
       */
      function spy(_) {
        calls++
      }
    }
  )
})
