/**
 * @import {Plugin, TransformCallback} from 'unified'
 * @import {Literal} from 'mdast'
 * @import {Node} from 'unist'
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {unified} from 'unified'
import {VFile} from 'vfile'

test('`diagnose`', async function (t) {
  await t.test('should throw without `parser`', async function () {
    const processor = unified().use(compilerPlugin)

    await assert.rejects(async function () {
      return processor.diagnose('alpha')
    }, /Cannot `diagnose` without `parser`/)
  })

  await t.test('should throw without `compiler`', async function () {
    const processor = unified().use(parserPlugin)

    await assert.rejects(async function () {
      return processor.diagnose('alpha')
    }, /Cannot `diagnose` without `compiler`/)
  })

  await t.test(
    'should attribute messages to phases and plugins (four phases)',
    async function () {
      const processor = unified()
        .use(parserPlugin)
        .use(transformOne)
        .use(transformTwo)
        .use(compilerPlugin)

      const report = await processor.diagnose('alpha')

      assert.equal(report.ok, true)
      assert.equal(report.error, undefined)
      assert.equal(String(report.file), 'alpha')

      // Four phases ran, each attributed to its own plugin.
      assert.deepEqual(
        report.phases.map(function (d) {
          return [d.phase, d.plugin, d.ok]
        }),
        [
          ['parse', 'parserPlugin', true],
          ['transform', 'transformOne', true],
          ['transform', 'transformTwo', true],
          ['stringify', 'compilerPlugin', true]
        ]
      )

      // Each phase emitted one message, attributed correctly, not all to the
      // final plugin.
      assert.deepEqual(
        report.messages.map(function (d) {
          return [d.phase, d.plugin, String(d.message.reason)]
        }),
        [
          ['parse', 'parserPlugin', 'from parse'],
          ['transform', 'transformOne', 'from one'],
          ['transform', 'transformTwo', 'from two'],
          ['stringify', 'compilerPlugin', 'from stringify']
        ]
      )

      // Messages are on the file too, each exactly once.
      assert.equal(report.file.messages.length, 4)
    }
  )

  await t.test(
    'should return completed diagnostics and an incomplete status when a phase fails',
    async function () {
      const processor = unified()
        .use(parserPlugin)
        .use(transformOne)
        .use(transformTwoFail)
        .use(compilerPlugin)
      const file = new VFile('alpha')

      file.message('original')

      const report = await processor.diagnose(file)

      assert.equal(report.ok, false)
      assert.equal(report.error && report.error.message, 'boom two')
      assert.equal(report.file, file)

      // `stringify` was not started.
      assert.deepEqual(
        report.phases.map(function (d) {
          return [d.phase, d.plugin, d.ok]
        }),
        [
          ['parse', 'parserPlugin', true],
          ['transform', 'transformOne', true],
          ['transform', 'transformTwoFail', false]
        ]
      )

      const failure = report.phases[2]
      assert.equal(failure.error && failure.error.message, 'boom two')

      // Sources of the messages that were emitted are accurate.
      assert.deepEqual(
        report.messages.map(function (d) {
          return [d.phase, d.plugin, String(d.message.reason)]
        }),
        [
          ['parse', 'parserPlugin', 'from parse'],
          ['transform', 'transformOne', 'from one'],
          ['transform', 'transformTwoFail', 'from two']
        ]
      )

      // The pre-existing message is preserved, exactly once, and not
      // collected as a diagnostic of the run.
      assert.equal(
        file.messages.filter(function (d) {
          return d.reason === 'original'
        }).length,
        1
      )
      assert.equal(file.messages.length, 4)
      assert.equal(
        report.messages.some(function (d) {
          return d.message.reason === 'original'
        }),
        false
      )
    }
  )

  await t.test('should support a failing parse phase', async function () {
    const processor = unified().use(parserFailPlugin).use(compilerPlugin)
    const report = await processor.diagnose('alpha')

    assert.equal(report.ok, false)
    assert.equal(report.error && report.error.message, 'boom parse')
    assert.deepEqual(
      report.phases.map(function (d) {
        return [d.phase, d.ok]
      }),
      [['parse', false]]
    )
  })

  await t.test('should support a failing stringify phase', async function () {
    const processor = unified()
      .use(parserPlugin)
      .use(transformOne)
      .use(compilerFailPlugin)
    const report = await processor.diagnose('alpha')

    assert.equal(report.ok, false)
    assert.equal(report.error && report.error.message, 'boom stringify')
    assert.deepEqual(
      report.phases.map(function (d) {
        return [d.phase, d.plugin, d.ok]
      }),
      [
        ['parse', 'parserPlugin', true],
        ['transform', 'transformOne', true],
        ['stringify', 'compilerFailPlugin', false]
      ]
    )
  })

  await t.test(
    'should treat an empty success as success, not failure',
    async function () {
      const processor = unified()

      processor.parser = function (document) {
        return {type: 'text', value: document}
      }

      processor.compiler = function (tree) {
        return 'value' in tree ? String(tree.value) : ''
      }

      const report = await processor.diagnose('alpha')

      assert.equal(report.ok, true)
      assert.equal(report.error, undefined)
      assert.deepEqual(report.messages, [])
      assert.deepEqual(
        report.phases.map(function (d) {
          return [d.phase, d.plugin, d.ok]
        }),
        [
          ['parse', undefined, true],
          ['stringify', undefined, true]
        ]
      )
      assert.equal(String(report.file), 'alpha')
    }
  )

  await t.test(
    'should not mix file sources between concurrent runs on one processor',
    async function () {
      const processor = unified()
        .use(parserPlugin)
        .use(transformPath)
        .use(compilerPlugin)
      const fileA = new VFile({path: 'a.txt', value: 'alpha'})
      const fileB = new VFile({path: 'b.txt', value: 'bravo'})

      const [reportA, reportB] = await Promise.all([
        processor.diagnose(fileA),
        processor.diagnose(fileB)
      ])

      assert.equal(reportA.ok, true)
      assert.equal(reportB.ok, true)
      assert.equal(reportA.file, fileA)
      assert.equal(reportB.file, fileB)

      for (const d of reportA.messages) {
        if (d.plugin === 'transformPath') {
          assert.match(d.message.reason, /a\.txt$/)
        }
      }

      for (const d of reportB.messages) {
        if (d.plugin === 'transformPath') {
          assert.match(d.message.reason, /b\.txt$/)
        }
      }

      assert.equal(
        fileA.messages.some(function (d) {
          return /b\.txt$/.test(d.reason)
        }),
        false
      )
      assert.equal(
        fileB.messages.some(function (d) {
          return /a\.txt$/.test(d.reason)
        }),
        false
      )
    }
  )

  await t.test('should run the pipeline once per call', async function () {
    let parses = 0
    const processor = unified().use(counterPlugin).use(compilerPlugin)

    /**
     * @type {Plugin<[], string, Node>}
     */
    function counterPlugin() {
      this.parser = parser

      /**
       * @param {string} document
       * @returns {Node}
       */
      function parser(document) {
        parses++
        return /** @type {Literal} */ ({type: 'text', value: document})
      }
    }

    const report = await processor.diagnose('alpha')

    assert.equal(report.ok, true)
    assert.equal(parses, 1)
  })

  await t.test(
    'should support transformers returning a new tree and non-text results',
    async function () {
      const processor = unified().use(parserPlugin).use(transformReplace)

      // @ts-expect-error: custom result, which should be registered!
      processor.compiler = function (tree) {
        return tree
      }

      const report = await processor.diagnose('alpha')

      assert.equal(report.ok, true)
      assert.deepEqual(report.file.result, {type: 'text', value: 'replaced'})
    }
  )

  await t.test(
    'should support anonymous plugins and callback-style transformers',
    async function () {
      const processor = unified()
        .use(parserPlugin)
        .use(
          /**
           * @type {Plugin<[], Node, Node>}
           */
          function () {
            return transformer

            /**
             * @param {Node} tree
             * @param {VFile} file
             * @param {TransformCallback<Node>} next
             */
            function transformer(tree, file, next) {
              file.message('from anonymous')
              next()
            }
          }
        )
        .use(compilerPlugin)
      const report = await processor.diagnose('alpha')

      assert.equal(report.ok, true)
      assert.deepEqual(
        report.messages.map(function (d) {
          return [d.phase, d.plugin, String(d.message.reason)]
        }),
        [
          ['parse', 'parserPlugin', 'from parse'],
          ['transform', undefined, 'from anonymous'],
          ['stringify', 'compilerPlugin', 'from stringify']
        ]
      )
    }
  )

  await t.test(
    'should support transformers returning errors',
    async function () {
      const processor = unified()
        .use(parserPlugin)
        .use(transformError)
        .use(compilerPlugin)
      const report = await processor.diagnose('alpha')

      assert.equal(report.ok, false)
      assert.equal(report.error && report.error.message, 'boom returned')
      assert.deepEqual(
        report.phases.map(function (d) {
          return d.phase
        }),
        ['parse', 'transform']
      )
    }
  )
})

