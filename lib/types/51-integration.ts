/* integration (web services) — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { IsoDateTime, WebServiceKeyScopeKind } from '../types.ts';

/* ------------------------------------------------------------ integration (web services) */

/** Business Central "Web Service" (Tab2000000076): an object published under a Service Name. */
export type WebServiceObjectType = 'PAGE' | 'QUERY' | 'CODEUNIT';
export interface WebService {
  id: number;
  object_type: WebServiceObjectType;
  object_id: number;
  object_name: string;
  service_name: string;
  published: boolean;
  description: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}
/** A user's Web Service Access Key (BC User Card) — hashed at rest, shown once when generated. */
export interface WebServiceAccessKey {
  id: number;
  user_id: number;
  key_hash: string;
  key_hint: string;
  scope: WebServiceKeyScopeKind;
  /** Comma-separated service names, or null for all. */
  services: string | null;
  rate_limit_per_minute: number | null;
  expires_at: IsoDateTime | null;
  created_at: IsoDateTime;
  created_by: string | null;
  last_used_at: IsoDateTime | null;
  revoked_at: IsoDateTime | null;
}
export interface WebServiceAccessKeyView extends WebServiceAccessKey {
  username: string; full_name: string; user_status: string;
}
export interface WebServiceLogEntry {
  id: number;
  at: IsoDateTime;
  protocol: 'ODATA' | 'SOAP';
  method: string;
  service_name: string | null;
  operation: string | null;
  path: string;
  username: string | null;
  status: number;
  duration_ms: number;
  ip: string | null;
  error: string | null;
}
