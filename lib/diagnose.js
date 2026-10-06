/**
 * @import {Compiler, CompileResults, Parser, Processor, TransformCallback, Transformer} from './index.js'
 * @import {Node} from 'unist'
 * @import {Compatible, Value} from 'vfile'
 */

/**
 * @typedef {import('vfile').VFile['messages'][number]} VFileMessage
 *   Message associated with a file.
 */

/**
 * @typedef {'parse' | 'transform' | 'stringify'} DiagnosticPhaseName
 *   Name of a phase in a diagnostic session.
 */

/**
 * @typedef {'ok' | 'failed' | 'skipped'} DiagnosticStatus
 *   Status of one phase in a diagnostic session.
 *
 *   *   `'ok'` — the phase ran to completion
 *   *   `'failed'` — the phase raised a fatal error, ending the session
 *   *   `'skipped'` — the phase was never started, because an earlier phase
 *       failed
 */

/**
 * @typedef DiagnosticMessage
 *   A message collected during a diagnostic session, attributed to the phase
 *   and plugin that created it.
 * @property {VFileMessage} message
 *   The message itself (also present on `file.messages`).
 * @property {DiagnosticPhaseName | undefined} phase
 *   Phase that created the message; `undefined` when the message was already
 *   on the file before the session started.
 * @property {string | undefined} plugin
 *   Name of the plugin that created the message; `undefined` when the
 *   message was already on the file or the plugin is anonymous.
 */

/**
 * @typedef DiagnosticPhase
 *   Diagnostics of one unit of work (parse, one transform, or stringify).
 * @property {DiagnosticPhaseName} phase
 *   Name of the phase.
 * @property {string | undefined} plugin
 *   Name of the plugin responsible for this unit; `undefined` for anonymous
 *   plugins.
 * @property {DiagnosticStatus} status
 *   Whether this unit finished, failed, or never started.
 * @property {Array<VFileMessage>} messages
 *   Messages created by this unit, in order.
 */

/**
 * @typedef DiagnosticReport
 *   Result of an explicit diagnostic session.
 * @property {boolean} complete
 *   Whether all phases (parse, every transform, and stringify) ran to
 *   completion.
 * @property {boolean} ok
 *   Whether the session completed without a fatal error.
 *
 *   A successful session without messages is still `ok`: an empty success
 *   is not a failure.
 * @property {Error | undefined} error
 *   Fatal error that ended the session, if any.
 * @property {DiagnosticPhaseName | undefined} failedPhase
 *   Phase that raised `error`, if any.
 * @property {string | undefined} failedPlugin
 *   Plugin that raised `error`, if any.
 * @property {VFile} file
 *   The file that was processed; messages are preserved on `file.messages`.
 * @property {Array<DiagnosticMessage>} messages
 *   Every message, attributed to a phase and plugin, in order of creation.
 *   Messages that were already on the file are included once, with `phase`
 *   and `plugin` set to `undefined`.
 * @property {Array<DiagnosticPhase>} phases
 *   One entry for parse, one per transform, and one for stringify, in
 *   pipeline order.
 */

import {ok as assert} from 'devlop'
import {trough, wrap} from 'trough'
import {VFile} from 'vfile'

/**
 * Run an explicit diagnostic session on `processor` with `file`.
 *
 * The session performs the parse, transform, and stringify phases exactly
 * once and resolves with a report; it never rejects for pipeline errors and
 * never re-runs the pipeline to build the report.
 *
 * All session state is local to this call, so concurrent sessions on the
 * same processor never mix file sources.
 *
 * @template {Node | undefined} [ParseTree=undefined]
 *   Output of `parse` (optional).
 * @template {Node | undefined} [HeadTree=undefined]
 *   Input for `run` (optional).
 * @template {Node | undefined} [TailTree=undefined]
 *   Output for `run` (optional).
 * @template {Node | undefined} [CompileTree=undefined]
 *   Input of `stringify` (optional).
 * @template {CompileResults | undefined} [CompileResult=undefined]
 *   Output of `stringify` (optional).
 * @param {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>} processor
 *   Processor to run.
 * @param {Compatible | undefined} [file]
 *   File to process (optional); typically `string` or `VFile`; any value
 *   accepted as `x` in `new VFile(x)`.
 * @returns {Promise<DiagnosticReport>}
 *   Promise resolving to a diagnostic report.
 */
