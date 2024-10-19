# Notes

Republish updated npm package:

```sh
rm -rf dist && npm run build && npm publish --access public
```

## Prompt Context

```

// Context
OfficeX is the superior clone of Google Drive. It uses browser cache for storage, or local filesystem, or firebase storage bucket, or AWS S3, or decentralized cloud storage. In general it is suppose to be storage location agnostic, providing DriveDB as a common interface for frontend app developers to use. DriveDB uses browser IndexedDB to index for faster querying. For now we only have browser cache & filesystem so dont worry about the other storage locations.

```
