# Specification Status

- Status: Draft
- Specification series: 0
- Scope: status labels for specification documents

## Purpose

Every specification document should declare its maturity and review status.

Status labels help implementers distinguish stable requirements from exploratory design.

## Status labels

### Draft

The document is actively changing.

Implementations MAY experiment with Draft requirements but SHOULD NOT treat them as stable.

### Experimental

The design is coherent enough for prototype implementation, but compatibility is not guaranteed.

Experimental features SHOULD be capability-gated and SHOULD NOT be enabled as required core behavior.

### Review

The document is ready for detailed protocol review.

Review documents SHOULD have clear requirements, open questions, examples, and security/privacy considerations.

### Candidate

The document is intended to become Stable unless review or implementation experience finds issues.

Candidate documents SHOULD have known conformance expectations and interoperability fixtures planned.

### Stable

The document defines normative protocol behavior.

Stable requirements MUST NOT change incompatibly without the versioning process defined in `VERSIONING.md`.

### Deprecated

The document or feature remains recognized but should no longer be used for new implementations.

Deprecated documents MUST identify replacement behavior when available.

### Superseded

The document has been replaced by another document.

Superseded documents MUST link to the successor.

## Required front matter

Each specification document SHOULD start with:

```md
# Title

- Status: Draft
- Specification series: 0
- Specification version: 0.x
- Scope: ...
- Updates: ...
- Supersedes: ...
- Related: ...
```

`Updates` and `Supersedes` MAY be omitted when not applicable.

## Status transitions

Draft → Experimental → Review → Candidate → Stable is the normal path.

A document MAY skip a stage for small, low-risk clarifications.

A Stable document SHOULD NOT return to Draft. Instead, create a new version or successor document.

## Implementation warning

Reference-implementation behavior MUST NOT be treated as Stable specification behavior unless the relevant specification document is Stable or Candidate and explicitly describes that behavior.
