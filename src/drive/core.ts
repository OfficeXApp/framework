// core.ts

import { v4 as uuidv4 } from "uuid";
import Fuse from "fuse.js";
import {
  Hashtable_FileUUIDToMetadata,
  Hashtable_FolderUUIDToMetadata,
  Hashtable_FullFolderPathToUUID,
  Hashtable_FullFilePathToUUID,
  DriveFullFilePath,
  FolderUUID,
  FileUUID,
  FolderMetadata,
  FileMetadata,
  StorageLocationEnum,
  DriveDBSnapshot,
  DriveSnapshotID,
  FetchFilesAtFolderPathConfig,
  SearchFilesQueryConfig,
  FuseRecord,
  FuseRecordID,
  DRIVE_ERRORS,
  FileMetadataFragment,
  DriveFilePath,
  UploadFolderPath,
  UploadProgress,
  UploadItem,
  FileUploadStatusEnum,
  HashtableTypeEnum,
  DriveFileRawDestinationIndexDBFileID,
  // DriveFileRawDestinationIndexDBFileID,
} from "./types";
import { getFileExtension, sanitizeFilePath } from "./helpers";

import { StorjClient, S3ClientAuth } from "./storage/storj-web3";
import { UserID } from "../identity/types";
import IndexedDBStorage from "./storage/indexdb";
import {
  BehaviorSubject,
  // catchError,
  filter,
  // finalize,
  from,
  // map,
  mergeMap,
  Observable,
  // of,
  Subject,
  take,
  // takeUntil,
  tap,
} from "rxjs";

class DriveDB {
  // hashtables
  private fullFolderPathToUUID: Hashtable_FullFolderPathToUUID;
  private fullFilePathToUUID: Hashtable_FullFilePathToUUID;
  private folderUUIDToMetadata: Hashtable_FolderUUIDToMetadata;
  private fileUUIDToMetadata: Hashtable_FileUUIDToMetadata;
  private fuseIndex: Fuse<FuseRecord>;
  private indexDBStorage: IndexedDBStorage;
  private isInitialized: boolean = false;

  private storjClient: StorjClient | null = null;

  // Properties for upload management
  private uploadQueue: UploadItem[] = [];
  // private uploadProgress$: BehaviorSubject<UploadProgress>;
  private cancelUpload$: Subject<string> = new Subject();
  private cancelAll$: Subject<void> = new Subject();
  // private uploadComplete$: Subject<FileUUID> = new Subject();

  public isUploading: boolean = false;

  constructor(indexDBStorage: IndexedDBStorage) {
    this.fullFolderPathToUUID = {};
    this.fullFilePathToUUID = {};
    this.folderUUIDToMetadata = {};
    this.fileUUIDToMetadata = {};
    this.fuseIndex = new Fuse<FuseRecord>([], {
      keys: ["text"],
      includeScore: true,
      threshold: 0.3,
    });
    this.indexDBStorage = indexDBStorage;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    await this.indexDBStorage.initialize();
    this.isInitialized = true;
    // console.log(`DriveDB initialized to `, this.isInitialized);
    await this.loadHashtables();
  }

  public async initStorj(auth: S3ClientAuth): Promise<void> {
    if (!this.storjClient) {
      StorjClient.initialize(auth);
      this.storjClient = StorjClient.getInstance();
    } else {
      console.warn("StorjClient is already initialized.");
    }
  }

  private async loadHashtables(): Promise<void> {
    if (this.isInitialized) {
      this.fullFolderPathToUUID =
        (await this.indexDBStorage.getHashtable<Hashtable_FullFolderPathToUUID>(
          HashtableTypeEnum.FullFolderPathToUUID
        )) || {};
      this.fullFilePathToUUID =
        (await this.indexDBStorage.getHashtable<Hashtable_FullFilePathToUUID>(
          HashtableTypeEnum.FullFilePathToUUID
        )) || {};
      this.folderUUIDToMetadata =
        (await this.indexDBStorage.getHashtable<Hashtable_FolderUUIDToMetadata>(
          HashtableTypeEnum.FolderUUIDToMetadata
        )) || {};
      this.fileUUIDToMetadata =
        (await this.indexDBStorage.getHashtable<Hashtable_FileUUIDToMetadata>(
          HashtableTypeEnum.FileUUIDToMetadata
        )) || {};
      this.reindexFuzzySearch();
    }
  }

