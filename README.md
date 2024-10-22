# OFX Framework

`OFX = Offchain First Experience`

A framework for creating local offline client first dapps with decentralized cloud backends. Powers OfficeX

The OFX Framework is an open-source framework for creating local offline client first dapps with decentralized cloud backends. This allows you to build “free unlimited dapps” that don’t cost any gas, but can gracefully upgrade to a gas toll cloud, which is 100x cheaper than centralized solutions. This library is the “open-core” of OfficeX, a superior clone of Google Docs / Microsoft Office.

Here’s what's included:

### Local First File Storage

Folder based filesystem with 3 tiers of storage

- Local Browser Cache
- Local Machine Filesystem
- Cloud Blockchain

2. Anonymous Identity
   Pure clientside anonymous identity via EVM address.

- No internet required. Works out of the box with Ethereum and EVM blockchains.
- Gracefully upgrades to cloud identity for document sharing
- Inter-operable with ICP blockchain
- Deterministic identities for sharing with new users (via predetermined mnemonic phrase)

3. Peer to Peer Client Sync

- Enable gasless real-time collaboration on documents via WebRTC. Possible in two modes:
- Zero-Config mode. Uses the blockchain as the backend for initial WebRTC handshake. Users just pay gas.
- Client-Bootstrap mode. Uses the document owners local machine as the WebRTC server. Session is only active when the owner keeps their computer active.

These combined features make up the OFX Framework. This pattern enables you to build “free unlimited dapps” that don’t cost any gas, but can gracefully upgrade to a gas toll cloud, which is 100x cheaper than centralized solutions.

## License

Licensed under Apache 2.0 Open Source
