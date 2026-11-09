import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Config } from '../models/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Tagger');

function getHttpAgent(): HttpsProxyAgent<string> | undefined {
  const proxy =
    process.env['https_proxy'] ??
    process.env['HTTPS_PROXY'] ??
    process.env['http_proxy'] ??
    process.env['HTTP_PROXY'];
  return proxy ? new HttpsProxyAgent(proxy) : undefined;
}

export interface TaggerService {
  generateTags(content: string, existingTags?: string[]): Promise<string[]>;
  isEnabled(): boolean;
}

class OpenAITagger implements TaggerService {
  private client: OpenAI;
  private enabled: boolean;

  constructor(config: Config) {
    this.enabled = !!config.openaiApiKey && config.autoTaggingEnabled;

    if (this.enabled) {
      this.client = new OpenAI({ apiKey: config.openaiApiKey, httpAgent: getHttpAgent() });
      logger.info('Auto-tagging enabled with OpenAI');
    } else {
      this.client = null as unknown as OpenAI;
      logger.info('Auto-tagging disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async generateTags(content: string, existingTags: string[] = []): Promise<string[]> {
    if (!this.enabled) {
      return existingTags;
    }

    try {
      const truncated = content.slice(0, 2000);

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a tagging assistant. Generate 3-5 relevant tags for the given content.
Rules:
- Tags should be lowercase, single words or hyphenated
- Focus on: programming language, framework, concept, pattern, tool
- Don't repeat existing tags
- Return ONLY a JSON array of strings, nothing else

Example output: ["swift", "api", "authentication", "jwt"]`,
          },
          {
            role: 'user',
            content: `Content:\n${truncated}\n\nExisting tags: ${existingTags.join(', ') || 'none'}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 100,
      });

      const text = response.choices[0]?.message?.content?.trim() || '[]';

      // Parse JSON array
      const match = text.match(/\[.*\]/s);
      if (match) {
        const parsed = JSON.parse(match[0]) as string[];
        const newTags = parsed
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.toLowerCase().trim())
          .filter((t) => t.length > 1 && t.length < 30)
          .filter((t) => !existingTags.includes(t));

        logger.debug(`Generated tags: ${newTags.join(', ')}`);
        return [...existingTags, ...newTags];
      }

      return existingTags;
    } catch (error) {
      logger.error('Failed to generate tags', error);
      return existingTags;
    }
  }
}

class DisabledTagger implements TaggerService {
  isEnabled(): boolean {
    return false;
  }

  async generateTags(_content: string, existingTags: string[] = []): Promise<string[]> {
    return existingTags;
  }
}

export function createTagger(config: Config): TaggerService {
  if (config.autoTaggingEnabled && config.openaiApiKey) {
    return new OpenAITagger(config);
  }
  return new DisabledTagger();
}
