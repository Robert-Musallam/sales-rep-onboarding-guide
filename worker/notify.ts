import { getSetting } from "./db";
import * as graph from "./connectors/graph";

/**
 * "Needs you" messages to Robert in Teams (decided 2026-11-16: the alerts.log and
 * Mac notifications alone were not seen). Sent from admin_upn's delegated session to
 * app_settings.agent_notify_upn (default robert@investgcv.com). Never throws: returns
 * what happened so the caller can log it.
 */
export async function notifyRobert(text: string): Promise<string> {
  const to = (((await getSetting<string>("agent_notify_upn")) ?? "") || "robert@investgcv.com").trim();
  const from = ((await getSetting<string>("admin_upn")) ?? "").trim();
  if (!from) return "no admin_upn configured";
  try {
    const chatId = await graph.createOneOnOneChat(from, to);
    await graph.sendChatMessage(chatId, text);
    return `Teams message sent to ${to}`;
  } catch (e) {
    return `Teams message to ${to} failed: ${String((e as Error).message ?? e).slice(0, 160)}`;
  }
}
