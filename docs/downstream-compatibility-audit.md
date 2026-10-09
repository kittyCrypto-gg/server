# Downstream compatibility audit (integrated refactor)

Audited: 9 October 2026. Integration branch: `integration/refactors-zero-nesting`. Source tree includes PRs #5–#12 and #18. Audited initial integration head: `73386a96a395d35264e91ac411cd713fd449104c`.

## Scope and results

All seven consuming repositories are private and reference `@kittycrypto/server` via a local Git submodule. The package-root exports are unchanged, with `src/index.ts` blob `e14333f177c935f8226f49487e1a45ed7f932b39`. The direct HTTP implementation `src/baseServer.ts` remains blob `e30f05bb29fefd3d32cedf94e69d9e069f7495c2`. `src/mutexPBstore.ts` remains blob `6d98f23a1f76dc36cada56f6a56eaa7fea2484df`. The persistence refactor preserves the storage class and protected hooks with test coverage for protobuf bytes, corruption, lockfiles and concurrent writes.

| Consumer repository | Existing submodule commit | Uses | Existing CI command |
| --- | --- | --- | --- |
| [kitty-crow/felinebot](https://github.com/kitty-crow/felinebot) | `1b76902e6b194b8e0e4cb4cb10832753b01b633a` | `MutexProtoBuffStore`, `ProtoBuffObjectCodec`, `read`, `update`, `onCorrupt` | `bun run ci` |
| [kitty-crow/maebot-reddit](https://github.com/kitty-crow/maebot-reddit) | `559585426c88498ffee96ed1862d90f13b14c746` | `MutexProtoBuffStore`, `ProtoBuffCodec`, custom `codec`, `read`, `update` | `bun run ci` |
| [kitty-crow/maebot-telegram](https://github.com/kitty-crow/maebot-telegram) | `fad374e12b8d7f046f73d7a4a3f8bdcf800d87e9` | `MutexProtoBuffStore`, `ProtoBuffCodec`, custom `codec`, `read`, `update` | `bun run ci` |
| [kitty-crow/maebot-twitter](https://github.com/kitty-crow/maebot-twitter) | `559585426c88498ffee96ed1862d90f13b14c746` | `MutexProtoBuffStore`, `ProtoBuffCodec`, custom `codec`, `read`, `update` | `bun run ci` |
| [kitty-crow/maebot-discord](https://github.com/kitty-crow/maebot-discord) | `fad374e12b8d7f046f73d7a4a3f8bdcf800d87e9` | `MutexProtoBuffStore`, `ProtoBuffCodec`, custom `codec`, `read`, `update` | `bun run ci` |
| [kitty-crow/mae-tickets](https://github.com/kitty-crow/mae-tickets) | `20d5da36e7e2aede26a613268e0fa008d98e87f2` | `MutexProtoBuffStore`, `ProtoBuffCodec`, `corruptionPolicy`, `fileMode` | `bun run ci` |
| [hostel4pets-co-uk/hostel4petsBackEnd](https://github.com/hostel4pets-co-uk/hostel4petsBackEnd) | `ed25ed075b2584ddf6b3587b1a837fecbb3244d1` | `Server` constructor/route methods; `MutexProtoBuffStore`, `ProtoBuffCodec`, custom migration wrapper | `bun run validate` |

### Source compatibility

The exact package-root imports used in these repositories remain available. No direct TypeScript imports of the server's extracted private submodules were identified. `Server` construction and route registration are covered by `src/contracts/baseServerDownstreamCompatibility.ts` and runtime source/class identity tests; protobuf store construction, custom codec options, error backups, permissions, roundtrips and concurrent writes are covered by `src/contracts/persistenceConsumerCompatibility.ts` and `test/persistenceConsumer.test.ts`.

The integrated repository passes TypeScript compilation, all tests and repository-wide no-nested-control-flow / maximum-500-line rules. This audit does **not** establish that an entire downstream repository builds against the proposed refactor head: each consumer still pins an older Git submodule SHA.

### Mandatory release gate: downstream builds

Do not report cross-repository integration as verified until each consumer has run its existing CI command with the `@kittycrypto/server` submodule pointing to the **exact approved integrated refactor SHA**. Compare persistent state before and after where applicable, especially stale lockfiles and protobuf stores. The server repository's workflow `GITHUB_TOKEN` does not automatically grant access to those seven separate private repositories. This GitHub-only audit leaves all downstream repos and their pins unchanged. No live services were tested or deployed.

A subsequent PR to refresh submodule pins should be considered **separately** after explicit permission, not silently as part of this refactor.