  private async saveHashtables(): Promise<void> {
    if (this.isInitialized) {
      await this.indexDBStorage.saveHashtable(
        HashtableTypeEnum.FullFolderPathToUUID,
        this.fullFolderPathToUUID
      );
      await this.indexDBStorage.saveHashtable(
        HashtableTypeEnum.FullFilePathToUUID,
        this.fullFilePathToUUID
      );
      await this.indexDBStorage.saveHashtable(
        HashtableTypeEnum.FolderUUIDToMetadata,
        this.folderUUIDToMetadata
      );
      await this.indexDBStorage.saveHashtable(
        HashtableTypeEnum.FileUUIDToMetadata,
        this.fileUUIDToMetadata
      );
    }
  }

  // core
  upsertFileToHashTables(
    uploadFilePath: DriveFilePath,
    storageLocation: StorageLocationEnum,
    userId: UserID,
    metadata?: FileMetadataFragment
  ): FileUUID {
    const filePath = sanitizeFilePath(uploadFilePath);
    const fullFilePath = `${storageLocation}::${filePath}` as DriveFullFilePath;
    const newFileUUID = metadata?.id || (uuidv4() as FileUUID);
    let fileVersion = 1;
    let priorVersion: FileUUID | null = null;

    const fileAlreadyExists = this.fullFilePathToUUID[fullFilePath];

    // Check if file already exists
    if (fileAlreadyExists) {
      const existingFileUUID = this.fullFilePathToUUID[fullFilePath];
      const existingFile = this.fileUUIDToMetadata[existingFileUUID];
      fileVersion = existingFile.fileVersion + 1;
      priorVersion = existingFileUUID;
    }

    // Ensure folder structure exists
    const folderUUID = this.ensureFolderStructure(
      filePath,
      storageLocation,
      userId
    );

    // Create file metadata
    const fileName = filePath.split("/").pop() || "";
    const fileExtension = fileName.includes(".")
      ? fileName.split(".").pop() || ""
      : "";
    const now = new Date();

    const fileMetadata: FileMetadata = {
      id: newFileUUID,
      originalFileName: fileName,
      folderUUID,
      fileVersion,
      priorVersion,
      nextVersion: null,
      extension: fileExtension,
      fullFilePath,
      tags: [],
      owner: userId,
      createdDate: now,
      modifiedDate: metadata?.modifiedDate || now,
      storageLocation,
      fileSize: metadata?.fileSize || 0,
      rawURL: metadata?.rawURL || "",
    };

    // Update hashtables
    this.fullFilePathToUUID[fullFilePath] = newFileUUID;
    this.fileUUIDToMetadata[newFileUUID] = fileMetadata;

    // Update parent folder's fileUUIDs
    const parentFolder = this.folderUUIDToMetadata[folderUUID];
    if (priorVersion) {
      // Remove the old file UUID from the parent folder
      parentFolder.fileUUIDs = parentFolder.fileUUIDs.filter(
        (uuid) => uuid !== priorVersion
      );
    }
    // Add the new file UUID to the parent folder
    parentFolder.fileUUIDs.push(newFileUUID);

    // Update prior version if it exists
    if (priorVersion) {
      this.fileUUIDToMetadata[priorVersion].nextVersion = newFileUUID;
    }

    if (!fileAlreadyExists) {
      const fuseRecord: FuseRecord = {
        id: `file:::${newFileUUID}`,
        text: fileName,
      };
      this.fuseIndex.add(fuseRecord);
    }

    this.saveHashtables();

    return newFileUUID;
  }
  private ensureFolderStructure(
    filePath: string,
    storageLocation: StorageLocationEnum,
    userId: UserID
  ): FolderUUID {
    const pathParts = filePath.split("/").filter((part) => part.length > 0);
    let currentPath = `${storageLocation}::` as DriveFullFilePath;
    let parentFolderUUID: FolderUUID | null = null;

    // Ensure the root storage location folder exists
    if (!this.fullFolderPathToUUID[currentPath]) {
      const rootFolderUUID = uuidv4() as FolderUUID;
      this.fullFolderPathToUUID[currentPath] = rootFolderUUID;
      this.folderUUIDToMetadata[rootFolderUUID] = {
        id: rootFolderUUID,
        originalFolderName: "",
        parentFolderUUID: null,
        subfolderUUIDs: [],
        fileUUIDs: [],
        fullFolderPath: currentPath,
        tags: [],
        owner: userId,
        createdDate: new Date(),
        storageLocation,
      };
      const folderFuseRecord: FuseRecord = {
        id: `folder:::${rootFolderUUID}`,
        text: storageLocation,
      };
      this.fuseIndex.add(folderFuseRecord);
    }
    parentFolderUUID = this.fullFolderPathToUUID[currentPath];

    // Handle building the folder structure
    for (let i = 0; i < pathParts.length - 1; i++) {
      const folderName = pathParts[i];
      currentPath += (folderName + "/") as DriveFullFilePath;

      if (!this.fullFolderPathToUUID[currentPath as DriveFullFilePath]) {
        const newFolderUUID = uuidv4() as FolderUUID;
        this.fullFolderPathToUUID[currentPath as DriveFullFilePath] =
          newFolderUUID;

        const newFolderMetadata: FolderMetadata = {
          id: newFolderUUID,
          originalFolderName: folderName,
          parentFolderUUID,
          subfolderUUIDs: [],
          fileUUIDs: [],
          fullFolderPath: currentPath as DriveFullFilePath,
          tags: [],
          owner: userId,
          createdDate: new Date(),
          storageLocation,
        };

        this.folderUUIDToMetadata[newFolderUUID] = newFolderMetadata;

        if (parentFolderUUID) {
          this.folderUUIDToMetadata[parentFolderUUID].subfolderUUIDs.push(
            newFolderUUID
          );
        }

        const folderFuseRecord: FuseRecord = {
          id: `folder:::${newFolderUUID}`,
          text: folderName,
        };
        this.fuseIndex.add(folderFuseRecord);

        parentFolderUUID = newFolderUUID;
      } else {
        parentFolderUUID =
          this.fullFolderPathToUUID[currentPath as DriveFullFilePath];
      }
    }

    return parentFolderUUID as FolderUUID;
  }

