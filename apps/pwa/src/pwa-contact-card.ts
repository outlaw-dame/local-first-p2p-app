import {
  sha256Base64Url,
  signDetachedJson,
  verifyDetachedJsonSignature,
  type DetachedJsonSignature,
  type SigningKeypair
} from '@lfp2p/crypto';
import { type IdentityTrustSnapshot } from '@lfp2p/identity';
import { type PutContactProfileInput, type StoredContactProfile } from '@lfp2p/local-store';

export type ContactCardDocument = Readonly<{
  version: 'lfp2p.contact-card.v1';
  exportedAt: string;
  identityId: string;
  displayName?: string;
  avatarUrl?: string;
  websiteUrl?: string;
  note?: string;
  controllerPublicKey?: string;
  primaryDeviceId?: string;
  shortFingerprint?: string;
  signature?: DetachedJsonSignature;
}>;

export type ComparedIdentityCode = Readonly<{
  matches: boolean;
  expectedFingerprint?: string;
  candidateFingerprint?: string;
}>;

export async function createContactCardDocument(input: Readonly<{
  identityId: string;
  profile: StoredContactProfile;
  trustSnapshot: IdentityTrustSnapshot;
  exportedAt?: string;
}>): Promise<ContactCardDocument> {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  requireIsoDate(exportedAt, 'exportedAt');
  return {
    version: 'lfp2p.contact-card.v1',
    exportedAt,
    identityId: requireNonEmptyString(input.identityId, 'identityId'),
    ...(input.profile.displayName === undefined ? {} : { displayName: input.profile.displayName }),
    ...(input.profile.avatarUrl === undefined ? {} : { avatarUrl: input.profile.avatarUrl }),
    ...(input.profile.websiteUrl === undefined ? {} : { websiteUrl: input.profile.websiteUrl }),
    ...(input.profile.note === undefined ? {} : { note: input.profile.note }),
    ...(input.trustSnapshot.controllerPublicKey === undefined
      ? {}
      : { controllerPublicKey: input.trustSnapshot.controllerPublicKey }),
    ...(input.trustSnapshot.primaryDeviceId === undefined ? {} : { primaryDeviceId: input.trustSnapshot.primaryDeviceId }),
    ...(input.trustSnapshot.shortFingerprint === undefined ? {} : { shortFingerprint: input.trustSnapshot.shortFingerprint })
  };
}

export function serializeContactCardDocument(card: ContactCardDocument): string {
  validateContactCardDocument(card);
  return JSON.stringify(card, null, 2);
}

export function signContactCardDocument(card: ContactCardDocument, keypair: SigningKeypair): ContactCardDocument {
  validateContactCardDocument(card);
  const signature = signDetachedJson(unsignedContactCardDocument(card), keypair);
  return {
    ...unsignedContactCardDocument(card),
    signature
  };
}

export function verifyContactCardDocumentSignature(card: ContactCardDocument): boolean {
  validateContactCardDocument(card);
  if (card.signature === undefined) return false;
  return verifyDetachedJsonSignature(unsignedContactCardDocument(card), card.signature);
}

export function parseContactCardDocument(raw: string): ContactCardDocument {
  const parsed = safeJsonParse(raw);
  if (!isRecord(parsed)) throw new Error('Contact card must be a JSON object.');
  const card: ContactCardDocument = {
    version: requireLiteralVersion(parsed.version),
    exportedAt: requireIsoDate(parsed.exportedAt, 'exportedAt'),
    identityId: requireNonEmptyString(parsed.identityId, 'identityId'),
    ...(parsed.displayName === undefined ? {} : { displayName: requireOptionalText(parsed.displayName, 'displayName', 96) }),
    ...(parsed.avatarUrl === undefined ? {} : { avatarUrl: requireOptionalUrl(parsed.avatarUrl, 'avatarUrl') }),
    ...(parsed.websiteUrl === undefined ? {} : { websiteUrl: requireOptionalUrl(parsed.websiteUrl, 'websiteUrl') }),
    ...(parsed.note === undefined ? {} : { note: requireOptionalText(parsed.note, 'note', 280) }),
    ...(parsed.controllerPublicKey === undefined
      ? {}
      : { controllerPublicKey: requireOptionalText(parsed.controllerPublicKey, 'controllerPublicKey', 2048) }),
    ...(parsed.primaryDeviceId === undefined
      ? {}
      : { primaryDeviceId: requireOptionalText(parsed.primaryDeviceId, 'primaryDeviceId', 128) }),
    ...(parsed.shortFingerprint === undefined
      ? {}
      : { shortFingerprint: requireOptionalText(parsed.shortFingerprint, 'shortFingerprint', 64) }),
    ...(parsed.signature === undefined ? {} : { signature: requireDetachedJsonSignature(parsed.signature) })
  };
  validateContactCardDocument(card);
  return card;
}

