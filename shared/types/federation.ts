// ── Federation Types ──

export interface FederationEvent {
  origin: string;
  originServerTs: number;
  eventId: string;
  roomId: string;
  sender: string;
  eventType: string;
  content: Record<string, unknown>;
  signatures: FederationSignatures;
}

export interface FederationSignatures {
  [serverDomain: string]: {
    [keyId: string]: string;
  };
}

export interface ServerDiscovery {
  'frame.server': {
    host: string;
    port: number;
    publicKey: string;
  };
}

export interface FederationSendRequest {
  events: FederationEvent[];
}

export interface FederationKeyRequest {
  userId: string;
}

export interface FederationBackfillRequest {
  roomId: string;
  since: string;
  limit: number;
}