  createFolder(
    fullFolderPath: DriveFullFilePath,
    storageLocation: StorageLocationEnum,
    userId: UserID
  ): FolderMetadata {
    const [storagePart, ...pathParts] = fullFolderPath.split("::");
    const pathString = pathParts.join("::"); // Rejoin in case there were extra "::" in the path

    const sanitizedPath = sanitizeFilePath(pathString);
    if (!sanitizedPath) {
      throw new Error(DRIVE_ERRORS.INVALID_NAME);
    }

    const sanitizedPathParts = sanitizedPath.split("/").filter(Boolean);

    let currentPath = `${storagePart}::` as DriveFullFilePath;
    let parentFolderUUID: FolderUUID | null = null;

    // Ensure root folder exists
    if (!this.fullFolderPathToUUID[currentPath]) {
      const rootFolderUUID = uuidv4() as FolderUUID;
      this.fullFolderPathToUUID[currentPath] = rootFolderUUID;
      this.folderUUIDToMetadata[rootFolderUUID] = {
        id: rootFolderUUID,
        originalFolderName: "",
        parentFolderUUID: null,
        subfolderUUIDs: [],
        fileUUIDs: [],
        fullFolderPath: currentPath,
        tags: [],
        owner: userId,
        createdDate: new Date(),
        storageLocation,
      };
    }

    parentFolderUUID = this.fullFolderPathToUUID[currentPath];

    // Create or get each folder in the path
    for (let i = 0; i < sanitizedPathParts.length; i++) {
      currentPath += sanitizedPathParts[i] + "/";

      if (this.fullFolderPathToUUID[currentPath as DriveFullFilePath]) {
        if (i === sanitizedPathParts.length - 1) {
          // If this is the last part of the path and it already exists, throw an error
          throw new Error(DRIVE_ERRORS.NAME_CONFLICT);
        }
        parentFolderUUID =
          this.fullFolderPathToUUID[currentPath as DriveFullFilePath];
      } else {
        const parentFolder = this.folderUUIDToMetadata[parentFolderUUID];
        if (
          parentFolder.subfolderUUIDs.some(
            (uuid) =>
              this.folderUUIDToMetadata[uuid].originalFolderName ===
              sanitizedPathParts[i]
          )
        ) {
          throw new Error(DRIVE_ERRORS.NAME_CONFLICT);
        }

        const newFolderUUID = uuidv4() as FolderUUID;
        const newFolderMetadata: FolderMetadata = {
          id: newFolderUUID,
          originalFolderName: sanitizedPathParts[i],
          parentFolderUUID,
          subfolderUUIDs: [],
          fileUUIDs: [],
          fullFolderPath: currentPath as DriveFullFilePath,
          tags: [],
          owner: userId,
          createdDate: new Date(),
          storageLocation,
        };

        // Update hashtables
        this.fullFolderPathToUUID[currentPath as DriveFullFilePath] =
          newFolderUUID;
        this.folderUUIDToMetadata[newFolderUUID] = newFolderMetadata;

        // Update parent folder
        parentFolder.subfolderUUIDs.push(newFolderUUID);

        // Add to Fuse index for searching
        this.fuseIndex.add({
          id: `folder:::${newFolderUUID}` as FuseRecordID,
          text: sanitizedPathParts[i],
        });

        parentFolderUUID = newFolderUUID;
      }
    }

    this.saveHashtables();

    return this.folderUUIDToMetadata[
      this.fullFolderPathToUUID[currentPath as DriveFullFilePath]
    ];
  }

