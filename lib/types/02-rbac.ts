/* RBAC — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { Flag, IsoDate, IsoDateTime } from '../types.ts';

/* -------------------------------------------------------------------- RBAC */

export interface County {
  id: number;
  /** Kenya's official three-digit county code — 019 is Nyeri. */
  code: string | null;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface CountyWithUsage extends County {
  sub_counties: number;
  students: number;
}

export interface SubCounty {
  id: number;
  county_id: number;
  /** <county code>-<nn>, e.g. 019-03. */
  code: string | null;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

/** A value on the Global Dimension 1 or 2 pick list — both lists share this shape. */
export interface DimensionValue {
  id: number;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface SubCountyWithUsage extends SubCounty {
  county_name: string;
  students: number;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
  is_system: Flag;
  /** Users holding this permission set must sign in with an authenticator code (lib/totp.ts). */
  require_two_factor: boolean;
}

/** One Permission Set line: a grant of rights on one Table or Page object. */
export interface PermissionSetLine {
  id: number;
  role_id: number;
  object_type: 'TABLE' | 'PAGE';
  object_name: string;
  read_perm: Flag;
  insert_perm: Flag;
  modify_perm: Flag;
  delete_perm: Flag;
  execute_perm: Flag;
}

/** A per-user permission override line — same shape as PermissionSetLine, keyed to a user. When
 *  present it replaces the role's line for that one object. See lib/userPermissions.ts. */
export interface UserPermissionLine {
  id: number;
  user_id: number;
  object_type: 'TABLE' | 'PAGE';
  object_name: string;
  read_perm: Flag;
  insert_perm: Flag;
  modify_perm: Flag;
  delete_perm: Flag;
  execute_perm: Flag;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface PermissionRightSet {
  read: boolean;
  insert: boolean;
  modify: boolean;
  delete: boolean;
  execute: boolean;
}

/** One object's row in the per-user permission editor: the rights granted by the user's assigned
 *  Permission Sets (primary role ∪ additional sets), the effective rights after any per-user
 *  override, and whether they differ. */
export interface UserPermissionMatrixRow {
  objectType: 'TABLE' | 'PAGE';
  objectName: string;
  label: string;
  /** Granted by the union of the user's assigned Permission Sets, before overrides. */
  granted: PermissionRightSet;
  effective: PermissionRightSet;
  overridden: boolean;
}

export interface UserPermissionMatrix {
  userId: number;
  userName: string;
  role: { id: number; name: string; is_system: Flag };
  /** Names of every Permission Set feeding the granted baseline — the primary role first. */
  grantedSetNames: string[];
  isSystem: boolean;
  rows: UserPermissionMatrixRow[];
}

/** A table available in the Permission Set line dropdown — live, not curated. */
export interface PermissionTableOption {
  name: string;
  label: string;
}

/** A role row with its lines and user count rolled up. */
export interface RoleWithUsage extends Role {
  lines: PermissionSetLine[];
  userCount: number;
}

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface AppUser {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  role_id: number;
  status: UserStatus;
  last_login_at: IsoDateTime | null;
  created_at: IsoDateTime | null;
  /** Sign-in lockout (lib/auth.ts): consecutive failures, and when the lock lifts. */
  failed_logins: number;
  locked_until: IsoDateTime | null;
  /** Forces a password change at the next sign-in. */
  must_change_password: boolean;
  password_changed_at: IsoDateTime | null;
  /** Two-factor sign-in (lib/totp.ts): the encrypted secret, whether it is on, and the single-use recovery codes (hashed). */
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_enrolled_at: IsoDateTime | null;
  totp_recovery_codes: string | null;
  totp_last_step: number | null;
  /** BC's "Work Date" (My Settings) — this user's own suggested default date, in place of the
   *  real system date, for new documents. Null = use today(). See lib/postingDates.ts. */
  work_date: IsoDate | null;
  /** The company an administrator pinned this user to (lib/companies.ts). Null = the user picks
   *  their own on My Settings. */
  company_code: string | null;
  /** The Role Centre landing page this user currently sees. Points at one of their assigned
   *  Profiles; null falls back to the default (Super) profile. Grants no permissions. */
  active_profile_id: number | null;
}

/** Business Central's "Profile" — a landing-page selector. Decides which Role Centre (tailored
 *  home dashboard) a user sees; carries no permissions (fully independent of the Permission Set
 *  system). See lib/profiles.ts. */
export interface Profile {
  id: number;
  code: string;
  name: string;
  description: string;
  /** The Role Centre this profile lands on — one of SUPER | SCHOOL_ADMIN | TEACHER | STUDENT_PARENT | FINANCE_MANAGER
   *  | ACCOUNTANT for the seeded profiles. */
  role_centre: string;
  icon: string;
  sort: number;
  is_default: Flag;
  is_system: Flag;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

/** A role's lines, folded into direct lookups for canTable()/canPage(). */
export interface PermissionSet {
  tables: Record<string, { read: boolean; insert: boolean; modify: boolean; delete: boolean }>;
  pages: Record<string, boolean>;
}

/**
 * The signed-in user, as returned by userFromToken().
 * `password_hash` is deleted before the record leaves the auth layer, which is
 * why it is omitted here rather than marked optional.
 */
export interface SessionUser extends Omit<AppUser, 'password_hash'> {
  role_name: string;
  is_system: Flag;
  permissionSet: PermissionSet;
  /** Every Profile an admin has assigned to this user (system-admin users get all of them). */
  profiles: Profile[];
  /** The Profile whose Role Centre `/dashboard` renders — resolved from `active_profile_id`,
   *  falling back to the default profile, then the first assigned, then a Super stand-in. Never
   *  null. */
  activeProfile: Profile;
  /** User Setup "Teacher": the Teacher Portal is offered inside Employee Self Service. */
  isTeacher: boolean;
  /**
   * Set only when the caller authenticated with a Web Service Access Key: what that key may do
   * on top of the user's permissions (lib/webServices assertKeyAllows). Absent for a session.
   */
  webServiceKey?: WebServiceKeyScope;
}

export type WebServiceKeyScopeKind = 'READ_ONLY' | 'READ_WRITE';
export interface WebServiceKeyScope {
  id: number;
  scope: WebServiceKeyScopeKind;
  /** Service names the key may call; null = every published service. */
  services: string[] | null;
  /** The key's own throttle, requests per minute; null = only the per-address limits apply. */
  ratePerMinute: number | null;
}

/** Anything that can be recorded as the actor on an audit entry. */
export interface Actor {
  id: number;
  username: string;
}

export interface UserListRow {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
  last_login_at: IsoDateTime | null;
  created_at: IsoDateTime | null;
  /** Sign-in lockout state (lib/auth.ts) — shown on the admin list with an Unlock action. */
  failed_logins: number;
  locked_until: IsoDateTime | null;
  must_change_password: boolean;
  totp_enabled: boolean;
  role_name: string;
  role_id: number;
  /** Codes of the Role Centre Profiles assigned to this user (for the admin list). */
  profile_codes: string[];
  company_code: string | null;
  /** Names of the additional Permission Sets granted on top of the primary role. */
  extra_permission_set_names: string[];
  /** How many per-user permission overrides this user carries (0 = plain role). */
  override_count: number;
}

export interface AuditEntry {
  id: number;
  at: IsoDateTime;
  user_id: number | null;
  username: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: string | null;
  ip: string | null;
}

/** Which tables get field-level change tracking — Admin Centre toggles these. */
export interface ChangeLogSetup {
  table_name: string;
  table_caption: string;
  log_insertion: Flag;
  log_modification: Flag;
  log_deletion: Flag;
}

export type ChangeLogType = 'Insertion' | 'Modification' | 'Deletion';

export interface ChangeLogEntry {
  id: number;
  table_name: string;
  table_caption: string;
  record_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  type: ChangeLogType;
  changed_at: IsoDateTime;
  user_id: number | null;
  username: string;
}
