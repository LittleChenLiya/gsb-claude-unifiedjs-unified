/**
 * @import {Plugin, PluginOrdering} from 'unified'
 * @import {Literal} from 'unist'
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {unified} from 'unified'

/**
 * @typedef RecordOrdering
 *   Ordering info for a planned plugin.
 * @property {Array<string> | undefined} [after]
 *   Names of plugins this plugin must run after (optional).
 * @property {Array<string> | undefined} [before]
 *   Names of plugins this plugin must run before (optional).
 */

/**
 * @typedef {Record<string, unknown> | undefined} RecordOptions
 *   Options accepted by the recorder plugins.
 */

/**
 * @typedef {Plugin<[RecordOptions?]> & PluginOrdering} RecordPlugin
 *   Recorder plugin with explicit ordering fields.
 */

/**
 * @typedef {Plugin<[RecordOptions?], Literal, Literal> & PluginOrdering} AsyncRecordPlugin
 *   Async recorder plugin with explicit ordering fields.
 */

test('plan (explicit plugin dependencies)', async function (t) {
  await t.test('should run three plugins in planned order', function () {
    /** @type {Array<string>} */
    const calls = []

    unified()
      // Registered in a scrambled order, but `first` declares it runs before
      // `second`, and `third` declares it runs after `second`.
      .use(record('third', calls, {after: ['second']}))
      .use(record('first', calls, {before: ['second']}))
      .use(record('second', calls))
      .runSync({type: 'text'})

    assert.deepEqual(calls, ['first', 'second', 'third'])
  })

  await t.test(
    'should chain reversed promises in planned order',
    async function () {
      /** @type {Array<string>} */
      const seen = []

      // Async plugins registered in the reverse order of how they must run.
      const processor = unified()
        .use(asyncRecord('c', seen, {after: ['b']}))
        .use(asyncRecord('b', seen, {after: ['a']}))
        .use(asyncRecord('a', seen))

      const tree = await processor.run({type: 'text', value: ''})

      // Each plugin saw the result of the plugin planned before it.
      assert.deepEqual(seen, ['a:', 'b:a', 'c:ab'])
      assert.equal(tree.value, 'abc')
    }
  )

  await t.test('should reject circular dependencies', function () {
    const processor = unified()
      .use(record('a', [], {after: ['b']}))
      .use(record('b', [], {after: ['a']}))

    assert.throws(function () {
      processor.freeze()
    }, /Cannot plan plugins: circular dependency detected between `a`, `b`/)
  })

  await t.test('should reject a plugin depending on itself', function () {
    const processor = unified().use(record('self', [], {after: ['self']}))

    assert.throws(function () {
      processor.freeze()
    }, /Cannot plan plugins: circular dependency detected between `self`/)
  })

  await t.test('should reject missing dependencies', function () {
    const processor = unified().use(record('x', [], {after: ['missing']}))

    assert.throws(function () {
      processor.freeze()
    }, /Cannot plan plugins: missing dependency `missing`/)
  })

  await t.test(
    'should run a plugin after all plugins that share a name',
    function () {
      /** @type {Array<string>} */
      const calls = []

      unified()
        .use(record('later', calls, {after: ['shared']}))
        .use(record('shared', calls))
        .use(record('shared', calls))
        .runSync({type: 'text'})

      assert.deepEqual(calls, ['shared', 'shared', 'later'])
    }
  )

  await t.test(
    'should mention anonymous plugins in missing dependency errors',
    function () {
      const processor = unified().use(
        Object.assign(
          function () {
            return function () {}
          },
          {after: ['missing']}
        )
      )

      assert.throws(function () {
        processor.freeze()
      }, /Cannot plan plugins: missing dependency `missing`, which `anonymous plugin` must run after/)
    }
  )

  await t.test(
    'should mention anonymous plugins in circular dependency errors',
    function () {
      const processor = unified()
        .use(record('a', [], {after: ['b']}))
        .use(record('b', [], {after: ['a']}))
        .use(
          Object.assign(
            function () {
              return function () {}
            },
            {after: ['a']}
          )
        )

      assert.throws(function () {
        processor.freeze()
      }, /Cannot plan plugins: circular dependency detected between `a`, `b`, `anonymous plugin`/)
    }
  )

  await t.test(
    'should mention anonymous plugins in dependency list errors',
    function () {
      const processor = unified().use(
        Object.assign(
          function () {
            return function () {}
          },
          {
            before: /** @type {Array<string>} */ (/** @type {unknown} */ ([42]))
          }
        )
      )

      assert.throws(function () {
        processor.freeze()
      }, /Cannot plan plugins: expected `before` on `anonymous plugin` to be an array of plugin names/)
    }
  )

  await t.test(
    'should reject `before`/`after` values that are not name lists',
    function () {
      const plugin = record('broken', [])
      plugin.after = /** @type {Array<string>} */ (
        /** @type {unknown} */ (['fine', 42])
      )

      const processor = unified().use(plugin)

      assert.throws(function () {
        processor.freeze()
      }, /Cannot plan plugins: expected `after` on `broken` to be an array of plugin names/)
    }
  )

  await t.test(
    'should attribute async errors to the actual plugin and not run successors',
    async function () {
      let successorCalls = 0

      /** @type {RecordPlugin} */
      const failing = function () {
        return async function () {
          await tick()
          throw new Error('boom')
        }
      }

      failing.pluginName = 'failing'

      /** @type {RecordPlugin} */
      const successor = function () {
        return function () {
          successorCalls++
        }
      }

      successor.pluginName = 'successor'
      successor.after = ['failing']

      // Registered in reverse: the plan still runs `failing` first.
      const processor = unified().use(successor).use(failing)
      /** @type {unknown} */
      let caught

      try {
        await processor.run({type: 'text'})
      } catch (error) {
        caught = error
      }

      assert.ok(caught instanceof Error)
      assert.equal(caught.message, 'boom')
      assert.equal(/** @type {{plugin?: string}} */ (caught).plugin, 'failing')
      // The next plugin was never called.
      assert.equal(successorCalls, 0)
    }
  )

  await t.test(
    'should attribute sync errors to the actual plugin',
    function () {
      /** @type {RecordPlugin} */
      const failing = function () {
        return function () {
          throw new Error('sync boom')
        }
      }

      failing.pluginName = 'sync-failing'

      const processor = unified().use(failing)
      /** @type {unknown} */
      let caught

      try {
        processor.runSync({type: 'text'})
      } catch (error) {
        caught = error
      }

      assert.ok(caught instanceof Error)
      assert.equal(caught.message, 'sync boom')
      assert.equal(
        /** @type {{plugin?: string}} */ (caught).plugin,
        'sync-failing'
      )
    }
  )

  await t.test(
    'should not change a frozen processor when the original options change',
    function () {
      const options = {nested: {value: 'original'}, list: ['a']}
      /** @type {string | undefined} */
      let seen

      /** @type {Plugin<[typeof options]>} */
      const plugin = function (configuration) {
        return function () {
          seen = configuration.nested.value + ',' + configuration.list.join('')
        }
      }

      const processor = unified().use(plugin, options)
      processor.freeze()

      // Mutate the original configuration object after freezing.
      options.nested.value = 'changed'
      options.list.push('b')

      processor.runSync({type: 'text'})

      assert.equal(seen, 'original,a')
    }
  )

  await t.test('should give nested processors independent plans', function () {
    /** @type {Array<string>} */
    const outerCalls = []
    /** @type {Array<string>} */
    const innerCalls = []

    /** @type {RecordPlugin} */
    const nested = function () {
      // A nested processor with its own plan, using the same plugin
      // names as the outer processor but the opposite order.
      const inner = unified()
        .use(record('x', innerCalls, {before: ['y']}))
        .use(record('y', innerCalls))

      return function () {
        inner.runSync({type: 'text'})
      }
    }

    nested.pluginName = 'nested'
    nested.after = ['y']

    unified()
      .use(record('x', outerCalls))
      .use(nested)
      .use(record('y', outerCalls, {before: ['x']}))
      .runSync({type: 'text'})

    // Outer plan: `y` before `x`, `nested` after `y`.
    assert.deepEqual(outerCalls, ['y', 'x'])
    // Inner plan is independent of the outer plan with the same names.
    assert.deepEqual(innerCalls, ['x', 'y'])
  })

  await t.test(
    'should keep registration order for plugins without dependencies',
    function () {
      /** @type {Array<string>} */
      const calls = []

      unified()
        .use(record('a', calls))
        .use(record('b', calls))
        .use(record('c', calls))
        .runSync({type: 'text'})

      assert.deepEqual(calls, ['a', 'b', 'c'])
    }
  )

  await t.test(
    'should keep unconstrained plugins in place between planned ones',
    function () {
      /** @type {Array<string>} */
      const calls = []

      unified()
        .use(record('b', calls, {after: ['a']}))
        .use(record('plain', calls))
        .use(record('a', calls))
        .runSync({type: 'text'})

      // `plain` keeps its registration spot relative to unconstrained
      // plugins, `b` moves after `a`.
      assert.deepEqual(calls, ['plain', 'a', 'b'])
    }
  )

  await t.test(
    'should not change the planned order when `use` is repeated',
    function () {
      /** @type {Array<string>} */
      const calls = []
      const b = record('b', calls, {after: ['a']})
      const a = record('a', calls)

      const processor = unified().use(b).use(a)
      // Reconfiguring `b` must not move it in the plan.
      processor.use(b, {x: 1})
      processor.use(a)

      processor.runSync({type: 'text'})

      assert.deepEqual(calls, ['a', 'b'])
    }
  )
})