  uploadFilesFolders(
    files: FileList | File[],
    uploadFolderPath: UploadFolderPath,
    storageLocation: StorageLocationEnum,
    userID: UserID,
    concurrency: number = 5
  ): {
    progress$: Observable<UploadProgress>;
    cancelUpload: (id: string) => void;
    cancelAll: () => void;
    uploadComplete$: Observable<FileUUID>;
    getUploadQueue: () => UploadItem[];
  } {
    const fileArray = Array.from(files);

    fileArray.forEach((file) => {
      const filePath = this.constructFilePath(
        uploadFolderPath,
        file
      ) as DriveFilePath;
      this.addToQueue(file, filePath, storageLocation);
    });

    const progress$ = new BehaviorSubject<UploadProgress>({
      totalFiles: this.uploadQueue.length,
      completedFiles: 0,
      inProgress: [],
      percentage: 0,
    });

    const uploadComplete$ = new Subject<FileUUID>();

    const cancelUpload = (id: string) => {
      const index = this.uploadQueue.findIndex((item) => item.id === id);
      if (index !== -1) {
        this.uploadQueue[index].status = FileUploadStatusEnum.Cancelled;
        this.updateProgress(progress$);
      }
    };

    const cancelAll = () => {
      this.uploadQueue.forEach((item) => {
        if (
          item.status === FileUploadStatusEnum.Queued ||
          item.status === FileUploadStatusEnum.Uploading
        ) {
          item.status = FileUploadStatusEnum.Cancelled;
        }
      });
      this.updateProgress(progress$);
    };

    this.startUpload(
      storageLocation,
      userID,
      concurrency,
      progress$,
      uploadComplete$
    );

    return {
      progress$: progress$.asObservable(),
      cancelUpload,
      cancelAll,
      uploadComplete$: uploadComplete$.asObservable(),
      getUploadQueue: () => [...this.uploadQueue],
    };
  }

  private addToQueue(
    file: File,
    path: DriveFilePath,
    storageLocation: StorageLocationEnum
  ): void {
    const newItem: UploadItem = {
      id: uuidv4() as FileUUID,
      file,
      name: file.name,
      path,
      progress: 0,
      status: FileUploadStatusEnum.Queued,
      storageLocation,
    };

    this.uploadQueue.push(newItem);
    this.updateProgress();
  }

  public clearQueue(): void {
    // Remove only completed, cancelled, or failed uploads
    this.uploadQueue = this.uploadQueue.filter(
      (item) =>
        item.status === FileUploadStatusEnum.Queued ||
        item.status === FileUploadStatusEnum.Uploading
    );

    // Update the upload progress
    this.updateProgress();
  }

  private startUpload(
    storageLocation: StorageLocationEnum,
    userID: UserID,
    concurrency: number,
    progress$: Subject<UploadProgress>,
    uploadComplete$: Subject<FileUUID>
  ): void {
    if (this.uploadQueue.length === 0) {
      // If there are no items to upload, complete the uploadComplete$ Subject immediately
      uploadComplete$.complete();
      return;
    }
    from(this.uploadQueue)
      .pipe(
        filter((item) => item.status === FileUploadStatusEnum.Queued),
        mergeMap(
          (item) =>
            this.processUploadItem(
              item,
              storageLocation,
              userID,
              progress$,
              uploadComplete$
            ),
          concurrency
        )
      )
      .subscribe({
        complete: () => {
          progress$.complete();
          uploadComplete$.complete();
        },
      });
  }

  private processUploadItem(
    item: UploadItem,
    storageLocation: StorageLocationEnum,
    userID: UserID,
    progress$: Subject<UploadProgress>,
    uploadComplete$: Subject<FileUUID>
  ): Observable<void> {
    return new Observable<void>((observer) => {
      if (item.status === FileUploadStatusEnum.Cancelled) {
        observer.complete();
        return;
      }

      item.status = FileUploadStatusEnum.Uploading;
      this.updateProgress(progress$);

      this.uploadFile(item, storageLocation)
        .pipe(
          tap((result) => {
            item.progress = result.progress;
            this.updateProgress(progress$);
          }),
          filter((result) => result.progress === 100),
          take(1)
        )
        .subscribe({
          next: (result) => {
            item.status = FileUploadStatusEnum.Completed;
            this.updateProgress(progress$);
            this.upsertFileToHashTables(
              item.path,
              storageLocation,
              userID,
              result.metadataFragment
            );
            uploadComplete$.next(result.metadataFragment.id);
            observer.complete();
          },
          error: (error) => {
            item.status = FileUploadStatusEnum.Failed;
            this.updateProgress(progress$);
            observer.error(error);
          },
        });
    });
  }

