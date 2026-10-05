import assert from 'node:assert/strict'
import test from 'node:test'
import {unified} from 'unified'
import {buildPlan} from '../lib/plan.js'

test('plugin plan', async function (t) {
  await t.test(
    'should run three plugins in planned order (before)',
    async function () {
      const calls = /** @type {Array<string>} */ ([])

      function alpha() {
        return function () {
          calls.push('alpha')
        }
      }

      function beta() {
        return function () {
          calls.push('beta')
        }
      }

      function gamma() {
        return function () {
          calls.push('gamma')
        }
      }

      // Alpha must run before beta and gamma.
      // Beta must run before gamma.
      alpha.before = [beta, gamma]
      beta.before = [gamma]

      const processor = unified()
      processor.use(gamma)
      processor.use(beta)
      processor.use(alpha)
      await processor.run({type: 'root'})

      assert.deepEqual(calls, ['alpha', 'beta', 'gamma'])
    }
  )

  await t.test(
    'should run three plugins in planned order (after)',
    async function () {
      const calls = /** @type {Array<string>} */ ([])

      function alpha() {
        return function () {
          calls.push('alpha')
        }
      }

      function beta() {
        return function () {
          calls.push('beta')
        }
      }

      function gamma() {
        return function () {
          calls.push('gamma')
        }
      }

      // Gamma must run after alpha and beta.
      // Beta must run after alpha.
      gamma.after = [alpha, beta]
      beta.after = [alpha]

      const processor = unified()
      processor.use(gamma)
      processor.use(beta)
      processor.use(alpha)
      await processor.run({type: 'root'})

      assert.deepEqual(calls, ['alpha', 'beta', 'gamma'])
    }
  )

  await t.test(
    'should chain promises in planned order even when they resolve in reverse',
    async function () {
      const calls = /** @type {Array<string>} */ ([])

      function alpha() {
        return function () {
          return new Promise(function (resolve) {
            setImmediate(function () {
              calls.push('alpha')
              resolve(undefined)
            })
          })
        }
      }

      function beta() {
        return function () {
          return new Promise(function (resolve) {
            setImmediate(function () {
              calls.push('beta')
              resolve(undefined)
            })
          })
        }
      }

      function gamma() {
        return function () {
          return new Promise(function (resolve) {
            setImmediate(function () {
              calls.push('gamma')
              resolve(undefined)
            })
          })
        }
      }

      alpha.before = [beta, gamma]
      beta.before = [gamma]

      const processor = unified()
      processor.use(gamma)
      processor.use(beta)
      processor.use(alpha)
      await processor.run({type: 'root'})

      assert.deepEqual(calls, ['alpha', 'beta', 'gamma'])
    }
  )

  await t.test('should reject a cycle in dependencies', async function () {
    function alpha() {}
    function beta() {}
    function gamma() {}

    alpha.before = [beta]
    beta.before = [gamma]
    gamma.before = [alpha]

    assert.throws(function () {
      const processor = unified()
      processor.use(alpha)
      processor.use(beta)
      processor.use(gamma)
      processor.freeze()
    }, /Cycle detected in plugin dependencies/)
  })

  await t.test('should reject a missing dependency', async function () {
    function alpha() {}
    function beta() {}

    alpha.before = [beta]

    assert.throws(function () {
      unified().use(alpha).freeze()
    }, /Missing dependency/)
  })

  await t.test(
    'should attribute an async transformer error to the plugin and stop',
    async function () {
      const calls = /** @type {Array<string>} */ ([])
      const givenError = new Error('boom')

      function failing() {
        return function () {
          return Promise.reject(givenError)
        }
      }

      function next() {
        return function () {
          calls.push('next')
        }
      }

      await assert.rejects(
        (function () {
          const processor = unified()
          processor.use(failing)
          processor.use(next)
          return processor.run({type: 'root'})
        })(),
        function (error) {
          assert.equal(error, givenError)
          assert.equal(
            /** @type {Error & {plugin: string}} */ (error).plugin,
            'failing'
          )
          return true
        }
      )

      assert.deepEqual(calls, [])
    }
  )

  await t.test(
    'should attribute a sync transformer error to the plugin and stop',
    async function () {
      const calls = /** @type {Array<string>} */ ([])
      const givenError = new Error('boom')

      function failing() {
        return function () {
          return givenError
        }
      }

      function next() {
        return function () {
          calls.push('next')
        }
      }

      await assert.rejects(
        (function () {
          const processor = unified()
          processor.use(failing)
          processor.use(next)
          return processor.run({type: 'root'})
        })(),
        function (error) {
          assert.equal(error, givenError)
          assert.equal(
            /** @type {Error & {plugin: string}} */ (error).plugin,
            'failing'
          )
          return true
        }
      )

      assert.deepEqual(calls, [])
    }
  )

  await t.test(
    'should keep the original use order when there are no dependencies',
    async function () {
      const calls = /** @type {Array<string>} */ ([])

      function alpha() {
        return function () {
          calls.push('alpha')
        }
      }

      function beta() {
        return function () {
          calls.push('beta')
        }
      }

      function gamma() {
        return function () {
          calls.push('gamma')
        }
      }

      const processor = unified()
      processor.use(gamma)
      processor.use(beta)
      processor.use(alpha)
      await processor.run({type: 'root'})

      assert.deepEqual(calls, ['gamma', 'beta', 'alpha'])
    }
  )

  await t.test(
    'should not be affected by mutations to the original config after freezing',
    async function () {
      const givenOptions = {alpha: 'bravo'}
      /** @type {Record<string, unknown> | undefined} */
      let receivedOptions

      /**
       * @param {Record<string, unknown>} options
       */
      function plugin(options) {
        receivedOptions = options
      }

      unified().use(plugin, givenOptions).freeze()

      const mutated = /** @type {Record<string, unknown>} */ (givenOptions)
      mutated.charlie = 'delta'

      assert.deepEqual(receivedOptions, {alpha: 'bravo'})
      assert.notEqual(receivedOptions, givenOptions)
    }
  )

  await t.test(
    'should give nested processors an independent plan',
    async function () {
      const calls = /** @type {Array<string>} */ ([])

      function alpha() {
        return function () {
          calls.push('alpha')
        }
      }

      function beta() {
        return function () {
          calls.push('beta')
        }
      }

      alpha.before = [beta]

      const processor = unified()
      processor.use(beta)
      processor.use(alpha)
      processor.freeze()

      // The nested processor has its own plan, so alpha runs before beta.
      await processor().run({type: 'root'})
      assert.deepEqual(calls, ['alpha', 'beta'])

      // The original processor also runs in the planned order.
      await processor.run({type: 'root'})
      assert.deepEqual(calls, ['alpha', 'beta', 'alpha', 'beta'])
    }
  )

  await t.test('should support the `plan` object form', async function () {
    const calls = /** @type {Array<string>} */ ([])

    function alpha() {
      return function () {
        calls.push('alpha')
      }
    }

    function beta() {
      return function () {
        calls.push('beta')
      }
    }

    function gamma() {
      return function () {
        calls.push('gamma')
      }
    }

    // Declare dependencies with a `plan` object instead of `before`/`after`.
    alpha.plan = {before: [beta, gamma]}
    beta.plan = {before: [gamma]}

    const processor = unified()
    processor.use(gamma)
    processor.use(beta)
    processor.use(alpha)
    await processor.run({type: 'root'})

    assert.deepEqual(calls, ['alpha', 'beta', 'gamma'])
  })

  await t.test(
    'should not run a plugin that was turned off with `false`',
    async function () {
      const calls = /** @type {Array<string>} */ ([])

      function alpha() {
        return function () {
          calls.push('alpha')
        }
      }

      function beta() {
        return function () {
          calls.push('beta')
        }
      }

      alpha.before = [beta]

      const processor = unified()
      processor.use(beta)
      processor.use(alpha)
      processor.use(beta, false)
      await processor.run({type: 'root'})

      assert.deepEqual(calls, ['alpha'])
    }
  )

  await t.test(
    'should not throw when the error cannot be attributed',
    async function () {
      const givenError = new Error('boom')
      Object.freeze(givenError)

      function failing() {
        return function () {
          return givenError
        }
      }

      await assert.rejects(
        (function () {
          const processor = unified()
          processor.use(failing)
          return processor.run({type: 'root'})
        })(),
        givenError
      )
    }
  )

  await t.test('should handle reconfiguration in the plan', function () {
    function plugin() {}

    const plan = buildPlan([[plugin], [plugin, false]])

    assert.equal(plan.length, 1)
    assert.equal(plan[0].disabled, true)
  })

  await t.test(
    'should pick the smallest index when a dependent becomes ready',
    async function () {
      const calls = /** @type {Array<string>} */ ([])

      function alpha() {
        return function () {
          calls.push('alpha')
        }
      }

      function beta() {
        return function () {
          calls.push('beta')
        }
      }

      function gamma() {
        return function () {
          calls.push('gamma')
        }
      }

      // Beta depends on alpha. Gamma has no dependencies.
      beta.after = [alpha]

      const processor = unified()
      processor.use(alpha)
      processor.use(beta)
      processor.use(gamma)
      await processor.run({type: 'root'})

      // Alpha runs first, then beta, then gamma.
      // Even though gamma was ready before beta, beta has a smaller index.
      assert.deepEqual(calls, ['alpha', 'beta', 'gamma'])
    }
  )
})
