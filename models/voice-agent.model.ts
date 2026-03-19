// src/app/models/voice-agent.model.ts

export type VoiceAgentType = 'vapi';

export interface VoiceAgent {
  name: string;
  type: VoiceAgentType;
  assistantId: string;
  description?: string;
}
