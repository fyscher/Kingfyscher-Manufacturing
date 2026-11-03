// Minimal min-cost flow (successive shortest paths with Bellman-Ford queue).
// Costs are integers so there is no floating-point drift. Small graphs only:
// one player's properties and the collections being filled.

function createGraph(nodeCount) {
  const edges = []; // [to, cap, cost, rev] flattened as objects
  const adj = Array.from({ length: nodeCount }, () => []);
  return {
    adj,
    edges,
    addEdge(from, to, cap, cost) {
      adj[from].push(edges.length);
      edges.push({ to, cap, cost, flow: 0 });
      adj[to].push(edges.length);
      edges.push({ to: from, cap: 0, cost: -cost, flow: 0 });
      return edges.length - 2;
    },
  };
}

/**
 * Push up to `want` units from s to t at minimum total cost. With
 * `onlyProfitable`, stop as soon as another unit would not lower the cost
 * (max-weight flow rather than max flow).
 * Returns { flow, cost }. Edge flows are left on the graph for reading back.
 */
function minCostFlow(graph, s, t, want = Infinity, { onlyProfitable = false } = {}) {
  const { adj, edges } = graph;
  const n = adj.length;
  let flow = 0;
  let cost = 0;
  while (flow < want) {
    const dist = new Array(n).fill(Infinity);
    const inQueue = new Array(n).fill(false);
    const prevEdge = new Array(n).fill(-1);
    dist[s] = 0;
    const queue = [s];
    inQueue[s] = true;
    while (queue.length) {
      const u = queue.shift();
      inQueue[u] = false;
      for (const id of adj[u]) {
        const e = edges[id];
        if (e.cap - e.flow > 0 && dist[u] + e.cost < dist[e.to]) {
          dist[e.to] = dist[u] + e.cost;
          prevEdge[e.to] = id;
          if (!inQueue[e.to]) {
            inQueue[e.to] = true;
            queue.push(e.to);
          }
        }
      }
    }
    if (dist[t] === Infinity || (onlyProfitable && dist[t] >= 0)) break;
    // Every edge we create has unit or slot capacity, so push one unit at a time.
    let v = t;
    while (v !== s) {
      const id = prevEdge[v];
      edges[id].flow += 1;
      edges[id ^ 1].flow -= 1;
      v = edges[id ^ 1].to;
    }
    flow += 1;
    cost += dist[t];
  }
  return { flow, cost };
}

module.exports = { createGraph, minCostFlow };
