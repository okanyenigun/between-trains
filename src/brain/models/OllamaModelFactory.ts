import { ChatOllama } from "@langchain/ollama";
import { Settings } from "../../config/Settings";

/**
 * Resolve which Ollama model to use: the explicitly configured model when set,
 * otherwise the first model actually installed on the server. This lets a blank
 * `ollama.model` setting "just work" whenever any model is pulled, without
 * hardcoding a name that may not exist. Returns "" when nothing can be resolved
 * (server unreachable or no models installed).
 */
export async function resolveOllamaModel(settings: Settings): Promise<string> {
  const configured = settings.ollamaModel; // already trimmed by the getter
  if (configured) {
    return configured;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(settings.ollamaBaseUrl.replace(/\/$/, "") + "/api/tags", {
      signal: controller.signal,
    });
    if (!res.ok) {
      return "";
    }
    const data = (await res.json()) as { models?: { name?: string }[] };
    return data.models?.find((m) => m.name)?.name ?? "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single place where LangChain chat models are created (skill doc §6). Reads the
 * globally-configured provider settings; today that is always Ollama. The model
 * is resolved via {@link resolveOllamaModel} so a blank setting auto-selects an
 * installed model.
 */
export async function createChatModel(settings: Settings): Promise<ChatOllama> {
  return new ChatOllama({
    baseUrl: settings.ollamaBaseUrl,
    model: await resolveOllamaModel(settings),
    temperature: 0.6,
  });
}