// Fixtures.

/**
 * @type {Plugin<[], string, Node>}
 */
function parserPlugin() {
  this.parser = parser

  /**
   * @param {string} document
   * @param {VFile} file
   * @returns {Node}
   */
  function parser(document, file) {
    file.message('from parse')
    return /** @type {Literal} */ ({type: 'text', value: document})
  }
}

/**
 * @type {Plugin<[], string, Node>}
 */
function parserFailPlugin() {
  this.parser = parser

  /**
   * @returns {Node}
   */
  function parser() {
    throw new Error('boom parse')
  }
}

/**
 * @type {Plugin<[], Node, string>}
 */
function compilerPlugin() {
  this.compiler = compiler

  /**
   * @param {Node} tree
   * @param {VFile} file
   * @returns {string}
   */
  function compiler(tree, file) {
    file.message('from stringify')
    return 'value' in tree ? String(tree.value) : ''
  }
}

/**
 * @type {Plugin<[], Node, string>}
 */
function compilerFailPlugin() {
  this.compiler = compiler

  /**
   * @returns {string}
   */
  function compiler() {
    throw new Error('boom stringify')
  }
}

/**
 * @type {Plugin<[], Node, Node>}
 */
function transformOne() {
  return transformer

  /**
   * @param {Node} tree
   * @param {VFile} file
   */
  function transformer(tree, file) {
    file.message('from one')
  }
}

