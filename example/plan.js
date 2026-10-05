import {unified} from 'unified'

// A small example of explicit plugin planning.
//
// Plugins declare their dependencies with `before` and `after` arrays.
// The processor builds a stable topological plan when frozen, so execution
// order no longer depends on the order in which `use` was called.

function alpha() {
  return function (/** @type {import('unist').Node} */ tree) {
    console.log('alpha: handles the tree first')
    return tree
  }
}

function beta() {
  return function (/** @type {import('unist').Node} */ tree) {
    console.log('beta: runs after alpha')
    return tree
  }
}

function gamma() {
  return function (/** @type {import('unist').Node} */ tree) {
    console.log('gamma: runs last')
    return tree
  }
}

// Declare explicit dependencies.
// Alpha must run before beta and gamma.
// Beta must run before gamma.
alpha.before = [beta, gamma]
beta.before = [gamma]

// Register in reverse order.
// Without a plan, this would execute gamma, beta, alpha.
// With a plan, it executes alpha, beta, gamma.
const processor = unified()
processor.use(gamma)
processor.use(beta)
processor.use(alpha)

const tree = await processor.run({type: 'root'})

console.log('done:', tree.type)
