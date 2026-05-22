# Local-First P2P Product Monorepo

This repository is a dedicated product monorepo for the Local-First P2P application. It is structured to support a hybrid architecture from day one, ensuring that the Progressive Web Application (PWA) is a protocol-aware light peer rather than a siloed frontend.

## Repository Structure

The monorepo is organized into `apps/` and `packages/` to enforce strict boundaries and facilitate code reuse across different targets.

### Applications (`apps/`)
- **pwa/**: The primary user-facing PWA built with Framework7 React, TypeScript, and Vite.
- **capacitor-ios/**: iOS native shell (placeholder for future native packaging).
- **capacitor-android/**: Android native shell (placeholder for future native packaging).
- **bridge-service/**: Infrastructure for synchronization and bridge protocols.

### Shared Packages (`packages/`)
- **protocol/**: Runtime-neutral signed event schemas and protocol definitions.
- **crypto/**: Key management, signing, and encryption/decryption logic.
- **local-store/**: Local persistence layer using Dexie and PGlite.
- **sync-client/**: Bridge transport and synchronization logic.
- **identity/**: Identity management and device state.
- **naming/**: Namespace proofs and petname management.
- **search/**: Local search projections and indexing.
- **ui/**: Shared UI components wrapping Framework7.
- **platform/**: Runtime and capability detection.
- **design-tokens/**: Apple-inspired design tokens and platform themes.

## Core Principles

The development follows a protocol-first approach where the PWA acts as a light peer. This ensures that every feature respects cryptographic source authority, local-first rebuildability, and eventual migration to full P2P mode.

## Tooling

This project utilizes modern web development tooling to ensure a robust and scalable development environment:
- **pnpm workspaces**: Efficient package management and dependency sharing.
- **TypeScript**: Type safety across the entire monorepo.
- **Vite**: Fast development server and build tool.
- **Vitest**: Unit testing framework.
- **Playwright**: End-to-end testing.
- **ESLint & Prettier**: Code quality and formatting.
