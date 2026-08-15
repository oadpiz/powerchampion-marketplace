export const MODEL_USAGE = [
  { model: 'GLM 5.2', percent: 72, tokens: '14.2M' },
  { model: 'Qwen3-VL', percent: 18, tokens: '3.5M' },
  { model: 'Flux', percent: 6, tokens: '1.2M' },
  { model: 'Whisper', percent: 4, tokens: '0.8M' },
] as const;

export const SEVEN_DAY_USAGE = [
  { day: 'Mon', tokensMillions: 2.1, spend: 1.36 },
  { day: 'Tue', tokensMillions: 2.4, spend: 1.58 },
  { day: 'Wed', tokensMillions: 2.3, spend: 1.49 },
  { day: 'Thu', tokensMillions: 2.8, spend: 2.01 },
  { day: 'Fri', tokensMillions: 2.5, spend: 1.74 },
  { day: 'Sat', tokensMillions: 3.1, spend: 2.43 },
  { day: 'Sun', tokensMillions: 3.5, spend: 2.85 },
] as const;

export const RECENT_REQUESTS = [
  { id: 'req_8F21', model: 'GLM 5.2', tokens: '18.4K', cost: '$0.011', status: 'Complete' },
  { id: 'req_8F20', model: 'Qwen3-VL', tokens: '42.1K', cost: '$0.037', status: 'Complete' },
  { id: 'req_8F19', model: 'Flux', tokens: '1 image', cost: '$0.010', status: 'Complete' },
] as const;