export async function createImportedContactProfileInput(input: Readonly<{
  card: ContactCardDocument;
  existingProfile?: StoredContactProfile;
  trustedControllerPublicKey?: string;
  requireSignature?: boolean;
}>): Promise<PutContactProfileInput> {
  validateContactCardDocument(input.card);
  const requireSignature = input.requireSignature ?? true;
  if (requireSignature && input.card.signature === undefined) {
    throw new Error('Imported contact card must include a detached signature.');
  }
  if (input.card.signature !== undefined && !verifyContactCardDocumentSignature(input.card)) {
    throw new Error('Imported contact card signature verification failed.');
  }
  const trustedControllerPublicKey =
    input.trustedControllerPublicKey ?? input.existingProfile?.controllerPublicKey;
  if (
    trustedControllerPublicKey !== undefined &&
    input.card.controllerPublicKey !== undefined &&
    trustedControllerPublicKey !== input.card.controllerPublicKey
  ) {
    throw new Error('Imported contact card controller key does not match the trusted controller key.');
  }

  if (input.card.controllerPublicKey !== undefined && input.card.shortFingerprint !== undefined) {
    const expectedFingerprint = await createShortFingerprint(input.card.controllerPublicKey);
    if (normalizeIdentityCode(expectedFingerprint) !== normalizeIdentityCode(input.card.shortFingerprint)) {
      throw new Error('Imported contact card fingerprint does not match its controller public key.');
    }
  }

  const importedShortFingerprint =
    input.card.shortFingerprint ??
    (input.card.controllerPublicKey === undefined ? undefined : await createShortFingerprint(input.card.controllerPublicKey));

  return {
    identityId: input.card.identityId,
    ...(input.existingProfile?.petname === undefined ? {} : { petname: input.existingProfile.petname }),
    ...(input.card.displayName === undefined ? {} : { displayName: input.card.displayName }),
    ...(input.card.avatarUrl === undefined ? {} : { avatarUrl: input.card.avatarUrl }),
    ...(input.card.websiteUrl === undefined ? {} : { websiteUrl: input.card.websiteUrl }),
    ...(input.card.note === undefined ? {} : { note: input.card.note }),
    ...(input.card.primaryDeviceId === undefined ? {} : { primaryDeviceId: input.card.primaryDeviceId }),
    ...(input.card.controllerPublicKey === undefined ? {} : { controllerPublicKey: input.card.controllerPublicKey }),
    ...(importedShortFingerprint === undefined ? {} : { shortFingerprint: importedShortFingerprint }),
    verificationStatus: input.existingProfile?.verificationStatus ?? 'unknown',
    updatedAt: new Date().toISOString()
  };
}

