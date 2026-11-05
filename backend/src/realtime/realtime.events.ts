export type Resource = 'product' | 'category';
export type Operation = 'created' | 'updated' | 'deleted';
export type SessionReason = 'passwordChanged' | 'securityChanged' | 'expired';
export interface ResourceEvent {
  eventId: string;
  id: string;
  operation: Operation;
}
