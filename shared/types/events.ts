// ── Encrypted Event Types ──

export interface EncryptedEvent {
  eventId: string;
  roomId: string;
  senderId: string;
  senderDeviceId: string;
  eventType: 'm.room.encrypted' | 'm.room.member' | 'm.room.create';
  content: Record<string, unknown>;
  originServer: string;
  originServerTs: number;
  sequenceId: number;
}

export interface ToDeviceEvent {
  senderId: string;
  senderDeviceId: string;
  eventType: string;
  content: Record<string, unknown>;
}

// ── Room Events ──

export interface RoomMemberEvent {
  membership: 'join' | 'leave' | 'invite' | 'ban';
  userId: string;
}

export interface RoomCreateEvent {
  creator: string;
  roomType: 'direct' | 'group';
}
