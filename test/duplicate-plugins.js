import assert from 'node:assert/strict'
import test from 'node:test'
import {unified} from 'unified'

test('duplicate plugin checks', async function (t) {
  await t.test('opt-in', async function (t) {
    await t.test('should be disabled by default', function () {
      const processor = unified()
      assert.equal(processor.checkDuplicatePlugins, false)
    })

    await t.test('should be enabled with `ProcessorOptions`', function () {
      const processor = unified({checkDuplicatePlugins: true})
      assert.equal(processor.checkDuplicatePlugins, true)
    })

    await t.test('should be inherited by copies', function () {
      const processor = unified({checkDuplicatePlugins: true})()
      assert.equal(processor.checkDuplicatePlugins, true)
    })

    await t.test('should stay disabled without the option', function () {
      const processor = unified({})()
      assert.equal(processor.checkDuplicatePlugins, false)
    })
  })

  await t.test('default behavior (option disabled)', async function (t) {
    await t.test(
      'should keep the default duplicate registration: merge objects',
      function () {
        let calls = 0
        /** @type {unknown} */
        let seen

        unified()
          .use(spy, {alpha: 1, bravo: {x: 1}})
          .use(spy, {bravo: {y: 2}, charlie: 3})
          .freeze()

        assert.equal(calls, 1)
        assert.deepEqual(seen, {
          alpha: 1,
          bravo: {x: 1, y: 2},
          charlie: 3
        })

        /**
         * @param {unknown} [options]
         */
        function spy(options) {
          seen = options
          calls++
        }
      }
    )

    await t.test(
      'should keep the default duplicate registration: last one wins',
      function () {
        let calls = 0
        /** @type {unknown} */
        let seen

        unified().use(spy, 'one').use(spy, 'two').freeze()

        assert.equal(calls, 1)
        assert.equal(seen, 'two')

        /**
         * @param {unknown} [options]
         */
        function spy(options) {
          seen = options
          calls++
        }
      }
    )

    await t.test(
      'should register the plugin once, with one entry',
      function () {
        const processor = unified().use(spy).use(spy)

        assert.equal(processor.attachers.length, 1)

        function spy() {}
      }
    )
  })

  await t.test('same options (option enabled)', async function (t) {
    await t.test(
      'should allow duplicate, deeply equal, plain objects',
      function () {
        let calls = 0
        /** @type {unknown} */
        let seen

        unified({checkDuplicatePlugins: true})
          .use(spy, {alpha: [1, 2], bravo: {x: null}})
          .use(spy, {alpha: [1, 2], bravo: {x: null}})
          .freeze()

        assert.equal(calls, 1)
        assert.deepEqual(seen, {alpha: [1, 2], bravo: {x: null}})

        /**
         * @param {unknown} [options]
         */
        function spy(options) {
          seen = options
          calls++
        }
      }
    )

    await t.test(
      'should allow duplicate, equal, primitive options',
      function () {
        let calls = 0

        // Note: `false` disables a plugin in `freeze`, so it is not executed.
        for (const value of ['alpha', 1, true, false, null, undefined]) {
          const processor = unified({checkDuplicatePlugins: true})
          processor.use(spy, value).use(spy, value).freeze()
        }

        assert.equal(calls, 5)

        /**
         * @param {unknown} [_options]
         * @returns {undefined}
         */
        function spy(_options) {
          calls++
        }
      }
    )

    await t.test('should allow duplicate equal parameters', function () {
      let calls = 0
      /** @type {Array<unknown>} */
      let seen = []

      unified({checkDuplicatePlugins: true})
        .use(spy, {alpha: 1}, ['x'], 2)
        .use(spy, {alpha: 1}, ['x'], 2)
        .freeze()

      assert.equal(calls, 1)
      assert.deepEqual(seen, [{alpha: 1}, ['x'], 2])

      /**
       * @param {unknown} options
       * @param {unknown} rest
       * @param {unknown} third
       */
      function spy(options, rest, third) {
        seen = [options, rest, third]
        calls++
      }
    })

    await t.test(
      'should structurally compare shared, non-circular, references',
      function () {
        let calls = 0
        const shared = {x: 1}
        const first = {a: shared, b: shared}
        const second = {a: {x: 1}, b: {x: 1}}

        unified({checkDuplicatePlugins: true})
          .use(spy, first)
          .use(spy, second)
          .freeze()

        assert.equal(calls, 1)

        /**
         * @param {unknown} [_options]
         * @returns {undefined}
         */
        function spy(_options) {
          calls++
        }
      }
    )
  })

  await t.test('different options (option enabled)', async function (t) {
    await t.test('should throw on different plain object options', function () {
      let calls = 0

      assert.throws(function () {
        unified({checkDuplicatePlugins: true})
          .use(spy, {alpha: 1})
          .use(spy, {alpha: 2})
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_options]
       * @returns {undefined}
       */
      function spy(_options) {
        calls++
      }
    })

    await t.test('should throw on different arrays', function () {
      let calls = 0

      assert.throws(function () {
        unified({checkDuplicatePlugins: true})
          .use(spy, [1, 2, 3])
          .use(spy, [1, 2, 4])
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_options]
       * @returns {undefined}
       */
      function spy(_options) {
        calls++
      }
    })

    await t.test('should throw on different primitive options', function () {
      let calls = 0

      assert.throws(function () {
        unified({checkDuplicatePlugins: true}).use(spy, 'one').use(spy, 'two')
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_options]
       * @returns {undefined}
       */
      function spy(_options) {
        calls++
      }
    })

    await t.test(
      'should name plugins with an empty name as anonymous',
      function () {
        const calls = 0
        const plugin = /** @type {(options?: unknown) => undefined} */ (
          Object.defineProperty(function () {}, 'name', {value: ''})
        )

        assert.throws(function () {
          unified({checkDuplicatePlugins: true})
            .use(plugin, {alpha: 1})
            .use(plugin, {alpha: 2})
        }, /Cannot register plugin `anonymous plugin` with different options/)

        assert.equal(calls, 0)
      }
    )

    await t.test(
      'should throw on different non-primary parameters',
      function () {
        let calls = 0

        assert.throws(function () {
          unified({checkDuplicatePlugins: true})
            .use(spy, {alpha: 1}, 'same')
            .use(spy, {alpha: 1}, 'different')
        }, /Cannot register plugin `spy` with different options/)

        assert.equal(calls, 0)

        /**
         * @param {unknown} [_options]
         * @param {unknown} [_rest]
         * @returns {undefined}
         */
        function spy(_options, _rest) {
          calls++
        }
      }
    )

    await t.test('should throw on different keys in objects', function () {
      let calls = 0

      assert.throws(function () {
        unified({checkDuplicatePlugins: true})
          .use(spy, {alpha: 1})
          .use(spy, {alpha: 1, bravo: 2})
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_options]
       * @returns {undefined}
       */
      function spy(_options) {
        calls++
      }
    })

    await t.test('should throw on an array versus an object', function () {
      let calls = 0

      assert.throws(function () {
        unified({checkDuplicatePlugins: true})
          .use(spy, {alpha: [1]})
          .use(spy, {alpha: {0: 1}})
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_options]
       * @returns {undefined}
       */
      function spy(_options) {
        calls++
      }
    })

    await t.test('should throw on an object versus an array', function () {
      let calls = 0

      assert.throws(function () {
        unified({checkDuplicatePlugins: true})
          .use(spy, {alpha: {0: 1}})
          .use(spy, {alpha: [1]})
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_options]
       * @returns {undefined}
       */
      function spy(_options) {
        calls++
      }
    })

    await t.test('should throw on an array versus a scalar', function () {
      let calls = 0

      assert.throws(function () {
        unified({checkDuplicatePlugins: true}).use(spy, [1]).use(spy, 1)
      }, /Cannot register plugin `spy` with different options/)

      assert.throws(function () {
        unified({checkDuplicatePlugins: true}).use(spy, 1).use(spy, [1])
      }, /Cannot register plugin `spy` with different options/)

      assert.equal(calls, 0)

      /**
       * @param {unknown} [_options]
       * @returns {undefined}
       */
      function spy(_options) {
        calls++
      }
    })

    await t.test(
      'should not change the configured plugins when it throws',
      function () {
        let calls = 0
        const processor = unified({checkDuplicatePlugins: true})

        processor.use(spy, {alpha: 1})

        assert.throws(function () {
          processor.use(spy, {alpha: 2})
        }, /different options/)

        // The original, first, registration is untouched.
        assert.equal(processor.attachers.length, 1)
        assert.deepEqual(processor.attachers[0].slice(1), [{alpha: 1}])

        assert.equal(calls, 0)

        /**
         * @param {unknown} [_options]
         * @returns {undefined}
         */
        function spy(_options) {
          calls++
        }
      }
    )

    await t.test('should fail before plugins run (no freeze)', function () {
      let calls = 0

      const processor = unified({checkDuplicatePlugins: true})

      assert.throws(function () {
        processor.use(spy).use(spy, {alpha: 1})
      }, /different options/)

      // Nothing ran, because freezing never happened (and is not reached).
      assert.equal(calls, 0)

      /**
       * @param {unknown} [_options]
       * @returns {undefined}
       */
      function spy(_options) {
        calls++
      }
    })
  })

  await t.test(
    'options that cannot be compared (option enabled)',
    async function (t) {
      await t.test(
        'should throw an explicit error on circular options',
        function () {
          let calls = 0
          /** @type {Record<string, unknown>} */
          const circular = {alpha: 1}
          circular.self = circular

          assert.throws(function () {
            unified({checkDuplicatePlugins: true})
              .use(spy, circular)
              .use(spy, {alpha: 1, self: {}})
          }, /Cannot compare options of plugin `spy`/)

          assert.equal(calls, 0)

          /**
           * @param {unknown} [_options]
           * @returns {undefined}
           */
          function spy(_options) {
            calls++
          }
        }
      )

      await t.test(
        'should throw an explicit error on circular options on both sides',
        function () {
          let calls = 0
          /** @type {Record<string, unknown>} */
          const first = {alpha: 1}
          first.self = first
          /** @type {Record<string, unknown>} */
          const second = {alpha: 1}
          second.self = second

          assert.throws(function () {
            unified({checkDuplicatePlugins: true})
              .use(spy, first)
              .use(spy, second)
          }, /Cannot compare options of plugin `spy`/)

          assert.equal(calls, 0)

          /**
           * @param {unknown} [_options]
           * @returns {undefined}
           */
          function spy(_options) {
            calls++
          }
        }
      )

      await t.test(
        'should throw an explicit error on circular options on one side',
        function () {
          let calls = 0
          /** @type {Record<string, unknown>} */
          const first = {alpha: {bravo: 1}, charlie: {}}
          /** @type {Record<string, unknown>} */
          const second = {alpha: {bravo: 1}, charlie: {}}
          second.charlie = second

          assert.throws(function () {
            unified({checkDuplicatePlugins: true})
              .use(spy, first)
              .use(spy, second)
          }, /Cannot compare options of plugin `spy`/)

          assert.equal(calls, 0)

          /**
           * @param {unknown} [_options]
           * @returns {undefined}
           */
          function spy(_options) {
            calls++
          }
        }
      )

      await t.test(
        'should throw an explicit error on non-serializable values (functions)',
        function () {
          let calls = 0

          assert.throws(function () {
            unified({checkDuplicatePlugins: true})
              .use(spy, {alpha: () => undefined})
              .use(spy, {alpha: () => undefined})
          }, /Cannot compare options of plugin `spy`/)

          assert.equal(calls, 0)

          /**
           * @param {unknown} [_options]
           * @returns {undefined}
           */
          function spy(_options) {
            calls++
          }
        }
      )

      await t.test(
        'should throw an explicit error on non-plain objects',
        function () {
          let calls = 0

          assert.throws(function () {
            unified({checkDuplicatePlugins: true})
              .use(spy, new Date(0))
              .use(spy, new Date(0))
          }, /Cannot compare options of plugin `spy`/)

          assert.equal(calls, 0)

          /**
           * @param {unknown} [_options]
           * @returns {undefined}
           */
          function spy(_options) {
            calls++
          }
        }
      )

      await t.test('should throw an explicit error on `NaN`', function () {
        let calls = 0

        assert.throws(function () {
          unified({checkDuplicatePlugins: true})
            .use(spy, Number.NaN)
            .use(spy, Number.NaN)
        }, /Cannot compare options of plugin `spy`/)

        assert.equal(calls, 0)

        /**
         * @param {unknown} [_options]
         * @returns {undefined}
         */
        function spy(_options) {
          calls++
        }
      })
    }
  )

  await t.test('presets and lists (option enabled)', async function (t) {
    await t.test(
      'should detect the same plugin in a preset registered again',
      function () {
        let calls = 0

        assert.throws(function () {
          unified({checkDuplicatePlugins: true})
            .use({plugins: [[spy, {alpha: 1}]]})
            .use(spy, {alpha: 2})
        }, /Cannot register plugin `spy` with different options/)

        assert.equal(calls, 0)

        /**
         * @param {unknown} [_options]
         * @returns {undefined}
         */
        function spy(_options) {
          calls++
        }
      }
    )

    await t.test(
      'should allow equal options given through a list',
      function () {
        let calls = 0

        unified({checkDuplicatePlugins: true})
          .use([[spy, {alpha: 1}]])
          .use([[spy, {alpha: 1}]])
          .freeze()

        assert.equal(calls, 1)

        /**
         * @param {unknown} [_options]
         * @returns {undefined}
         */
        function spy(_options) {
          calls++
        }
      }
    )
  })
})
