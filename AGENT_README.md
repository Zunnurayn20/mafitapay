# Base Transaction Attribution

This project uses the Base builder code `bc_taerk7uh`, stored in [builderCode.ts](/home/mafita/mafitapay/builderCode.ts).

## Rule

Every Base transaction sent by MafitaPay must include ERC-8021 attribution. Missing attribution does not fail loudly. It only causes silent tracking loss.

## How this project attaches attribution

- Server-side Base transactions are sent from [base-executor.ts](/home/mafita/mafitapay/lib/server/base-executor.ts)
- The executor creates a `viem` wallet client with a `dataSuffix`
- The suffix is derived from `BUILDER_CODE` using `ox/erc8021`

## Current Base wallet

- Builder-attributed Base executor wallet: `0xA37cd2CACF7ac304b6f966e980952910D7750921`

## Warning

Never add a new Base transaction path that bypasses [base-executor.ts](/home/mafita/mafitapay/lib/server/base-executor.ts). Every Base send path must carry the builder code.
