/**
 * @import {Plugin} from 'unified'
 */

import isPlainObj from 'is-plain-obj'

/**
 * @typedef {Object} Plan
 *   Explicit before/after dependencies of a plugin.
 * @property {Array<Plugin>} [before]
 *   Plugins that must run *after* this one.
 * @property {Array<Plugin>} [after]
 *   Plugins that must run *before* this one.
 */

/**
 * @typedef {Object} PlannedAttacher
 *   A single attacher entry in a frozen plan.
 * @property {Plugin} plugin
 *   The plugin function.
 * @property {Array<unknown>} options
 *   Options to pass to the plugin.
 * @property {boolean} disabled
 *   Whether the plugin was turned off with `false`.
 */

/**
 * Get the explicit plan of a plugin.
 *
 * A plan can be declared with a `plan` object (`{before, after}`) or directly
 * with `before` and `after` arrays on the plugin function.
 *
 * @param {Plugin} plugin
 *   Plugin to inspect.
 * @returns {Required<Plan>}
 *   The plan, with empty arrays when absent.
 */
export function planOf(plugin) {
  const target = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (plugin)
  )
  const plan = target.plan

  if (plan && typeof plan === 'object') {
    const value = /** @type {Record<string, unknown>} */ (plan)
    return {
      before: list(value.before),
      after: list(value.after)
    }
  }

  return {
    before: list(target.before),
    after: list(target.after)
  }

  /**
   * @param {unknown} value
   * @returns {Array<Plugin>}
   */
  function list(value) {
    return Array.isArray(value) ? /** @type {Array<Plugin>} */ (value) : []
  }
}

/**
 * Get a human readable name for a plugin, for error messages.
 *
 * @param {Plugin} plugin
 *   Plugin to name.
 * @returns {string}
 *   Name.
 */
export function nameOf(plugin) {
  const value = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (plugin)
  )
  return (typeof value.name === 'string' && value.name) || 'anonymous'
}

/**
 * Build a stable plan from a list of attachers.
 *
 * The plan is a topological sort of the plugins based on their explicit
 * `before` and `after` dependencies.
 * Plugins without dependencies keep their original `use` order.
 *
 * Throws when a dependency references a plugin that is not registered, or when
 * dependencies form a cycle.
 *
 * @param {Array<[Plugin, ...Array<unknown>]>} attachers
 *   Raw attachers as collected by `use`.
 * @returns {Array<PlannedAttacher>}
 *   Planned attachers in execution order.
 */
export function buildPlan(attachers) {
  /** @type {Array<PlannedAttacher>} */
  const entries = []
  /** @type {Map<Plugin, number>} */
  const position = new Map()

  for (const attacher of attachers) {
    const [plugin, ...rest] = attacher
    const disabled = rest.length > 0 && rest[0] === false

    if (position.has(plugin)) {
      // Reconfiguration: only the `false` toggle matters here.
      // Options are merged in `use` already.
      if (disabled) {
        const index = position.get(plugin)
        if (index !== undefined) {
          entries[index].disabled = true
        }
      }

      continue
    }

    position.set(plugin, entries.length)
    entries.push({plugin, options: rest, disabled})
  }

  // Build the dependency graph.
  // `edges` maps a plugin to the plugins that must come *after* it.
  /** @type {Map<Plugin, Set<Plugin>>} */
  const edges = new Map()
  /** @type {Map<Plugin, number>} */
  const indegree = new Map()

  for (const entry of entries) {
    edges.set(entry.plugin, new Set())
    indegree.set(entry.plugin, 0)
  }

  for (const entry of entries) {
    const plan = planOf(entry.plugin)

    for (const target of plan.before) {
      assertRegistered(entry.plugin, target, 'before')
      addEdge(entry.plugin, target)
    }

    for (const target of plan.after) {
      assertRegistered(entry.plugin, target, 'after')
      addEdge(target, entry.plugin)
    }
  }

  // Stable topological sort (Kahn’s algorithm).
  /** @type {Array<Plugin>} */
  const ready = []

  for (const entry of entries) {
    if (indegree.get(entry.plugin) === 0) {
      ready.push(entry.plugin)
    }
  }

  /** @type {Array<Plugin>} */
  const order = []

  while (ready.length > 0) {
    // Pick the ready plugin with the smallest original index, so that
    // plugins without dependencies keep their `use` order.
    let selected = ready[0]
    let selectedIndex = /** @type {number} */ (position.get(selected))

    for (let i = 1; i < ready.length; i++) {
      const candidate = ready[i]
      const candidateIndex = /** @type {number} */ (position.get(candidate))
      if (candidateIndex < selectedIndex) {
        selected = candidate
        selectedIndex = candidateIndex
      }
    }

    ready.splice(ready.indexOf(selected), 1)
    order.push(selected)

    const dependents = edges.get(selected)
    if (dependents) {
      for (const dependent of dependents) {
        const value = /** @type {number} */ (indegree.get(dependent)) - 1
        indegree.set(dependent, value)
        if (value === 0) {
          ready.push(dependent)
        }
      }
    }
  }

  if (order.length !== entries.length) {
    const stuck = entries
      .filter(function (entry) {
        return !order.includes(entry.plugin)
      })
      .map(function (entry) {
        return '`' + nameOf(entry.plugin) + '`'
      })
      .join(', ')
    throw new Error('Cycle detected in plugin dependencies among: ' + stuck)
  }

  return order.map(function (plugin) {
    return entries[/** @type {number} */ (position.get(plugin))]
  })

  /**
   * @param {Plugin} from
   * @param {Plugin} to
   * @returns {undefined}
   */
  function addEdge(from, to) {
    const fromEdges = edges.get(from)
    const toIndegree = indegree.get(to)
    if (fromEdges && toIndegree !== undefined && !fromEdges.has(to)) {
      fromEdges.add(to)
      indegree.set(to, toIndegree + 1)
    }
  }

  /**
   * @param {Plugin} owner
   * @param {Plugin} target
   * @param {'after' | 'before'} kind
   * @returns {undefined}
   */
  function assertRegistered(owner, target, kind) {
    if (!position.has(target)) {
      throw new Error(
        'Missing dependency: plugin `' +
          nameOf(owner) +
          '` declares `' +
          kind +
          '` dependency on `' +
          nameOf(target) +
          '`, which is not registered'
      )
    }
  }
}

/**
 * Deeply clone a value so that later mutations to the original do not affect
 * the frozen configuration.
 *
 * Plain objects and arrays are cloned recursively; other values are kept as is.
 *
 * @param {unknown} value
 *   Value to clone.
 * @returns {unknown}
 *   Cloned value.
 */
export function clone(value) {
  if (Array.isArray(value)) {
    return /** @type {Array<unknown>} */ (value).map(function (item) {
      return cloneValue(item)
    })
  }

  if (isPlainObj(value)) {
    /** @type {Record<string, unknown>} */
    const result = {}
    for (const key of Object.keys(value)) {
      result[key] = cloneValue(value[key])
    }

    return result
  }

  return value

  /**
   * @param {unknown} value
   * @returns {unknown}
   */
  function cloneValue(value) {
    return clone(value)
  }
}
