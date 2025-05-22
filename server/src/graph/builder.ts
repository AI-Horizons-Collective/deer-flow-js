// Build and return the base state graph with all nodes and edges.
import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph'
import { State } from './types'
import {
  background_investigation_node,
  coordinator_node,
  human_feedback_node,
  planner_node,
  reporter_node,
  research_team_node,
  researcher_node,
} from './nodes'

const _build_base_graph = () => {
  return new StateGraph(State)
    .addNode('coordinator', coordinator_node, {
      ends: [END, 'background_investigator', 'planner'],
    })
    .addNode('background_investigator', background_investigation_node, {
      ends: ['planner'],
    })
    .addNode('planner', planner_node, {
      ends: [END, 'reporter', 'planner', 'human_feedback'],
    })
    .addNode('reporter', reporter_node)
    .addNode('research_team', research_team_node, {
      ends: ['planner', 'researcher'],
    })
    .addNode('researcher', researcher_node, {
      ends: ['research_team'],
    })
    .addNode('human_feedback', human_feedback_node, {
      ends: [END, 'planner', 'reporter'],
    })
    .addEdge(START, 'coordinator')
    .addEdge('reporter', END)
}

/**
 * Build and return the agent workflow graph with memory.
 *
 * @returns Compiled workflow graph with persistent memory
 */
export const build_graph_with_memory = () => {
  // use persistent memory to save conversation history
  // TODO: be compatible with SQLite / PostgreSQL
  const memory = new MemorySaver()

  // build state graph
  const builder = _build_base_graph()
  return builder.compile({ checkpointer: memory })
}
