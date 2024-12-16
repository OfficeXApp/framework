# Virtual Filesystem Sync Implementation Notes

## Initial Sync (Offline → Cloud)

1. Start with root folder in BFS queue
2. For each folder in queue:

   - Check if folder exists in cloud at same path
   - If no cloud folder: create it and get cloud ID
   - Replace local folder ID with cloud ID
   - Add subfolders to BFS queue
   - Sync all files in current folder

3. For each file:
   - Upload file if not in cloud
   - Replace local file ID with cloud ID
   - Update all references (folder.fileUUIDs, metadata tables, path lookups)

## ID Replacement Process

1. When replacing a folder ID:

   - Update folder's own metadata entry
   - Update parent's subfolderUUIDs array
   - Update children's parentFolderUUID reference
   - Update fullFolderPathToUUID mapping

2. When replacing a file ID:
   - Update file's own metadata entry
   - Update parent folder's fileUUIDs array
   - Update fullFilePathToUUID mapping
   - Maintain version history links (priorVersion/nextVersion)

## Key Implementation Details

1. Use BFS (Breadth-First Search) because:

   - Matches user navigation patterns
   - Provides better UX as top-level folders sync first
   - Easier to show meaningful progress to users

2. Handle failures gracefully:

   - Track failed syncs to prevent syncing children of failed parents
   - Implement retry mechanism for failed items
   - Maintain consistent state if sync is interrupted

3. Progress Tracking:
   - Track total items vs completed items
   - Track current level depth
   - Report progress by folder path for UI updates

## Data Consistency

1. After initial sync:

   - All local IDs should match cloud IDs
   - All paths should match between systems
   - All parent-child relationships should be preserved

2. Maintain integrity of:
   - File version histories
   - Folder structures
   - Path-to-ID mappings

## Future Considerations

1. Implement incremental sync for subsequent updates
2. Add conflict resolution for simultaneous offline/online changes
3. Consider implementing sync checkpoints for recovery
4. Add validation step to verify sync completion

# On the fly creation

When cloud is enabled and we create folders on the fly, this same sync process happens just at a local level.
Instead of BFS sync at root, its at the folder level the file was created at.