/**
 * Create a plugin that records when its transformer runs.
 *
 * @param {string} name
 *   Name of the plugin.
 * @param {Array<string>} calls
 *   List to record into.
 * @param {RecordOrdering | undefined} [ordering]
 *   Explicit ordering info (optional).
 * @returns {RecordPlugin}
 *   Plugin.
 */
function record(name, calls, ordering) {
  /** @type {RecordPlugin} */
  const plugin = function () {
    return transformer

    /**
     * Record the run.
     *
     * @returns {undefined}
     *   Nothing.
     */
    function transformer() {
      calls.push(name)
    }
  }

  plugin.pluginName = name

  if (ordering) {
    if (ordering.after) plugin.after = ordering.after
    if (ordering.before) plugin.before = ordering.before
  }

  return plugin
}

/**
 * Create an async plugin that records the tree it received and appends its
 * name to the tree, to verify that reversed promises still chain in planned
 * order.
 *
 * @param {string} name
 *   Name of the plugin.
 * @param {Array<string>} seen
 *   List to record into.
 * @param {RecordOrdering | undefined} [ordering]
 *   Explicit ordering info (optional).
 * @returns {AsyncRecordPlugin}
 *   Plugin.
 */
function asyncRecord(name, seen, ordering) {
  /** @type {AsyncRecordPlugin} */
  const plugin = function () {
    return transformer

    /**
     * Record the received tree and append `name` to it.
     *
     * @param {Literal} tree
     *   Tree to change.
     * @returns {Promise<Literal>}
     *   Changed tree.
     */
    async function transformer(tree) {
      await tick()
      seen.push(name + ':' + tree.value)
      return {type: 'text', value: tree.value + name}
    }
  }

  plugin.pluginName = name

  if (ordering) {
    if (ordering.after) plugin.after = ordering.after
    if (ordering.before) plugin.before = ordering.before
  }

  return plugin
}

/**
 * Wait a tick.
 *
 * @returns {Promise<undefined>}
 *   Nothing.
 */
function tick() {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve(undefined)
    }, 1)
  })
}