  private updateProgress(progress$?: Subject<UploadProgress>): void {
    const inProgress = this.uploadQueue.filter(
      (item) => item.status === FileUploadStatusEnum.Uploading
    );
    const completedFiles = this.uploadQueue.filter(
      (item) =>
        item.status === FileUploadStatusEnum.Completed ||
        item.status === FileUploadStatusEnum.Cancelled ||
        item.status === FileUploadStatusEnum.Failed
    ).length;
    const totalProgress = this.uploadQueue.reduce(
      (sum, item) => sum + item.progress,
      0
    );
    const percentage = Math.round(totalProgress / this.uploadQueue.length);

    if (progress$) {
      progress$.next({
        totalFiles: this.uploadQueue.length,
        completedFiles,
        inProgress,
        percentage,
      });
    }
  }

  // private cleanupCancelledUpload(item: UploadItem): void {
  //   if (item.status === FileUploadStatusEnum.Cancelled) {
  //     // Remove any partially uploaded data
  //     this.indexDBStorage
  //       .deleteFile(item.id as DriveFileRawDestinationIndexDBFileID)
  //       .catch((error) =>
  //         console.error("Error cleaning up cancelled upload:", error)
  //       );

  //     // Remove from upload queue
  //     this.uploadQueue = this.uploadQueue.filter(
  //       (queueItem) => queueItem.id !== item.id
  //     );

  //     // Update any relevant metadata or state
  //     // This might involve removing entries from hashtables if they were added during the upload process
  //   }
  // }

  public cancelUpload(id: string): void {
    const itemToCancel = this.uploadQueue.find((item) => item.id === id);
    if (itemToCancel) {
      this.cancelUpload$.next(id);
      itemToCancel.status = FileUploadStatusEnum.Cancelled;
      this.updateProgress();
    }
  }

  public cancelAllUploads(): void {
    this.cancelAll$.next();
    this.uploadQueue.forEach((item) => {
      if (
        item.status === FileUploadStatusEnum.Queued ||
        item.status === FileUploadStatusEnum.Uploading
      ) {
        item.status = FileUploadStatusEnum.Cancelled;
      }
    });
    this.updateProgress();
  }

  private uploadFile(
    item: UploadItem,
    storageLocation: StorageLocationEnum
  ): Observable<{ progress: number; metadataFragment: FileMetadataFragment }> {
    switch (storageLocation) {
      case StorageLocationEnum.BrowserCache:
        return this.indexDBStorage.uploadRawFile(
          item.file,
          item.id as FileUUID
        );
      case StorageLocationEnum.Web3Storj:
        if (!StorjClient.getInstance()) {
          return new Observable((observer) => {
            observer.error(
              new Error(
                "StorjClient is not initialized. Please call initStorj() first."
              )
            );
          });
        }
        const key = `${item.id}${getFileExtension(item.path)}`;
        return StorjClient.uploadObject(item.id, key, item.file);
      // Add cases for other storage locations here
      default:
        return new Observable((observer) => {
          observer.error(
            new Error(`Unsupported storage location: ${storageLocation}`)
          );
        });
    }
  }

  public async refreshSignedUrl(fileUUID: FileUUID): Promise<void> {
    const file = this.fileUUIDToMetadata[fileUUID];
    if (!file) {
      throw new Error("File not found");
    }

    if (file.storageLocation === StorageLocationEnum.Web3Storj) {
      const key = `${fileUUID}.${file.extension}`;
      const newSignedUrl = await StorjClient.getSignedUrl({
        key,
        customFilename: file.originalFileName,
      });
      file.rawURL = newSignedUrl;
      await this.saveHashtables();
    }
  }

  private constructFilePath(basePath: string, file: File): DriveFilePath {
    if ("webkitRelativePath" in file && file.webkitRelativePath) {
      return `${basePath}/${file.webkitRelativePath}` as DriveFilePath;
    } else {
      return `${basePath}/${file.name}` as DriveFilePath;
    }
  }

  public getUploadQueue(): UploadItem[] {
    return [...this.uploadQueue];
  }