export function diagnose(processor, file) {
  processor.freeze()

  const parser = processor.parser || processor.Parser
  const compiler = processor.compiler || processor.Compiler

  assertParser('diagnose', parser)
  assertCompiler('diagnose', compiler)

  // Aliases narrowed by the assertions above, for use in closures.
  const realParser = parser
  const realCompiler = compiler

  const realFile = vfile(file)

  const parserPlugin =
    processor.parserPlugins.get(/** @type {Parser<Node>} */ (realParser)) ||
    realParser.name ||
    undefined
  const compilerPlugin =
    processor.compilerPlugins.get(
      /** @type {Compiler<Node, CompileResults>} */ (realCompiler)
    ) ||
    realCompiler.name ||
    undefined

  /** @type {DiagnosticPhase} */
  const parsePhase = {
    messages: [],
    phase: 'parse',
    plugin: parserPlugin,
    status: 'skipped'
  }
  /** @type {Array<DiagnosticPhase>} */
  const transformPhases = processor.transformerPlugins.map(function (info) {
    return {
      messages: [],
      phase: 'transform',
      plugin: info.plugin,
      status: 'skipped'
    }
  })
  /** @type {DiagnosticPhase} */
  const stringifyPhase = {
    messages: [],
    phase: 'stringify',
    plugin: compilerPlugin,
    status: 'skipped'
  }

  /** @type {DiagnosticReport} */
  const report = {
    complete: false,
    error: undefined,
    failedPhase: undefined,
    failedPlugin: undefined,
    file: realFile,
    messages: [],
    ok: false,
    phases: [parsePhase, ...transformPhases, stringifyPhase]
  }

  // Session-local state: each `diagnose` call tracks its own file and
  // cursor, so concurrent sessions on the same processor stay isolated.
  let currentFile = realFile
  let cursor = 0
  /** @type {Set<VFileMessage>} */
  const collected = new Set()

  // Keep messages that were already on the file: attribute them to no phase
  // and no plugin, and never collect them again.
  for (const message of currentFile.messages) {
    collected.add(message)
    report.messages.push({message, phase: undefined, plugin: undefined})
  }

  cursor = currentFile.messages.length

  return new Promise(executor)

  /**
   * @param {(report: DiagnosticReport) => undefined | void} resolve
   *   Resolve the session promise.
   * @returns {undefined}
   *   Nothing.
   */
  function executor(resolve) {
    // Parse phase (synchronous).
    /** @type {Node} */
    let tree

    try {
      tree = /** @type {Node} */ (realParser(String(realFile), realFile))
      parsePhase.status = 'ok'
    } catch (error) {
      parsePhase.status = 'failed'
      collect(parsePhase)
      resolve(fail(report, parsePhase, /** @type {Error} */ (error)))
      return
    }

    collect(parsePhase)

    // Transform phase: one instrumented middleware per transformer, built
    // for this session only, so plugin identity is known per message.
    const pipeline = trough()
    let index = -1

    while (++index < processor.transformerPlugins.length) {
      const info = processor.transformerPlugins[index]
      const phase = transformPhases[index]

      pipeline.use(
        /**
         * @param {Node} inputTree
         *   Tree to handle.
         * @param {VFile} inputFile
         *   File to handle.
         * @param {TransformCallback} next
         *   Callback.
         * @returns {undefined}
         *   Nothing.
         */
        function (inputTree, inputFile, next) {
          // `wrap` from `trough` reproduces the exact middleware semantics
          // (sync, promise, callback, and `Error` results) of a normal run.
          wrap(
            /** @type {(...input: Array<any>) => any} */ (info.transformer),
            /**
             * @param {Error | null | undefined} error
             *   Fatal error, if the transform failed.
             * @param {Array<unknown>} output
             *   Output values (tree and file).
             * @returns {undefined}
             *   Nothing.
             */
            function (error, ...output) {
              collect(phase)
              phase.status = error ? 'failed' : 'ok'

              // A transformer can replace the file: follow it so later
              // messages are still attributed to the right file.
              const replacement = /** @type {Compatible | undefined} */ (
                output[1]
              )

              if (
                replacement &&
                replacement !== currentFile &&
                looksLikeAVFile(replacement)
              ) {
                currentFile = replacement
                cursor = 0
                collect(phase)
              }

              next(
                error || undefined,
                /** @type {Node | undefined} */ (output[0]),
                /** @type {VFile | undefined} */ (output[1])
              )
            }
          )(inputTree, inputFile)

          return undefined
        }
      )
    }

    pipeline.run(
      tree,
      currentFile,
      /**
       * @param {Error | null | undefined} error
       *   Fatal error, if a transform failed.
       * @param {Node} [outputTree]
       *   Transformed tree.
       * @returns {undefined}
       *   Nothing.
       */
      function (error, outputTree) {
        if (error) {
          const failedPhase = transformPhases.find(function (phase) {
            return phase.status === 'failed'
          })
          assert(failedPhase, 'expected a failed transform phase')
          resolve(fail(report, failedPhase, error))
          return
        }

        const finalTree = outputTree || tree

        // Stringify phase (synchronous).
        /** @type {CompileResults} */
        let compileResult

        try {
          compileResult = realCompiler(
            /** @type {CompileTree extends undefined ? Node : CompileTree} */ (
              /** @type {unknown} */ (finalTree)
            ),
            currentFile
          )
          stringifyPhase.status = 'ok'
        } catch (stringifyError) {
          stringifyPhase.status = 'failed'
          collect(stringifyPhase)
          resolve(
            fail(report, stringifyPhase, /** @type {Error} */ (stringifyError))
          )
          return
        }

        collect(stringifyPhase)

        if (looksLikeAValue(compileResult)) {
          currentFile.value = compileResult
        } else {
          currentFile.result = compileResult
        }

        report.complete = true
        report.file = currentFile
        report.ok = true
        resolve(report)
      }
    )
  }

  /**
   * Attribute messages added since the previous unit to `phase`.
   *
   * Each message on the file is collected exactly once, so messages are
   * never duplicated in the report.
   *
   * @param {DiagnosticPhase} phase
   *   Phase to attribute new messages to.
   * @returns {undefined}
   *   Nothing.
   */
  function collect(phase) {
    while (cursor < currentFile.messages.length) {
      const message = currentFile.messages[cursor++]

      // Never collect the same message twice.
      if (collected.has(message)) continue

      collected.add(message)
      phase.messages.push(message)
      report.messages.push({
        message,
        phase: phase.phase,
        plugin: phase.plugin
      })
    }
  }
}

