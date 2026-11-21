# Web test fixtures

## Mocked service boundaries

### A mocked model catalog's version must carry UUID v4 identities

Kind: pitfall

Why: `sendCommand` decodes the captured command with the catalog's `ChoiceVersion`, and `decodeChoiceVersion` runs `decodeId` (UUID v4) on `epoch` and `catalogId`; a non-UUID fixture such as `fixture` is refused as `The message was not sent (invalid)` and the transport's command mock is never called.

Anchors: `test/web/workspace-states.test.tsx#modeToggle`, `web/src/client/conversation-send.ts#sendCommand`, `src/service/contracts/models.ts#decodeChoiceVersion`

Source: this delivery, 2026-11-20