  // query
  fetchFilesAtFolderPath(config: FetchFilesAtFolderPathConfig) {
    const { fullFolderPath, limit, after } = config;
    const folderUUID = this.fullFolderPathToUUID[fullFolderPath];

    if (!folderUUID) {
      return {
        folders: [],
        files: [],
        total: 0,
        hasMore: false,
      };
    }

    const folderMetadata = this.folderUUIDToMetadata[folderUUID];

    if (!folderMetadata) {
      return {
        folders: [],
        files: [],
        total: 0,
        hasMore: false,
      };
    }

    const subfolders = folderMetadata.subfolderUUIDs.map(
      (uuid) => this.folderUUIDToMetadata[uuid]
    );
    const files = folderMetadata.fileUUIDs.map(
      (uuid) => this.fileUUIDToMetadata[uuid]
    );

    const totalItems = subfolders.length + files.length;
    let startIndex = after;
    let endIndex = Math.min(startIndex + limit, totalItems);

    let matchedFolders: FolderMetadata[] = [];
    let matchedFiles: FileMetadata[] = [];

    // Handle folders first
    if (startIndex < subfolders.length) {
      const foldersEndIndex = Math.min(endIndex, subfolders.length);
      matchedFolders = subfolders.slice(startIndex, foldersEndIndex);
      startIndex = foldersEndIndex;
      endIndex = Math.min(
        startIndex + (limit - matchedFolders.length),
        totalItems
      );
    }

    // Then handle files if there's still room
    if (startIndex >= subfolders.length && matchedFolders.length < limit) {
      const filesStartIndex = Math.max(0, startIndex - subfolders.length);
      const filesEndIndex = Math.min(
        files.length,
        filesStartIndex + (limit - matchedFolders.length)
      );
      matchedFiles = files.slice(filesStartIndex, filesEndIndex);
    }

    return {
      folders: matchedFolders,
      files: matchedFiles,
      total: matchedFolders.length + matchedFiles.length,
      hasMore: endIndex < totalItems,
    };
  }
  searchFilesQuery(config: SearchFilesQueryConfig) {
    const { searchString, limit, after } = config;
    const searchResults = this.fuseIndex.search(searchString, {
      limit: limit + after + 1, // Fetch extra results for pagination
    });
    const paginatedResults = searchResults.slice(after, after + limit);

    const files: FileMetadata[] = [];
    const folders: FolderMetadata[] = [];

    paginatedResults.forEach((result) => {
      const [type, id] = result.item.id.split(":::");
      if (type === "file") {
        const fileMetadata = this.fileUUIDToMetadata[id as FileUUID];
        if (fileMetadata) {
          files.push(fileMetadata);
        }
      } else if (type === "folder") {
        const folderMetadata = this.folderUUIDToMetadata[id as FolderUUID];
        if (folderMetadata) {
          folders.push(folderMetadata);
        }
      }
    });

    return {
      files,
      folders,
      total: paginatedResults.length,
      hasMore: searchResults.length > after + limit,
    };
  }
  public async indexdbGetFileStream(
    fileUUID: FileUUID
  ): Promise<ReadableStream<Uint8Array>> {
    const file = await this.getFileByID(fileUUID);
    if (!file) {
      throw new Error("File not found");
    }

    return this.indexDBStorage.getFileStream(
      file.rawURL as DriveFileRawDestinationIndexDBFileID
    );
  }

  // delete
  deleteFilesFolders(paths: DriveFullFilePath[]): void {
    paths.forEach((path) => {
      if (path.endsWith("::")) {
        console.warn(`Skipping deletion of root folder: ${path}`);
        return;
      }
      const folderUUID = this.fullFolderPathToUUID[path];
      if (folderUUID) {
        this.deleteFolder(folderUUID);
      } else {
        const fileUUID = this.fullFilePathToUUID[path];
        if (fileUUID) {
          this.deleteFile(fileUUID);
        } else {
          console.warn(`Path not found: ${path}`);
        }
      }
    });
  }
  private deleteFolder(folderUUID: FolderUUID): void {
    const folder = this.folderUUIDToMetadata[folderUUID];
    if (!folder) return;

    // Recursively delete subfolders
    folder.subfolderUUIDs.forEach((subFolderUUID) =>
      this.deleteFolder(subFolderUUID)
    );

    // Delete files in this folder
    folder.fileUUIDs.forEach((fileUUID) => this.deleteFile(fileUUID));

    // Remove folder from parent's subfolders
    if (folder.parentFolderUUID) {
      const parentFolder = this.folderUUIDToMetadata[folder.parentFolderUUID];
      if (parentFolder) {
        parentFolder.subfolderUUIDs = parentFolder.subfolderUUIDs.filter(
          (uuid) => uuid !== folderUUID
        );
      }
    }

    // Remove folder from all data structures
    delete this.folderUUIDToMetadata[folderUUID];
    delete this.fullFolderPathToUUID[folder.fullFolderPath];

    this.saveHashtables();
  }
  private deleteFile(fileUUID: FileUUID): void {
    let currentFileUUID: FileUUID | null = fileUUID;
    let priorFileUUID = this.fileUUIDToMetadata[fileUUID]?.priorVersion || null;

    while (currentFileUUID) {
      const file: FileMetadata = this.fileUUIDToMetadata[currentFileUUID];
      if (!file) break;

      // Remove file from its folder
      const parentFolder = this.folderUUIDToMetadata[file.folderUUID];
      if (parentFolder) {
        parentFolder.fileUUIDs = parentFolder.fileUUIDs.filter(
          (uuid) => uuid !== currentFileUUID
        );
      }

      // Remove file from all data structures
      delete this.fileUUIDToMetadata[currentFileUUID];
      delete this.fullFilePathToUUID[file.fullFilePath];

      // Move to next version
      currentFileUUID = file.nextVersion;
    }

    // Also delete previous versions
    while (priorFileUUID) {
      const file = this.fileUUIDToMetadata[priorFileUUID];
      if (!file) break;

      // Remove file from its folder
      const parentFolder = this.folderUUIDToMetadata[file.folderUUID];
      if (parentFolder) {
        parentFolder.fileUUIDs = parentFolder.fileUUIDs.filter(
          (uuid) => uuid !== priorFileUUID
        );
      }

      // Remove file from all data structures
      delete this.fileUUIDToMetadata[priorFileUUID];
      delete this.fullFilePathToUUID[file.fullFilePath];

      // Move to previous version
      priorFileUUID = file.priorVersion;
    }

    this.saveHashtables();
  }

