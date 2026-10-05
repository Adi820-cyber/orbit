import type { ActionFunctionArgs } from "react-router";
import type { ChatbotResponse } from "@orbit/contracts";
import { mutate, type MutationFailure, type WorkspaceEnvironment } from "../workspace/environment";

export type ChatbotActionData =
  | { ok: true; value: ChatbotResponse }
  | MutationFailure
  | { ok: false; code: "incomplete"; message: string };

export function chatbotAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<ChatbotActionData> => {
    const form = await request.formData();
    const message = form.get("message");
    if (typeof message !== "string" || message.trim().length < 3) {
      return { ok: false, code: "incomplete", message: "Please provide a valid question." };
    }
    const result = await mutate(environment, request, (client) => client.chatbot(message.trim()));
    if (!result.ok) return result;
    return { ok: true, value: result.value };
  };
}