/**
 * @type {Plugin<[], Node, Node>}
 */
function transformTwo() {
  return transformer

  /**
   * @param {Node} tree
   * @param {VFile} file
   */
  function transformer(tree, file) {
    file.message('from two')
  }
}

/**
 * @type {Plugin<[], Node, Node>}
 */
function transformTwoFail() {
  return transformer

  /**
   * @param {Node} tree
   * @param {VFile} file
   */
  function transformer(tree, file) {
    file.message('from two')
    throw new Error('boom two')
  }
}

/**
 * @type {Plugin<[], Node, Node>}
 */
function transformError() {
  return transformer

  /**
   * @returns {Error}
   */
  function transformer() {
    return new Error('boom returned')
  }
}

/**
 * @type {Plugin<[], Node, Node>}
 */
function transformPath() {
  return transformer

  /**
   * @param {Node} tree
   * @param {VFile} file
   */
  async function transformer(tree, file) {
    await new Promise(function (resolve) {
      setTimeout(resolve, 1)
    })
    file.message('from ' + file.path)
  }
}

/**
 * @type {Plugin<[], Node, Node>}
 */
function transformReplace() {
  return transformer

  /**
   * @returns {Node}
   */
  function transformer() {
    return /** @type {Literal} */ ({type: 'text', value: 'replaced'})
  }
}