  // rename
  renameFilePath(fileID: FileUUID, newName: string): FileMetadata {
    const file = this.fileUUIDToMetadata[fileID];
    if (!file) {
      throw new Error(DRIVE_ERRORS.FILE_NOT_FOUND);
    }

    const oldPath = file.fullFilePath;
    const [storageLocation, ...oldPathParts] = oldPath.split("::");
    const newFileName = sanitizeFilePath(newName);

    // Check if the new name is valid
    if (newFileName.includes("/") || newFileName === "") {
      throw new Error(DRIVE_ERRORS.INVALID_NAME);
    }

    // Create the new path
    const oldFilePath = oldPathParts[0].split("/");
    oldFilePath[oldFilePath.length - 1] = newFileName;
    const newPath =
      `${storageLocation}::${oldFilePath.join("/")}` as DriveFullFilePath;

    // Check if a file with the new name already exists in the same folder
    if (this.fullFilePathToUUID[newPath]) {
      throw new Error(DRIVE_ERRORS.NAME_CONFLICT);
    }

    // Update the file metadata
    file.originalFileName = newFileName;
    file.fullFilePath = newPath;
    file.extension = newFileName.split(".").pop() || "";

    // Update the hashtables
    delete this.fullFilePathToUUID[oldPath];
    this.fullFilePathToUUID[newPath] = fileID;

    // Add to the Fuse index
    this.fuseIndex.add({
      id: `file:::${fileID}` as FuseRecordID,
      text: newFileName,
    });

    this.saveHashtables();

    return file;
  }
  renameFolderPath(folderID: FolderUUID, newName: string): FolderMetadata {
    const folder = this.folderUUIDToMetadata[folderID];
    if (!folder) {
      throw new Error(DRIVE_ERRORS.FOLDER_NOT_FOUND);
    }

    const oldPath = folder.fullFolderPath;
    const [storageLocation, ...oldPathParts] = oldPath.split("::");
    const newFolderName = sanitizeFilePath(newName);

    // Check if the new name is valid
    if (newFolderName.includes("/") || newFolderName === "") {
      throw new Error(DRIVE_ERRORS.INVALID_NAME);
    }

    // Create the new path
    const oldFolderPath = oldPathParts[0].split("/");
    oldFolderPath[oldFolderPath.length - 2] = newFolderName; // -2 because the path ends with '/'
    const newPath =
      `${storageLocation}::${oldFolderPath.join("/")}` as DriveFullFilePath;

    // Check if a folder with the new name already exists in the parent folder
    if (this.fullFolderPathToUUID[newPath]) {
      throw new Error(DRIVE_ERRORS.NAME_CONFLICT);
    }

    // Update the folder metadata
    folder.originalFolderName = newFolderName;
    folder.fullFolderPath = newPath;

    // Update the hashtables
    delete this.fullFolderPathToUUID[oldPath];
    this.fullFolderPathToUUID[newPath] = folderID;

    // Add to the Fuse index
    this.fuseIndex.add({
      id: `folder:::${folderID}` as FuseRecordID,
      text: newFolderName,
    });

    // Recursively update all subfolders and files
    this.updateSubpaths(folder, oldPath, newPath);

    this.saveHashtables();

    return folder;
  }
  private updateSubpaths(
    folder: FolderMetadata,
    oldBasePath: DriveFullFilePath,
    newBasePath: DriveFullFilePath
  ) {
    // Update subfolders
    for (const subfolderUUID of folder.subfolderUUIDs) {
      const subfolder = this.folderUUIDToMetadata[subfolderUUID];
      const oldSubfolderPath = subfolder.fullFolderPath;
      const newSubfolderPath = oldSubfolderPath.replace(
        oldBasePath,
        newBasePath
      ) as DriveFullFilePath;

      // Update subfolder metadata
      subfolder.fullFolderPath = newSubfolderPath;

      // Update hashtables
      delete this.fullFolderPathToUUID[oldSubfolderPath];
      this.fullFolderPathToUUID[newSubfolderPath] = subfolderUUID;

      // Recursively update subfolders
      this.updateSubpaths(subfolder, oldSubfolderPath, newSubfolderPath);
    }

    // Update files in the current folder
    for (const fileUUID of folder.fileUUIDs) {
      const file = this.fileUUIDToMetadata[fileUUID];
      const oldFilePath = file.fullFilePath;
      const newFilePath = oldFilePath.replace(
        oldBasePath,
        newBasePath
      ) as DriveFullFilePath;

      // Update file metadata
      file.fullFilePath = newFilePath;

      // Update hashtables
      delete this.fullFilePathToUUID[oldFilePath];
      this.fullFilePathToUUID[newFilePath] = fileUUID;
    }
  }

