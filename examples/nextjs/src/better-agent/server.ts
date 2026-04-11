import {
  betterAgent,
  createMemoryConversationRuntimeStateStore,
  createMemoryConversationStore,
  createMemoryStreamStore,
  defineAgent,
  defineTool,
} from "@better-agent/core";

import { createOpenAI } from "@better-agent/providers/openai";
import { createAnthropic } from "@better-agent/providers/anthropic";
import { createXAI } from "@better-agent/providers/xai";
import {
  rateLimitPlugin,
  sandboxPlugin,
  createE2BSandboxClient,
} from "@better-agent/plugins";

const openaiProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "your-openai-api-key",
});

const anthropicProvider = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "your-anthropic-api-key",
});

const xaiProvider = createXAI({
  apiKey: process.env.XAI_API_KEY ?? "your-xai-api-key",
});

const WEATHER_AGENT_INSTRUCTION = `
You are a helpful weather assistant that provides accurate weather information
and helps users plan activities based on the weather.

When responding:
- Ask for a location if none is provided.
- If the location name is not in English, translate it before calling the tool.
- If the user gives a location with multiple parts, use the most relevant city.
- Include relevant details like humidity, wind, and precipitation when available.
- Keep responses concise but informative.
- If the user asks for activities, suggest them based on the weather result.
- If the user asks for a specific output format, follow it.
`.trim();

const getWeather = defineTool({
  name: "get_weather",
  description: "Get current weather for a location using open-meteo and geocoding.",
  schema: {
    type: "object",
    properties: {
      location: {
        type: "string",
        minLength: 1,
        description: "City name, for example San Francisco or Beijing.",
      },
    },
    required: ["location"],
    additionalProperties: false,
  } as const,
}).server(async ({ location }) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const geocodingResponse = await fetch(geocodingUrl);
  const geocodingData = await geocodingResponse.json();
  if (!geocodingData.results?.[0]) {
    throw new Error(`Location '${location}' not found`);
  }
  const { latitude, longitude, name } = geocodingData.results[0];
  // Weather
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;
  const response = await fetch(weatherUrl);
  const data = await response.json();
  const current = data.current;
  return {
    temperature: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    windGust: current.wind_gusts_10m,
    conditions: getWeatherCondition(current.weather_code),
    location: name,
  };
});

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return conditions[code] || 'Unknown';
}

const openai = defineAgent({
  name: "openai",
  model: openaiProvider.model("gpt-5.4"),
  instruction: WEATHER_AGENT_INSTRUCTION,
  tools: [getWeather],
});

const anthropic = defineAgent({
  name: "anthropic",
  model: anthropicProvider.text("claude-sonnet-4-6"),
  instruction: WEATHER_AGENT_INSTRUCTION,
  tools: [getWeather],
});

const xai = defineAgent({
  name: "xai",
  model: xaiProvider.text("grok-4"),
  instruction: WEATHER_AGENT_INSTRUCTION,
  tools: [getWeather],
});

const app = betterAgent({
  agents: [openai, anthropic, xai],
  plugins: [
    rateLimitPlugin({
      windowMs: 60_000,
      max: 30,
    }),
    sandboxPlugin({
      client: createE2BSandboxClient({
        apiKey: process.env.E2B_API_KEY,
      }),
    }),
  ],
  persistence: {
    stream: createMemoryStreamStore(),
    conversations: createMemoryConversationStore(),
    runtimeState: createMemoryConversationRuntimeStateStore(),
  },
  advanced: {
    onRequestDisconnect: "continue",
  },
  baseURL: "/agents",
  secret: process.env.BETTER_AGENT_SECRET ?? "your-secret-here",
});

export default app;
