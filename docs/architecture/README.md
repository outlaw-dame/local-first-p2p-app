# Architecture Planning Documents

These documents capture the original planning set for the Local-First P2P architecture. They are design intent, not an implementation audit.

The PDFs that produced this planning layer were created before this repository's current code existed. Their role is to preserve the target architecture, doctrine, risks, and long-term constraints while implementation proceeds incrementally.

## Source planning set

1. **01 - Overview and Principles**
   - North star, non-goals, high-level stack, authority model, and document map.
2. **02 - Core Protocol and Data Model**
   - Log-first protocol model, Corestore/Hypercore/Autobase target path, social outbox model, persistent availability peers, and browser bridge posture.
3. **03 - Identity, Naming, and Security**
   - Root/device identity separation, identity control logs, capability delegation, revocation, petnames, contact cards, namespaces, attribute sharing, and anti-phishing rules.
4. **04 - Media, Presence, Search, and Intelligence**
   - Media manifests, Hyperdrive/Hyperblobs target media layer, ephemeral presence, local intelligence, embedding lifecycle, hybrid search, named vectors, RAG, and permission rules.
5. **05 - Implementation Roadmap, Risks, and Open Questions**
   - Original staged roadmap, risk register, decisions captured, testing strategy, and documentation backlog.
6. **06 - Implementation Doctrine / Development Gospel**
   - Strict implementation doctrine: PWA-first but hybrid-ready, protocol-first object model, phase gates, infrastructure classes, MLS plan, and quality rules.
7. **07 - Frontend Architecture for the First PWA**
   - PWA light-peer frontend plan, Framework7/Dexie/PGlite/TanStack Query boundaries, service-worker rules, mutation safety, and frontend build order.

## How to use these docs

Use these documents as planning authority and constraint source. Do not treat them as a statement that every target subsystem exists today.

The authoritative architecture model for this repository is a local-first trust-centric object network, not ActivityPub, ATProto, or Memory. External systems may provide inspiration, but they are not the protocol authority for this repo.

Before implementing a feature, check:

1. Does the feature belong to the architecture target?
2. Does the implementation doctrine require a phase gate, fixture, ADR, or threat-model note first?
3. Does current code already implement a smaller slice under another name?
4. Would the change create duplicate protocol concepts?
5. Is the change PWA-light-peer-specific or compatible with future full peers?

## Current-state bridge

The implementation truth layer lives under `docs/implementation/`. Start there before writing code.