export async function compareIdentityCode(input: Readonly<{
  expectedFingerprint?: string;
  controllerPublicKey?: string;
  candidate: string;
}>): Promise<ComparedIdentityCode> {
  const expectedFingerprint = input.expectedFingerprint;
  if (expectedFingerprint === undefined) {
    const normalizedCandidate = normalizeIdentityCode(input.candidate);
    return normalizedCandidate.length === 0
      ? { matches: false }
      : { matches: false, candidateFingerprint: normalizedCandidate };
  }
  const normalizedExpected = normalizeIdentityCode(expectedFingerprint);
  const normalizedCandidate = normalizeIdentityCode(input.candidate);
  if (normalizedCandidate.length === 0) {
    return { matches: false, expectedFingerprint };
  }
  if (normalizedCandidate === normalizedExpected) {
    return { matches: true, expectedFingerprint, candidateFingerprint: input.candidate };
  }
  if (input.controllerPublicKey !== undefined && input.candidate.trim() === input.controllerPublicKey) {
    return { matches: true, expectedFingerprint, candidateFingerprint: expectedFingerprint };
  }
  if (input.candidate.trim().length > 32) {
    const candidateFingerprint = await createShortFingerprint(input.candidate.trim());
    return {
      matches: normalizeIdentityCode(candidateFingerprint) === normalizedExpected,
      expectedFingerprint,
      candidateFingerprint
    };
  }
  return {
    matches: false,
    expectedFingerprint,
    candidateFingerprint: input.candidate
  };
}

function validateContactCardDocument(card: ContactCardDocument): void {
  if (card.version !== 'lfp2p.contact-card.v1') throw new Error('Unsupported contact card version.');
  requireIsoDate(card.exportedAt, 'exportedAt');
  requireNonEmptyString(card.identityId, 'identityId');
  if (card.displayName !== undefined) requireTextLength(card.displayName, 'displayName', 96);
  if (card.avatarUrl !== undefined) validateUrl(card.avatarUrl, 'avatarUrl');
  if (card.websiteUrl !== undefined) validateUrl(card.websiteUrl, 'websiteUrl');
  if (card.note !== undefined) requireTextLength(card.note, 'note', 280);
  if (card.controllerPublicKey !== undefined) requireTextLength(card.controllerPublicKey, 'controllerPublicKey', 2048);
  if (card.primaryDeviceId !== undefined) requireTextLength(card.primaryDeviceId, 'primaryDeviceId', 128);
  if (card.shortFingerprint !== undefined) requireTextLength(card.shortFingerprint, 'shortFingerprint', 64);
  if (card.signature !== undefined) {
    requireTextLength(card.signature.publicKey, 'signature.publicKey', 2048);
    requireTextLength(card.signature.value, 'signature.value', 2048);
    if (card.signature.algorithm !== 'ed25519-detached-json') {
      throw new Error('Unsupported contact card signature algorithm.');
    }
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Contact card must be valid JSON.');
  }
}

function requireLiteralVersion(value: unknown): 'lfp2p.contact-card.v1' {
  if (value !== 'lfp2p.contact-card.v1') throw new Error('Unsupported contact card version.');
  return 'lfp2p.contact-card.v1';
}

function requireOptionalText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  requireTextLength(normalized, label, maxLength);
  return normalized;
}

function requireOptionalUrl(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  validateUrl(normalized, label);
  return normalized;
}

function validateUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https.`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error(`${label} must not include credentials.`);
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireIsoDate(value: unknown, label: string): string {
  const normalized = requireNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} must be an ISO date string.`);
  return normalized;
}

function requireTextLength(value: string, label: string, maxLength: number): string {
  if (value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} length must be between 1 and ${maxLength}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unsignedContactCardDocument(card: ContactCardDocument): Omit<ContactCardDocument, 'signature'> {
  const { signature, ...unsigned } = card;
  void signature;
  return unsigned;
}

function requireDetachedJsonSignature(value: unknown): DetachedJsonSignature {
  if (!isRecord(value)) throw new Error('signature must be an object.');
  if (value.algorithm !== 'ed25519-detached-json') {
    throw new Error('Unsupported contact card signature algorithm.');
  }
  return {
    algorithm: 'ed25519-detached-json',
    publicKey: requireNonEmptyString(value.publicKey, 'signature.publicKey'),
    value: requireNonEmptyString(value.value, 'signature.value')
  };
}

function normalizeIdentityCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function createShortFingerprint(value: string): Promise<string> {
  const digest = await sha256Base64Url(value);
  const short = digest.slice(0, 16);
  return `${short.slice(0, 4)}-${short.slice(4, 8)}-${short.slice(8, 12)}-${short.slice(12, 16)}`;
}