  // TODO: Move, Copy Files (observable)
  moveOrCopyFilesFolders() {}

  // TODO: Download Files
  downloadFiles() {}
  downloadFolders() {}

  // TODO: Add/Remove Tags
  addRemoveTags() {} // including mark trash

  // primitive gets
  getFolderByID(folderUUID: FolderUUID): FolderMetadata | undefined {
    return this.folderUUIDToMetadata[folderUUID];
  }
  public async getFileByID(
    fileUUID: FileUUID
  ): Promise<FileMetadata | undefined> {
    const file = this.fileUUIDToMetadata[fileUUID];
    if (file && file.storageLocation === StorageLocationEnum.Web3Storj) {
      const key = `${fileUUID}.${file.extension}`;
      file.rawURL = await StorjClient.getSignedUrl({
        key,
        customFilename: file.originalFileName,
      });
    }
    return file;
  }
  getFolderByFullPath(
    fullFolderPath: DriveFullFilePath
  ): FolderMetadata | undefined {
    const folderUUID = this.fullFolderPathToUUID[fullFolderPath];
    return folderUUID ? this.folderUUIDToMetadata[folderUUID] : undefined;
  }
  public async getFileByFullPath(
    fullFilePath: DriveFullFilePath
  ): Promise<FileMetadata | undefined> {
    const fileUUID = this.fullFilePathToUUID[fullFilePath];
    if (fileUUID) {
      return this.getFileByID(fileUUID);
    }
    return undefined;
  }
  // admin
  exportSnapshot(userId: UserID): DriveDBSnapshot {
    const id = uuidv4() as DriveSnapshotID;
    const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp
    const snapshotName = `snapshot_officex_drive.id_${id}.userID_${userId}.timestamp_${timestamp}.json`;
    const snapshot: DriveDBSnapshot = {
      id,
      createdAt: new Date(),
      snapshotName,
      fullFolderPathToUUID: this.fullFolderPathToUUID,
      fullFilePathToUUID: this.fullFilePathToUUID,
      folderUUIDToMetadata: this.folderUUIDToMetadata,
      fileUUIDToMetadata: this.fileUUIDToMetadata,
    };
    return snapshot;
  }
  reindexFuzzySearch(): { fileCount: number; folderCount: number } {
    // Initialize a new Fuse instance with an empty array
    this.fuseIndex = new Fuse<FuseRecord>([], {
      keys: ["text"],
      includeScore: true,
      threshold: 0.3,
    });

    let folderCount = 0;
    let fileCount = 0;

    // Index folders
    for (const [fullFolderPath, folderUUID] of Object.entries(
      this.fullFolderPathToUUID
    )) {
      console.log(fullFolderPath);
      const folderMetadata = this.folderUUIDToMetadata[folderUUID];
      if (folderMetadata) {
        this.fuseIndex.add({
          id: `folder:::${folderUUID}` as FuseRecordID,
          text: folderMetadata.originalFolderName,
        });
        folderCount++;
      }
    }

    // Index files
    for (const [fullFilePath, fileUUID] of Object.entries(
      this.fullFilePathToUUID
    )) {
      console.log(fullFilePath);
      const fileMetadata = this.fileUUIDToMetadata[fileUUID];
      if (fileMetadata) {
        this.fuseIndex.add({
          id: `file:::${fileUUID}` as FuseRecordID,
          text: fileMetadata.originalFileName,
        });
        fileCount++;
      }
    }
    return {
      fileCount,
      folderCount,
    };
  }
  ping(): string {
    const message = `Current time is ${new Date()}`;
    // console.log(message);
    return message;
  }
  checkIfInitialized(): boolean {
    return this.isInitialized;
  }
}

export default DriveDB;