/**
 * Mark a report as failed in `phase` and return it.
 *
 * Diagnostics completed so far are kept; the report stays marked as not
 * complete.
 *
 * @param {DiagnosticReport} report
 *   Report to mark.
 * @param {DiagnosticPhase} phase
 *   Phase that failed.
 * @param {Error} error
 *   Fatal error.
 * @returns {DiagnosticReport}
 *   The given `report`.
 */
function fail(report, phase, error) {
  report.error = error
  report.failedPhase = phase.phase
  report.failedPlugin = phase.plugin
  return report
}

/**
 * Assert a parser is available.
 *
 * @param {string} name
 *   Name of the method that requires a parser.
 * @param {unknown} value
 *   Value to check.
 * @returns {asserts value is Parser<Node>}
 *   Nothing.
 */
function assertParser(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError('Cannot `' + name + '` without `parser`')
  }
}

/**
 * Assert a compiler is available.
 *
 * @param {string} name
 *   Name of the method that requires a compiler.
 * @param {unknown} value
 *   Value to check.
 * @returns {asserts value is Compiler<Node, CompileResults>}
 *   Nothing.
 */
function assertCompiler(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError('Cannot `' + name + '` without `compiler`')
  }
}

/**
 * @param {Compatible | undefined} [value]
 *   Value to turn into a file.
 * @returns {VFile}
 *   A file.
 */
function vfile(value) {
  return looksLikeAVFile(value) ? value : new VFile(value)
}

/**
 * @param {Compatible | undefined} [value]
 *   Value to check.
 * @returns {value is VFile}
 *   Whether `value` is a `VFile`.
 */
function looksLikeAVFile(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'message' in value &&
    'messages' in value
  )
}

/**
 * @param {unknown} [value]
 *   Value to check.
 * @returns {value is Value}
 *   Whether `value` is a `Value`.
 */
function looksLikeAValue(value) {
  return typeof value === 'string' || isUint8Array(value)
}

/**
 * Assert `value` is an `Uint8Array`.
 *
 * @param {unknown} value
 *   Value to check.
 * @returns {value is Uint8Array}
 *   Whether `value` is an `Uint8Array`.
 */
function isUint8Array(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'byteLength' in value &&
    'byteOffset' in value
  )
}
