export interface AgentDefinition {
  name: string;
  role: string;
  systemPrompt: string;
  model: 'sonnet' | 'haiku';
  tools: string[];
  maxTokens: number;
  temperature: number;
}

export const AGENT_DEFINITIONS = {
  quantAnalyst: {
    name: 'Quant Analyst',
    role: 'Technical analysis and quantitative signal generation',
    systemPrompt: 'quant-analyst', // Loaded from dedicated prompt file
    model: 'sonnet' as const,
    tools: [
      'computeIndicators',
      'detectPatterns',
      'getSignalScore',
      'getCandles',
      'getOrderBook',
    ],
    maxTokens: 4096,
    temperature: 0.2,
  },

  sentimentAnalyst: {
    name: 'Sentiment Analyst',
    role: 'News and social media sentiment analysis',
    systemPrompt: 'sentiment-analyst', // Loaded from dedicated prompt file
    model: 'sonnet' as const,
    tools: [
      'getSentiment',
      'getCandles',
    ],
    maxTokens: 4096,
    temperature: 0.3,
  },

  macroAnalyst: {
    name: 'Macro Analyst',
    role: 'Macro economic condition evaluation',
    systemPrompt: 'macro-analyst', // Loaded from dedicated prompt file
    model: 'haiku' as const,
    tools: [
      'getMacroData',
      'getCandles',
    ],
    maxTokens: 2048,
    temperature: 0.2,
  },

  riskGuardian: {
    name: 'Risk Guardian',
    role: 'Portfolio risk management and trade approval',
    systemPrompt: 'risk-guardian', // Loaded from dedicated prompt file
    model: 'sonnet' as const,
    tools: [
      'checkRisk',
      'getPortfolioHeat',
      'calculatePositionSize',
      'getVaR',
      'getPositions',
    ],
    maxTokens: 4096,
    temperature: 0.1,
  },

  executionSpecialist: {
    name: 'Execution Specialist',
    role: 'Trade routing and order execution',
    systemPrompt: 'execution-specialist', // Loaded from dedicated prompt file
    model: 'sonnet' as const,
    tools: [
      'executeTrade',
      'cancelOrder',
      'getPositions',
      'closePosition',
      'getOrderBook',
    ],
    maxTokens: 4096,
    temperature: 0.1,
  },
} as const;

export type AgentName = keyof typeof AGENT_DEFINITIONS;
