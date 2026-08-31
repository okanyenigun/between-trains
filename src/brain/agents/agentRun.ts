import { OutputChannelLogger } from "../../logging/OutputChannelLogger";

/** A chat message passed to a LangChain agent. */
export type AgentMessage = { role: string; content: string };

/** The minimal surface of a LangChain agent that {@link runAgentWithBudget} uses. */
export interface BudgetedAgent {
  invoke(
    input: { messages: AgentMessage[] },
    options: { signal: AbortSignal; recursionLimit: number }
  ): Promise<unknown>;
}

export interface AgentBudgetOptions {
  agent: BudgetedAgent;
  messages: AgentMessage[];
  /** The caller's cancellation signal (user cancel), chained into the budget. */
  signal: AbortSignal;
  budgetMs: number;
  recursionLimit: number;
  /** Items saved so far — a zero-progress failure re-throws (so a fallback runs). */
  savedSoFar: () => number;
  logger: OutputChannelLogger;
  /** Human label for the early-stop log line, e.g. "Meme agent". */
  label: string;
}

/**
 * Run a tool-calling agent under a wall-clock budget and the caller's cancel
 * signal (chained into the budget), keeping partial progress. If the agent
 * throws after saving nothing the error propagates so a deterministic fallback
 * can take over; if it throws after some saves, that is an early stop, not a
 * failure.
 */
export async function runAgentWithBudget(options: AgentBudgetOptions): Promise<void> {
  const { agent, messages, signal, budgetMs, recursionLimit, savedSoFar, logger, label } = options;
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), budgetMs);
  const onOuterAbort = (): void => budget.abort();
  signal.addEventListener("abort", onOuterAbort, { once: true });
  try {
    await agent.invoke({ messages }, { signal: budget.signal, recursionLimit });
  } catch (error) {
    if (savedSoFar() === 0) {
      throw error;
    }
    logger.info(
      `${label} stopped early (${error instanceof Error ? error.message : "aborted"}) after ${savedSoFar()} saves`
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onOuterAbort);
  }
}
