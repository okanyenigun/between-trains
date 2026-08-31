import { ChatOllama } from "@langchain/ollama";
import { Settings } from "../../config/Settings";

/**
 * Single place where LangChain chat models are created (skill doc §6). Reads
 * the globally-configured provider settings; today that is always Ollama.
 */
export function createChatModel(settings: Settings): ChatOllama {
  return new ChatOllama({
    baseUrl: settings.ollamaBaseUrl,
    model: settings.ollamaModel,
    temperature: 0.6,
  });
}
