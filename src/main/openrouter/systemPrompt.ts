import { buildAgentToolGuide } from '../config/agentInstructions'

/**
 * The system prompt for OpenRouter chat mode's in-app agent, built fresh for
 * every turn (see `agentRunner.ts`) rather than cached, since it carries
 * today's date and the model actually driving the turn.
 *
 * The CLI terminal mode gets its own framing (`agentInstructions.ts`'s
 * `CLAUDE.md`/`AGENTS.md`) because a terminal agent is a general-purpose
 * coding tool that happens to have Applyer's MCP server attached; this chat
 * agent has no such generality to caveat away. It has no filesystem, no
 * shell, and no other MCP servers, and it is talking directly to the user
 * in a panel next to their job board rather than narrating a session someone
 * is watching scroll by. So this head says what the CLI framing does not
 * need to: that the tools are the *only* way it can act, that it should
 * write like a chat reply rather than a terminal transcript, and that it
 * must never claim to have submitted an application (`fill_application`
 * and `click_application_button` are deliberately incapable of that; a
 * confident-sounding lie here would be worse than the tool limitation
 * itself). The tool-by-tool guide is shared verbatim with the CLI
 * (`buildAgentToolGuide`) so the two framings can never drift apart on what
 * a given tool actually does.
 */

export interface BuildChatSystemPromptOptions {
  /** Whether the Typical flow's tool guide tells the agent to tailor a resume after every queue_job. */
  autoTailor: boolean
  /** The OpenRouter model id driving this turn, so the model knows what it is running as. */
  modelId: string
  /** Defaults to the real current time; overridable so tests get a fixed date. */
  now?: Date
}

function formatToday(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function buildChatSystemPrompt(options: BuildChatSystemPromptOptions): string {
  const today = formatToday(options.now ?? new Date())
  const head = `You are Applyer's job-search agent, running inside the Applyer desktop app as \`${options.modelId}\` via OpenRouter.

The tools below are the only way you can act: no filesystem, no shell, no other tools. Anything else you can only talk through. The user reads you in a chat panel beside their job board, so reply like a chat: concise, markdown for structure, code spans for ids and field names, no play-by-play of every tool call.

Never claim or imply you submitted, applied to, or finished an application: nothing in your toolset submits a form, the user reviews and submits every one. Say what you did (filled fields, reached the review step, saved a variant). Ask before anything hard to undo: excluding a job, deleting a variant, or a destructive answer. Queueing, saving a variant and inspecting a form are safe to just do.

Today's date is ${today}.

`
  return head + buildAgentToolGuide({ autoTailor: options.autoTailor })
}
