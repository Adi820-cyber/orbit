import type { ActionFunctionArgs } from "react-router";
import type { ChatbotResponse } from "@orbit/contracts";
import type { AskActionData } from "../ask/route";
import { mutate, type MutationFailure, type WorkspaceEnvironment } from "../workspace/environment";

/** An Ask evidence card, when the assistant answered from the KPI catalogue instead. */
export type AskAnswered = Extract<AskActionData, { ok: true }>;

export type ChatbotActionData =
  | { ok: true; value: ChatbotResponse }
  | { ok: true; ask: AskAnswered }
  | MutationFailure
  | { ok: false; code: "incomplete"; message: string };

/*
 * A question typed into the Orbit Assistant.
 *
 * 1. The knowledge search (POST /api/chatbot) answers first: hospital datasets,
 *    KPI readings and definitions, exceptions and operations, filtered by the
 *    caller's role and scope in the database.
 * 2. Only when it finds nothing this role may read is the same question put to
 *    Ask (POST /api/ask/question), which maps it onto the caller's own KPI menu.
 *    Its evidence card is shown when it answered, or when it says the question
 *    is outside the caller's scope (an explicit result, never narrowed).
 * 3. Otherwise the knowledge search's own "nothing available to your role"
 *    answer is shown. Both calls are authorized on the server; nothing here
 *    widens what a role can see.
 */
export function chatbotAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<ChatbotActionData> => {
    const form = await request.formData();
    const message = form.get("message");
    if (typeof message !== "string" || message.trim().length < 3) {
      return { ok: false, code: "incomplete", message: "Type a question of at least a few words." };
    }
    const question = message.trim();
    const result = await mutate(environment, request, (client) => client.chatbot(question));
    if (!result.ok || result.value.coverage !== "no_sources") return result.ok ? { ok: true, value: result.value } : result;

    const asked = await mutate(environment, request, (client) => client.askQuestion(question));
    if (asked.ok && (asked.value.response.outcome === "answered" || asked.value.response.outcome === "out_of_scope")) {
      return {
        ok: true,
        ask: {
          ok: true,
          request: asked.value.interpretedAs?.request ?? null,
          understoodAs: asked.value.interpretedAs?.label ?? null,
          response: asked.value.response,
        },
      };
    }
    return { ok: true, value: result.value };
  };
}
