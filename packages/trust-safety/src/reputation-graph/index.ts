/**
 * Phase 1.8.1 — reputation graph protocol layer.
 *
 * Pure event payloads + validator. No projection, no algorithm, no
 * surface integration — those land in Phase 1.8.2 (local computer)
 * + Phase 1.8.3 (surface integration).
 */
export * from './constants.js';
export * from './events.js';
export * from './inputs.js';
export * from './config.js';
export * from './computer.js';
export * from './surface-integration.js';
export * from './spam-gate.js';
export * from './sybil-hardening.js';
export * from './aggregator-runtime.js';
