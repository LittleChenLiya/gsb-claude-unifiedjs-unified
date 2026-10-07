/**
 * Small, self-contained, in-memory acceptance fixture for the
 * `checkDuplicatePlugins` processor option.
 *
 * It uses a single spy plugin to show, for each scenario:
 *
 *   1. duplicate registration with the same options (original behavior),
 *   2. duplicate registration with different options (registration error,
 *      zero plugin executions),
 *   3. duplicate registration with circular options (explicit “cannot
 *      compare” error, zero plugin executions),
 *   4. the original default duplicate-registration behavior with the option
 *      disabled (deep merge, single execution).
 *
 * Run it with:
 *
 *   node script/duplicate-plugins-demo.js
 */

import process from 'node:process'
import assert from 'node:assert/strict'
import {unified} from '../index.js'

let failures = 0

/**
 * Run a named scenario and print a one-line report.
 *
 * @param {string} name
 *   Name of the scenario.
 * @param {() => undefined} scenarioFunction
 *   Scenario, expected not to throw.
 * @returns {undefined}
 *   Nothing.
 */
function scenario(name, scenarioFunction) {
  try {
    scenarioFunction()
    console.log('PASS  ' + name)
  } catch (error) {
    failures++
    const message = error instanceof Error ? error.message : String(error)
    console.log('FAIL  ' + name + '\n      ' + message.split('\n')[0])
  }
}

/**
 * Create a fresh spy plugin that counts how many times it is executed.
 *
 * @returns {{plugin: (options?: unknown) => undefined, runs: () => number}}
 *   Spy plugin and a getter for its execution count.
 */
function spy() {
  let runs = 0

  /**
   * @param {unknown} [_options]
   * @returns {undefined}
   */
  function plugin(_options) {
    runs++
  }

  return {
    plugin,
    runs() {
      return runs
    }
  }
}

console.log('unified duplicate plugin identity checks')
console.log('========================================')

// 1. Same options, option enabled: reuse the original behavior.
scenario(
  'enabled, duplicate with the SAME options -> registered once, runs 1',
  function () {
    const {plugin, runs} = spy()

    unified({checkDuplicatePlugins: true})
      .use(plugin, {a: 1, b: [1, 2, {c: null}]})
      .use(plugin, {a: 1, b: [1, 2, {c: null}]})
      .freeze()

    assert.equal(runs(), 1)
  }
)

// 2. Different options, option enabled: registration error, zero executions.
scenario(
  'enabled, duplicate with DIFFERENT options -> registration error, runs 0',
  function () {
    const {plugin, runs} = spy()
    const processor = unified({checkDuplicatePlugins: true})

    let message = ''
    try {
      processor.use(plugin, {a: 1}).use(plugin, {a: 2})
      assert.fail('expected a duplicate-registration error')
    } catch (error) {
      assert.ok(error instanceof Error)
      message = error.message
    }

    assert.match(
      message,
      /Cannot register plugin `plugin` with different options/
    )
    // The failure happens while configuring, before freezing, so nothing ran.
    assert.equal(runs(), 0)
    // The first registration is untouched.
    assert.equal(processor.attachers.length, 1)
    assert.deepEqual(processor.attachers[0].slice(1), [{a: 1}])
  }
)

// 3. Circular options, option enabled: explicit “cannot compare” error.
scenario(
  'enabled, duplicate with CIRCULAR options -> cannot-compare error, runs 0',
  function () {
    const {plugin, runs} = spy()
    /** @type {Record<string, unknown>} */
    const circular = {a: 1}
    circular.self = circular

    let message = ''
    try {
      unified({checkDuplicatePlugins: true})
        .use(plugin, circular)
        .use(plugin, {a: 1, self: {}})
      assert.fail('expected a cannot-compare error')
    } catch (error) {
      assert.ok(error instanceof Error)
      message = error.message
    }

    assert.match(message, /Cannot compare options of plugin `plugin`/)
    assert.equal(runs(), 0)
  }
)

// 3b. Non-serializable options (functions) yield the same explicit error.
scenario(
  'enabled, duplicate with FUNCTION options -> cannot-compare error, runs 0',
  function () {
    const {plugin, runs} = spy()

    let message = ''
    try {
      unified({checkDuplicatePlugins: true})
        .use(plugin, {fn: () => undefined})
        .use(plugin, {fn: () => undefined})
      assert.fail('expected a cannot-compare error')
    } catch (error) {
      assert.ok(error instanceof Error)
      message = error.message
    }

    assert.match(message, /Cannot compare options of plugin `plugin`/)
    assert.equal(runs(), 0)
  }
)

// 4. Option disabled (default): the original interface and behavior remain.
scenario(
  'disabled, duplicate registration -> deep merge, runs 1 (original behavior)',
  function () {
    let runs = 0
    /** @type {unknown} */
    let seen

    unified()
      .use(spyWithOptions, {a: 1, b: {x: 1}})
      .use(spyWithOptions, {b: {y: 2}, c: 3})
      .freeze()

    assert.equal(runs, 1)
    assert.deepEqual(seen, {a: 1, b: {x: 1, y: 2}, c: 3})

    /**
     * @param {unknown} [options]
     */
    function spyWithOptions(options) {
      seen = options
      runs++
    }
  }
)

console.log('========================================')
if (failures) {
  console.log(failures + ' scenario(s) failed')
  process.exitCode = 1
} else {
  console.log('all scenarios passed')
}
