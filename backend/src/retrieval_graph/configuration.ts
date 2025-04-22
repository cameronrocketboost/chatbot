import { Annotation } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
// import {
//   BaseConfigurationAnnotation,
//   ensureBaseConfiguration,
// } from '../shared/configuration.js'; // Removed base config import

/**
 * The configuration for the agent.
 * SIMPLIFIED VERSION
 */
export const AgentConfigurationAnnotation = Annotation.Root({
  // ...BaseConfigurationAnnotation.spec, // Removed base spec

  // models
  /**
   * The language model used for processing and refining queries.
   * Should be in the form: provider/model-name.
   */
  queryModel: Annotation<string>,
  // Added simplified versions of base config fields directly
  retrieverProvider: Annotation<'supabase'>, 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filterKwargs: Annotation<Record<string, any>>,
  k: Annotation<number>,
  // Memory setting
  messageHistoryLength: Annotation<number>, // Added message history length
});

/**
 * Create a typeof ConfigurationAnnotation.State instance from a RunnableConfig object.
 *
 * @param config - The configuration object to use.
 * @returns An instance of typeof ConfigurationAnnotation.State with the specified configuration.
 */
export function ensureAgentConfiguration(
  config: RunnableConfig,
): typeof AgentConfigurationAnnotation.State {
  const configurable = (config?.configurable || {}) as Partial<
    typeof AgentConfigurationAnnotation.State
  >;
  // const baseConfig = ensureBaseConfiguration(config); // Removed base config usage
  return {
    // ...baseConfig, // Removed base config spread
    queryModel: configurable.queryModel || 'openai/gpt-4o',
    // Added simplified defaults for base fields
    retrieverProvider: configurable.retrieverProvider || 'supabase',
    filterKwargs: configurable.filterKwargs || {},
    k: configurable.k || 5,
    messageHistoryLength: configurable.messageHistoryLength || 10, // Added default value (e.g., 10)
  };
}
