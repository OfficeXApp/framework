# To Do

## New ToDo

- [ ] Add cloud sync for folders
- [ ] Write recursive sync cloud, with full depth at root
- [ ] Test that sync works without bugs
- [ ] Test rollback file

- [ ] Add unit tests for .lastChangedUnixMs and surgicallySyncFileUUID/surgicallySyncFolderUUID
- [ ] Should we have an expires at for free anon file sharing? (so that old anon shares dont appear as broken)

## Quick Notes

- [ ] Change back to 7 days signed urls file sharing

## Identity

- [ ] Implement icp identity
- [ ] Refactor implement evm identity with viem-js
- [ ] Refactor the IdentityProvider
- [ ] Refactor cache the identity
- [ ] Refactor load identity from cache before attemping to create new evm identity

# Storage

- [x] "Shallow List" query where at a given folder depth we only retrieve files & folders at same depth (breadth first not depth first)
- [x] Ability to upload the same file and replace with new version if name is same. keep 10 versions or 30 days. might need to update indexdb with a version field as well
- [x] Ability to auto-backup indexdb to filesystem & import backup (in case of reset browser cache)
- [x] Ability to rename a folder (and rename all files underneath)

- [x] Decide whether we want to support multiple SSDs (thus need to implement a StorageLocation manager). I think for now its better to only have a single SSD that is HardDrive. Keep it simple, just give users a warning to remember the exact location (or even let them add a note)
- [ ] File & Folder upload with progress observable
- [ ] Write to browser cache
- [ ] Connect to machine filesystem (Windows, Mac, Linux, Android, iPhone)
- [ ] Write to hard drive
- [ ] Implement partitioning in filesystem via subfolders
- [ ] Write to Storj \*priority - $0.40/100GB
- [ ] Unify all storage mediums under a framework storage api
- [ ] Show folder system on a tree explorer

- [ ] Ability for browser to download files from drive to Downloads folder (and handle multiple files as ZIP while preserving folder structure)
- [ ] Gracefully handle when rawFile cant be found (eg. HardDrive level)

- [ ] File & Folder move with progress observable
- [ ] Ability to tag files & folders
- [ ] Implement trash bin functionality

- [ ] Explore other frontend libraries for tree folder mgmt that can provide more support out of box (eg. multi-select move, multi-select delete)
- [ ] Add UI for single-select actions like move & delete
- [ ] Add UI for multi-select move & delete
- [ ] Add UI sort by most recent changed
- [ ] Add UI sort by file size
- [ ] Add UI pagniation
- [ ] Add optional encryption at rest for files

- [ ] Migrate the file uploading to use web-workers for performance
- [ ] Write to Firebase Bucket \*backlog - $2/100GB
- [ ] Write to AWS S3 \*backlog - $2/100GB

# Networking

- [ ] Setup pure client-only webrtc connections, shared via encoded link
-

# Frontend

- [x] Implement the actual legit web app so we can start using UI to test backend functionality
- [ ] Url string lets you navigate UI to a specific folder or file
